const express = require('express');
const authMiddleware = require('../middleware/auth');
const router = express.Router();

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GEMINI_VISION_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';

// ── Appel Gemini Vision (analyse image) ───────
async function analyzeImageWithGemini(base64Image, mimeType = 'image/jpeg') {
  const fetch = (await import('node-fetch')).default;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY non configurée');

  const body = {
    contents: [{
      parts: [
        {
          inline_data: { mime_type: mimeType, data: base64Image }
        },
        {
          text: `Analyse cette photo de réfrigérateur ou d'ingrédients alimentaires.
Liste UNIQUEMENT les ingrédients alimentaires que tu vois clairement, en français.
Format de réponse : une liste simple séparée par des virgules.
Exemple: poulet, tomates, ail, fromage, œufs, beurre
Ne mentionne pas les contenants, marques, ou objets non alimentaires.
Si tu ne vois pas d'aliments, réponds: "Aucun ingrédient détecté"`
        }
      ]
    }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 200 }
  };

  const controller1 = new AbortController();
  const timer1 = setTimeout(() => controller1.abort(), 15000);
  const res = await fetch(`${GEMINI_VISION_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: controller1.signal,
  });
  clearTimeout(timer1);

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini Vision error ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || 'Aucun ingrédient détecté';
}

// ── Générer recettes depuis ingrédients (Groq) ─
async function generateRecipesFromIngredients(ingredients, servings = 4) {
  const fetch = (await import('node-fetch')).default;
  const systemPrompt = `Tu es un chef cuisinier expert. On te donne une liste d'ingrédients disponibles.
Génère exactement 5 recettes réalisables avec ces ingrédients (on peut supposer sel, poivre, huile disponibles).
Réponds UNIQUEMENT avec un tableau JSON valide, sans markdown :
[{"title":"Nom","category":"🍽️ Catégorie","durationMinutes":30,"servings":${servings},"description":"Description appétissante.","ingredients":["avec quantités"],"steps":["étapes détaillées"],"usedIngredients":["ingrédients de la photo utilisés"]}]`;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30000);
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.GROQ_API_KEY}` },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Ingrédients disponibles: ${ingredients}\nGénère 5 recettes variées et détaillées (min 5 étapes, min 5 ingrédients chacune).` }
      ],
      max_tokens: 6000, temperature: 0.8,
    }),
    signal: ctrl.signal,
  });
  clearTimeout(t);
  if (!res.ok) throw new Error(`Groq error ${res.status}`);
  const data = await res.json();
  return data.choices[0].message.content;
}

// ── POST /api/vision/analyze — Photo → Recettes ─
router.post('/analyze', authMiddleware, async (req, res) => {
  const { image, mimeType = 'image/jpeg', servings = 4 } = req.body;
  if (!image) return res.status(400).json({ error: 'Image base64 requise' });

  try {
    // Étape 1: Gemini Vision détecte les ingrédients
    console.log('[Vision] Analyse image avec Gemini...');
    const ingredientsText = await analyzeImageWithGemini(image, mimeType);
    console.log('[Vision] Ingrédients détectés:', ingredientsText);

    if (ingredientsText.includes('Aucun ingrédient')) {
      return res.json({
        ingredients: [],
        recipes: [],
        message: 'Aucun ingrédient alimentaire détecté dans cette image.'
      });
    }

    // Étape 2: Groq génère les recettes
    console.log('[Vision] Génération recettes avec Groq...');
    const recipesRaw = await generateRecipesFromIngredients(ingredientsText, servings);
    const clean = recipesRaw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const match = clean.match(/\[[\s\S]*\]/);
    if (!match) throw new Error('Format JSON invalide');

    let recipes = JSON.parse(match[0]);
    recipes = recipes.map((r, i) => ({
      id: `vision_${Date.now()}_${i}`,
      title: r.title || 'Recette sans nom',
      category: r.category || '🍽️ Recette',
      imageUrl: null,
      durationMinutes: parseInt(r.durationMinutes) || 30,
      servings: parseInt(r.servings) || servings,
      description: r.description || '',
      ingredients: Array.isArray(r.ingredients) ? r.ingredients : [],
      steps: Array.isArray(r.steps) ? r.steps : [],
      usedIngredients: Array.isArray(r.usedIngredients) ? r.usedIngredients : [],
    }));

    // Étape 3: Images Unsplash en parallèle
    const { default: fetch2 } = await import('node-fetch');
    if (process.env.UNSPLASH_ACCESS_KEY) {
      await Promise.all(recipes.map(async (recipe) => {
        try {
          const q = encodeURIComponent(recipe.title + ' food');
          const r = await fetch2(
            `https://api.unsplash.com/search/photos?query=${q}&per_page=1&orientation=landscape&client_id=${process.env.UNSPLASH_ACCESS_KEY}`,
            { signal: (() => { const _a = new AbortController(); setTimeout(() => _a.abort(), 5000); return _a.signal; })() }
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
  const systemPrompt = `Tu es un nutritionniste expert. Analyse les valeurs nutritionnelles d'une recette.
Réponds UNIQUEMENT avec un objet JSON valide sans markdown :
{
  "perPortion": {"calories":0,"proteins":0,"carbs":0,"fats":0,"fiber":0,"sugar":0,"sodium":0},
  "perRecipe": {"calories":0,"proteins":0,"carbs":0,"fats":0,"fiber":0,"sugar":0,"sodium":0},
  "vitamins": [{"name":"Vitamine C","amount":"45mg","daily":"50%"},{"name":"Fer","amount":"2mg","daily":"15%"}],
  "score": 7,
  "scoreLabel": "Bon",
  "scoreColor": "green",
  "strengths": ["Riche en protéines","Faible en sucre"],
  "improvements": ["Ajouter des légumes verts","Réduire le sel"],
  "dietCompatibility": {"vegetarian":false,"vegan":false,"glutenFree":true,"dairyFree":false,"keto":false,"lowCarb":false},
  "glycemicIndex": "Moyen",
  "tip": "Conseil nutritionnel personnalisé"
}
Le score va de 1 (très mauvais) à 10 (excellent). scoreColor: "green"(7-10), "orange"(4-6), "red"(1-3).`;

  try {
    const res2 = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.GROQ_API_KEY}` },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Recette: "${title}" pour ${servings} personnes.\nIngrédients: ${ingredients.join(', ')}` }
        ],
        max_tokens: 1500, temperature: 0.2,
      }),
      signal: (() => { const ac1 = new AbortController(); setTimeout(() => ac1.abort(), 20000); return ac1.signal; })()
    });
    if (!res2.ok) throw new Error(`Groq error ${res2.status}`);
    const data = await res2.json();
    const raw = data.choices[0].message.content;
    const clean = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const nutrition = JSON.parse(clean);
    res.json({ nutrition });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/vision/substitute — Substitution ingrédient ─
