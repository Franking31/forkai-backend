const express = require('express');
const authMiddleware = require('../middleware/auth');
const supabase = require('../config/supabase');
const router = express.Router();

// Contexte IA utilisateur (import conditionnel pour éviter crash si fichier absent)
let buildProfileContext = () => '';
try {
  const userPrefs = require('./user_prefs');
  if (userPrefs.buildProfileContext) {
    buildProfileContext = userPrefs.buildProfileContext;
  }
} catch (_) {}

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';

// ── Récupère le contexte utilisateur ───────
async function getUserContext(userId) {
  try {
    const { data } = await supabase
      .from('user_preferences')
      .select('*')
      .eq('user_id', userId)
      .single();
    return data ? buildProfileContext(data) : '';
  } catch (_) { return ''; }
}

async function callGroq(systemPrompt, messages) {
  const fetch = (await import('node-fetch')).default;
  const formatted = [
    { role: 'system', content: systemPrompt || 'Tu es un assistant cuisinier expert.' },
    ...messages.map(m => ({ role: m.isUser ? 'user' : 'assistant', content: m.content })),
  ];
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.GROQ_API_KEY}` },
    body: JSON.stringify({ model: GROQ_MODEL, messages: formatted, max_tokens: 8000, temperature: 0.7 }),
  });
  if (!res.ok) throw new Error(`Groq error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices[0].message.content;
}

// ── Recherche d'image via Unsplash ────────────
async function fetchFoodImage(title) {
  if (!title) return null;
  const fetch = (await import('node-fetch')).default;

  // Nettoyer le titre : enlever emojis et caractères spéciaux
  const query = title
    .replace(/\p{Emoji}/gu, '')
    .replace(/[^\w\s\u00C0-\u017E]/g, ' ')
    .trim();

  console.log(`[Image] Recherche pour: "${query}"`);

  // Unsplash API avec clé
  if (process.env.UNSPLASH_ACCESS_KEY) {
    try {
      const searchQuery = encodeURIComponent(query + ' food meal dish');
      const url = `https://api.unsplash.com/search/photos?query=${searchQuery}&per_page=3&orientation=landscape&client_id=${process.env.UNSPLASH_ACCESS_KEY}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
      const data = await res.json();
      console.log(`[Image] Unsplash status: ${res.status}, results: ${data.results?.length || 0}`);
      if (data.results && data.results.length > 0) {
        // Prendre la 2ème image si disponible (souvent plus pertinente)
        const idx = data.results.length > 1 ? 1 : 0;
        const imgUrl = data.results[idx].urls.regular;
        console.log(`[Image] URL trouvée: ${imgUrl.substring(0, 60)}...`);
        return imgUrl;
      }
      // Si pas de résultat avec le titre complet, essayer avec juste le premier mot
      if (query.includes(' ')) {
        const shortQuery = encodeURIComponent(query.split(' ')[0] + ' food');
        const url2 = `https://api.unsplash.com/search/photos?query=${shortQuery}&per_page=1&orientation=landscape&client_id=${process.env.UNSPLASH_ACCESS_KEY}`;
        const res2 = await fetch(url2, { signal: AbortSignal.timeout(5000) });
        const data2 = await res2.json();
        if (data2.results && data2.results.length > 0) {
          return data2.results[0].urls.regular;
        }
      }
    } catch (e) {
      console.log('[Image] Unsplash error:', e.message);
    }
  } else {
    console.log('[Image] UNSPLASH_ACCESS_KEY non configurée');
  }

  // Fallback Pexels
  if (process.env.PEXELS_API_KEY) {
    try {
      const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query + ' food')}&per_page=1&orientation=landscape`;
      const res = await fetch(url, {
        headers: { 'Authorization': process.env.PEXELS_API_KEY },
        signal: AbortSignal.timeout(5000)
      });
      if (res.ok) {
        const data = await res.json();
        if (data.photos && data.photos.length > 0) {
          return data.photos[0].src.large2x || data.photos[0].src.large;
        }
      }
    } catch (e) {
      console.log('[Image] Pexels error:', e.message);
    }
  }

  console.log('[Image] Aucune image trouvée, retour null');
  return null;
}

// POST /api/ai/chat
router.post('/chat', authMiddleware, async (req, res) => {
  const { systemPrompt, messages } = req.body;
  if (!messages || !Array.isArray(messages))
    return res.status(400).json({ error: 'Messages requis' });
  try {
    // Enrichit le prompt avec le profil utilisateur
    const userContext = await getUserContext(req.userId);
    const enrichedPrompt = userContext
      ? `${systemPrompt || ''}\n\n${userContext}`
      : (systemPrompt || '');
    const reply = await callGroq(enrichedPrompt, messages);
    res.json({ reply });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/ai/generate-recipe
router.post('/generate-recipe', authMiddleware, async (req, res) => {
  const { query, servings = 4 } = req.body;
  if (!query) return res.status(400).json({ error: 'Query requise' });

  // Enrichit le prompt avec le profil utilisateur
  const userContext = await getUserContext(req.userId);

  const systemPrompt = `Tu es un chef cuisinier expert. Génère une recette COMPLÈTE et DÉTAILLÉE pour ${servings} personnes.
