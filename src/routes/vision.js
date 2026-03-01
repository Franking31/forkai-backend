const express = require('express');
const authMiddleware = require('../middleware/auth');
const router = express.Router();

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GEMINI_VISION_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=AIza...';

// ── Timeout helper (compatible toutes versions Node) ──
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout après ${ms}ms`)), ms)
    )
  ]);
}

// ── Gemini Vision : analyse image → liste ingrédients ──
async function analyzeImageWithGemini(base64Image, mimeType = 'image/jpeg') {
  const fetch = (await import('node-fetch')).default;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY non configurée');

  const body = {
    contents: [{
      parts: [
        { inline_data: { mime_type: mimeType, data: base64Image } },
        { text: `Analyse cette photo de réfrigérateur ou d'ingrédients alimentaires.
Liste UNIQUEMENT les ingrédients alimentaires que tu vois clairement, en français.
Format: une liste séparée par des virgules. Exemple: poulet, tomates, ail, fromage
Si tu ne vois pas d'aliments, réponds: "Aucun ingrédient détecté"` }
      ]
    }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 200 }
  };

  const res = await withTimeout(
    fetch(`${GEMINI_VISION_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    20000
  );

  if (!res.ok) throw new Error(`Gemini Vision error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || 'Aucun ingrédient détecté';
}

// ── Groq : ingrédients → recettes ──────────────────────
async function generateRecipesFromIngredients(ingredients, servings = 4) {
  const fetch = (await import('node-fetch')).default;

  const res = await withTimeout(
    fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          {
            role: 'system',
            content: `Tu es un chef cuisinier expert. Génère exactement 5 recettes réalisables avec les ingrédients donnés (sel, poivre, huile supposés disponibles).
Réponds UNIQUEMENT avec un tableau JSON valide, sans markdown :
[{"title":"Nom","category":"🍽️ Catégorie","durationMinutes":30,"servings":${servings},"description":"Description.","ingredients":["avec quantités"],"steps":["étapes détaillées"],"usedIngredients":["ingrédients utilisés"]}]`
          },
          {
            role: 'user',
            content: `Ingrédients: ${ingredients}\nGénère 5 recettes variées (min 5 étapes, min 5 ingrédients chacune).`
          }
        ],
        max_tokens: 6000,
        temperature: 0.8,
      }),
    }),
    35000
  );

  if (!res.ok) throw new Error(`Groq error ${res.status}`);
  const data = await res.json();
  return data.choices[0].message.content;
}