router.post('/substitute', authMiddleware, async (req, res) => {
  const { ingredient, context, diet } = req.body;
  if (!ingredient) return res.status(400).json({ error: 'Ingrédient requis' });

  const fetch = (await import('node-fetch')).default;
  const systemPrompt = `Tu es un chef cuisinier expert en substitutions d'ingrédients.
Réponds UNIQUEMENT avec un objet JSON valide sans markdown :
{
  "ingredient": "nom de l'ingrédient",
  "reason": "pourquoi on pourrait vouloir le substituer",
  "substitutes": [
    {
      "name": "Substitut 1",
      "ratio": "même quantité",
      "impact": "Goût légèrement différent, texture similaire",
      "best_for": "sauces et plats chauds",
      "availability": "Facile à trouver",
      "emoji": "🥛",
      "tags": ["végétalien","sans lactose"]
    }
  ],
  "tips": "Conseil général sur les substitutions pour cet ingrédient"
}
Donne 3 à 5 substituts variés, du plus proche au plus créatif.`;

  try {
    const res2 = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.GROQ_API_KEY}` },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Ingrédient à substituer: "${ingredient}"${context ? `\nContexte: ${context}` : ''}${diet ? `\nRégime: ${diet}` : ''}` }
        ],
        max_tokens: 1500, temperature: 0.5,
      }),
      signal: (() => { const ac2 = new AbortController(); setTimeout(() => ac2.abort(), 20000); return ac2.signal; })()
    });
    if (!res2.ok) throw new Error(`Groq error ${res2.status}`);
    const data = await res2.json();
    const raw = data.choices[0].message.content;
    const clean = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    res.json({ result: JSON.parse(clean) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/vision/meal-plan — Planning semaine ─
router.post('/meal-plan', authMiddleware, async (req, res) => {
  const { preferences = '', servings = 2, budget = '', diet = '' } = req.body;

  const fetch = (await import('node-fetch')).default;
  const systemPrompt = `Tu es un nutritionniste et chef cuisinier. Crée un planning repas pour 7 jours.
Réponds UNIQUEMENT avec un objet JSON valide sans markdown :
{
  "weekSummary": {"avgCalories":1800,"totalBudget":"~80€","prepTime":"~30min/jour"},
  "days": [
    {
      "day": "Lundi",
      "dayEmoji": "🌅",
      "meals": {
        "breakfast": {"name":"Nom","emoji":"🥐","duration":10,"calories":350,"description":"Description courte"},
        "lunch": {"name":"Nom","emoji":"🥗","duration":25,"calories":550,"description":"Description courte"},
        "dinner": {"name":"Nom","emoji":"🍝","duration":35,"calories":650,"description":"Description courte"},
        "snack": {"name":"Nom","emoji":"🍎","duration":0,"calories":150,"description":"Description courte"}
      },
      "totalCalories": 1700,
      "tip": "Conseil du jour"
    }
  ],
  "shoppingHighlights": ["Acheter en début de semaine: ...","Congeler: ..."],
  "nutritionBalance": "Évaluation globale de l'équilibre nutritionnel"
}`;

  try {
    const res2 = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.GROQ_API_KEY}` },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Crée un planning repas équilibré pour 7 jours.
Personnes: ${servings}
${diet ? `Régime alimentaire: ${diet}` : ''}
${budget ? `Budget: ${budget}` : ''}
${preferences ? `Préférences/contraintes: ${preferences}` : ''}
Assure-toi que les repas sont variés, équilibrés nutritionnellement et réalisables.` }
        ],
        max_tokens: 6000, temperature: 0.7,
      }),
      signal: (() => { const ac3 = new AbortController(); setTimeout(() => ac3.abort(), 40000); return ac3.signal; })()
    });
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