${userContext ? `\n${userContext}\n` : ''}
RÈGLES IMPORTANTES :
- Minimum 6 ingrédients avec quantités précises (ex: "250g de farine", "3 œufs", "1 cuillère à soupe d'huile d'olive")
- Minimum 5 étapes de préparation détaillées (chaque étape explique clairement comment faire)
- La description doit être appétissante et précise (2-3 phrases)
- durationMinutes doit être réaliste pour la recette

Réponds UNIQUEMENT avec un objet JSON valide, sans markdown, sans texte avant ou après :
{"id":"ID","title":"Nom complet du plat","category":"🍽️ Catégorie","imageUrl":null,"durationMinutes":30,"servings":${servings},"description":"Description appétissante de la recette.","ingredients":["250g de farine","3 œufs entiers","200ml de lait entier","50g de beurre fondu","1 pincée de sel","2 cuillères à soupe de sucre"],"steps":["Étape 1 détaillée : comment faire exactement.","Étape 2 détaillée : comment faire exactement.","Étape 3 détaillée.","Étape 4 détaillée.","Étape 5 : présentation et service."]}`;
  try {
    const text = await callGroq(systemPrompt, [{ content: query, isUser: true }]);
    const clean = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const recipe = JSON.parse(clean);
    // Garantir les types corrects
    recipe.durationMinutes = parseInt(recipe.durationMinutes) || 30;
    recipe.servings = parseInt(recipe.servings) || servings;
    recipe.title = recipe.title || 'Recette sans nom';
    recipe.description = recipe.description || '';
    recipe.ingredients = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];
    recipe.steps = Array.isArray(recipe.steps) ? recipe.steps : [];
    // Chercher une image correspondante
    recipe.imageUrl = await fetchFoodImage(recipe.title);
    res.json({ recipe });
  } catch (e) {
    res.status(500).json({ error: 'Erreur: ' + e.message });
  }
});

// GET /api/ai/stats — Nombre de recettes IA générées
router.get('/stats', authMiddleware, async (req, res) => {
  const { count, error } = await supabase
    .from('recipes')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', req.userId)
    .eq('is_ai_generated', true);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ aiRecipesCount: count || 0 });
});

// GET /api/ai/test-image?q=pasta — Tester la recherche d'image
router.get('/test-image', authMiddleware, async (req, res) => {
  const query = req.query.q || 'pasta carbonara';
  const hasUnsplash = !!process.env.UNSPLASH_ACCESS_KEY;
  const hasPexels = !!process.env.PEXELS_API_KEY;
  
  console.log('[Test] Keys:', { hasUnsplash, hasPexels });
  
  const imageUrl = await fetchFoodImage(query);
  res.json({
    query,
    imageUrl,
    keysConfigured: { unsplash: hasUnsplash, pexels: hasPexels },
    message: imageUrl ? '✅ Image trouvée' : '❌ Aucune image (vérifiez les clés API)'
  });
});

// POST /api/ai/refresh-image/:recipeId — Rafraîchir l'image d'une recette
router.post('/refresh-image/:recipeId', authMiddleware, async (req, res) => {
  const { recipeId } = req.params;
  const { title } = req.body;
  if (!title) return res.status(400).json({ error: 'Titre requis' });

  const imageUrl = await fetchFoodImage(title);
  if (!imageUrl) {
    return res.json({
      imageUrl: null,
      message: '❌ Aucune image trouvée. Vérifiez UNSPLASH_ACCESS_KEY sur Render.'
    });
  }

  // Mettre à jour dans Supabase si recipeId fourni
  if (recipeId && recipeId !== 'local') {
    const { error } = await supabase
      .from('recipes')
      .update({ image_url: imageUrl })
      .eq('id', recipeId)
      .eq('user_id', req.userId);
    if (error) console.log('[refresh-image] Supabase error:', error.message);
  }

  res.json({ imageUrl, message: '✅ Image trouvée' });
});

module.exports = router;

// POST /api/ai/generate-recipe-list — 10 recettes
router.post('/generate-recipe-list', authMiddleware, async (req, res) => {
  const { query, servings = 4 } = req.body;
  if (!query) return res.status(400).json({ error: 'Query requise' });

  const systemPrompt = `Tu es un chef cuisinier expert. Génère exactement 10 recettes COMPLÈTES et VARIÉES.