// ── POST /api/vision/analyze — Photo → Recettes ─────────
router.post('/analyze', authMiddleware, async (req, res) => {
  const { image, mimeType = 'image/jpeg', servings = 4 } = req.body;
  if (!image) return res.status(400).json({ error: 'Image base64 requise' });

  try {
    console.log('[Vision] Analyse image avec Gemini...');
    const ingredientsText = await analyzeImageWithGemini(image, mimeType);
    console.log('[Vision] Ingrédients:', ingredientsText);

    if (ingredientsText.includes('Aucun ingrédient')) {
      return res.json({ ingredients: [], recipes: [], message: 'Aucun ingrédient détecté.' });
    }

    console.log('[Vision] Génération recettes avec Groq...');
    const recipesRaw = await generateRecipesFromIngredients(ingredientsText, servings);
    const clean = recipesRaw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const match = clean.match(/\[[\s\S]*\]/);
    if (!match) throw new Error('Format JSON invalide depuis Groq');

    let recipes = JSON.parse(match[0]);
    recipes = recipes.map((r, i) => ({
      id: `vision_${Date.now()}_${i}`,
      title: r.title || 'Recette',
      category: r.category || '🍽️ Recette',
      imageUrl: null,
      durationMinutes: parseInt(r.durationMinutes) || 30,
      servings: parseInt(r.servings) || servings,
      description: r.description || '',
      ingredients: Array.isArray(r.ingredients) ? r.ingredients : [],
      steps: Array.isArray(r.steps) ? r.steps : [],
      usedIngredients: Array.isArray(r.usedIngredients) ? r.usedIngredients : [],
    }));

    // Images Unsplash en parallèle (optionnel)
    if (process.env.UNSPLASH_ACCESS_KEY) {
      const fetch2 = (await import('node-fetch')).default;
      await Promise.all(recipes.map(async (recipe) => {
        try {
          const q = encodeURIComponent(recipe.title + ' food dish');
          const r = await withTimeout(
            fetch2(`https://api.unsplash.com/search/photos?query=${q}&per_page=2&orientation=landscape&client_id=${process.env.UNSPLASH_ACCESS_KEY}`),
            6000
          );
          const d = await r.json();
          if (d.results?.length > 0) recipe.imageUrl = d.results[0].urls.regular;
        } catch (_) {}
      }));
    }

    const ingredientsList = ingredientsText.split(',').map(s => s.trim()).filter(Boolean);
    res.json({
      ingredients: ingredientsList,
      recipes,
      message: `✅ ${ingredientsList.length} ingrédients détectés, ${recipes.length} recettes générées`
    });

  } catch (e) {
    console.error('[Vision] Error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/vision/nutrition — Analyse nutritionnelle ─
router.post('/nutrition', authMiddleware, async (req, res) => {
  const { title, ingredients, servings = 4 } = req.body;
  if (!ingredients?.length) return res.status(400).json({ error: 'Ingrédients requis' });

  const fetch = (await import('node-fetch')).default;

  try {
    const res2 = await withTimeout(
      fetch(GROQ_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [
            {
              role: 'system',
              content: `Tu es un nutritionniste expert. Réponds UNIQUEMENT avec un JSON valide sans markdown :
{"perPortion":{"calories":0,"proteins":0,"carbs":0,"fats":0,"fiber":0,"sugar":0,"sodium":0},"perRecipe":{"calories":0,"proteins":0,"carbs":0,"fats":0,"fiber":0,"sugar":0,"sodium":0},"vitamins":[{"name":"Vitamine C","amount":"45mg","daily":"50%"}],"score":7,"scoreLabel":"Bon","scoreColor":"green","strengths":["Riche en protéines"],"improvements":["Ajouter des légumes"],"dietCompatibility":{"vegetarian":false,"vegan":false,"glutenFree":true,"dairyFree":false,"keto":false,"lowCarb":false},"glycemicIndex":"Moyen","tip":"Conseil personnalisé"}
scoreColor: green(7-10), orange(4-6), red(1-3).`
            },
            {
              role: 'user',
              content: `Recette: "${title}" pour ${servings} personnes. Ingrédients: ${ingredients.join(', ')}`
            }
          ],
          max_tokens: 1500,
          temperature: 0.2,
        }),
      }),
      25000
    );

    if (!res2.ok) throw new Error(`Groq error ${res2.status}`);
    const data = await res2.json();
    const raw = data.choices[0].message.content;
    const clean = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    res.json({ nutrition: JSON.parse(clean) });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/vision/substitute — Substitution ingrédient ─
router.post('/substitute', authMiddleware, async (req, res) => {
  const { ingredient, context, diet } = req.body;
  if (!ingredient) return res.status(400).json({ error: 'Ingrédient requis' });

  const fetch = (await import('node-fetch')).default;

  try {
    const res2 = await withTimeout(
      fetch(GROQ_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [
            {
              role: 'system',
              content: `Tu es un chef expert en substitutions. Réponds UNIQUEMENT avec un JSON valide sans markdown :
{"ingredient":"nom","reason":"pourquoi substituer","substitutes":[{"name":"Substitut","ratio":"même quantité","impact":"Goût similaire","best_for":"sauces","availability":"Facile","emoji":"🥛","tags":["végétalien"]}],"tips":"Conseil général"}
Donne 3 à 5 substituts du plus proche au plus créatif.`
            },
            {
              role: 'user',
              content: `Substituer: "${ingredient}"${context ? `\nContexte: ${context}` : ''}${diet ? `\nRégime: ${diet}` : ''}`
            }
          ],
          max_tokens: 1500,
          temperature: 0.5,
        }),
      }),
      25000
    );

    if (!res2.ok) throw new Error(`Groq error ${res2.status}`);
    const data = await res2.json();
    const raw = data.choices[0].message.content;
    const clean = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    res.json({ result: JSON.parse(clean) });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/vision/meal-plan — Planning semaine ─────────
router.post('/meal-plan', authMiddleware, async (req, res) => {
  const { preferences = '', servings = 2, budget = '', diet = '' } = req.body;

  const fetch = (await import('node-fetch')).default;

  try {
    const res2 = await withTimeout(
      fetch(GROQ_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [
            {
              role: 'system',
              content: `Tu es nutritionniste et chef. Crée un planning 7 jours. Réponds UNIQUEMENT avec un JSON valide sans markdown :
{"weekSummary":{"avgCalories":1800,"totalBudget":"~80€","prepTime":"~30min/jour"},"days":[{"day":"Lundi","dayEmoji":"🌅","meals":{"breakfast":{"name":"Nom","emoji":"🥐","duration":10,"calories":350,"description":"Desc"},"lunch":{"name":"Nom","emoji":"🥗","duration":25,"calories":550,"description":"Desc"},"dinner":{"name":"Nom","emoji":"🍝","duration":35,"calories":650,"description":"Desc"},"snack":{"name":"Nom","emoji":"🍎","duration":0,"calories":150,"description":"Desc"}},"totalCalories":1700,"tip":"Conseil"}],"shoppingHighlights":["Conseil courses"],"nutritionBalance":"Évaluation"}`
            },
            {
              role: 'user',
              content: `Planning 7 jours pour ${servings} personne(s).${diet ? ` Régime: ${diet}.` : ''}${budget ? ` Budget: ${budget}.` : ''}${preferences ? ` Préférences: ${preferences}.` : ''} Repas variés et équilibrés.`
            }
          ],
          max_tokens: 6000,
          temperature: 0.7,
        }),
      }),
      45000
    );

    if (!res2.ok) throw new Error(`Groq error ${res2.status}`);
    const data = await res2.json();
    const raw = data.choices[0].message.content;
    const clean = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const match = clean.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Format JSON invalide');
    res.json({ plan: JSON.parse(match[0]) });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;