RÈGLES OBLIGATOIRES pour CHAQUE recette :
- "ingredients" : MINIMUM 6 ingrédients avec quantités précises (ex: "300g de poulet", "2 gousses d'ail", "1 cuillère à café de cumin")
- "steps" : MINIMUM 5 étapes détaillées qui expliquent vraiment comment cuisiner le plat
- "description" : 1-2 phrases appétissantes et précises
- "durationMinutes" : durée réaliste en minutes (nombre entier)
- "servings" : ${servings} (nombre entier)
- Les 10 recettes doivent être DIFFÉRENTES (pays, style, ingrédients principaux variés)

Format JSON strict — réponds UNIQUEMENT avec ce tableau, sans markdown ni texte autour :
[
  {"id":"1","title":"Nom du plat","category":"🍽️ Catégorie","imageUrl":null,"durationMinutes":30,"servings":${servings},"description":"Description appétissante.","ingredients":["300g de ...","2 gousses d'ail","1 oignon","200ml de ...","sel et poivre","huile d'olive"],"steps":["Préparer les ingrédients : ...","Faire revenir ... pendant ... minutes.","Ajouter ... et mélanger.","Laisser mijoter ... minutes.","Dresser et servir chaud."]},
  ... 9 autres recettes complètes ...
]`;

  try {
    // Appel direct avec plus de tokens pour 10 recettes complètes
    const fetch2 = (await import('node-fetch')).default;
    const listMessages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Génère 10 recettes complètes et variées pour : ${query}. Chaque recette DOIT avoir au moins 6 ingrédients et 5 étapes détaillées.` }
    ];
    const listRes = await fetch2(GROQ_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.GROQ_API_KEY}` },
      body: JSON.stringify({ model: GROQ_MODEL, messages: listMessages, max_tokens: 8000, temperature: 0.7 }),
    });
    if (!listRes.ok) throw new Error(`Groq error ${listRes.status}`);
    const listData = await listRes.json();
    const text = listData.choices[0].message.content;
    const clean = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    // Extraire le tableau JSON
    const match = clean.match(/\[[\s\S]*\]/);
    if (!match) throw new Error('Format JSON invalide');
    const recipes = JSON.parse(match[0]);
    // Assigner des IDs uniques
    recipes.forEach((r, i) => {
      r.id = `gen_${Date.now()}_${i}`;
      // Garantir les types corrects
      r.durationMinutes = parseInt(r.durationMinutes) || 30;
      r.servings = parseInt(r.servings) || servings;
      r.title = r.title || 'Recette sans nom';
      r.description = r.description || '';
      r.ingredients = Array.isArray(r.ingredients) ? r.ingredients : [];
      r.steps = Array.isArray(r.steps) ? r.steps : [];
      r.imageUrl = r.imageUrl || null;
    });
    // Chercher les images en parallèle (max 5 simultanées pour ne pas dépasser les quotas)
    const chunkSize = 5;
    for (let i = 0; i < recipes.length; i += chunkSize) {
      const chunk = recipes.slice(i, i + chunkSize);
      await Promise.all(chunk.map(async (recipe) => {
        recipe.imageUrl = await fetchFoodImage(recipe.title);
      }));
    }
    res.json({ recipes });
  } catch (e) {
    res.status(500).json({ error: 'Erreur: ' + e.message });
  }
});