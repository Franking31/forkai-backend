const express = require('express');
const authMiddleware = require('../middleware/auth');
const supabase = require('../config/supabase');
const router = express.Router();

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';

async function callGroq(systemPrompt, messages) {
  const fetch = (await import('node-fetch')).default;
  const formatted = [
    { role: 'system', content: systemPrompt || 'Tu es un assistant cuisinier expert.' },
    ...messages.map(m => ({ role: m.isUser ? 'user' : 'assistant', content: m.content })),
  ];
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.GROQ_API_KEY}` },
    body: JSON.stringify({ model: GROQ_MODEL, messages: formatted, max_tokens: 2048, temperature: 0.8 }),
  });
  if (!res.ok) throw new Error(`Groq error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices[0].message.content;
}

// ── Recherche d'image via Unsplash ────────────
async function fetchFoodImage(title) {
  const fetch = (await import('node-fetch')).default;
  
  // Nettoyer le titre : enlever emojis, traduire si besoin
  const query = title
    .replace(/[\u{1F300}-\u{1FFFF}]/gu, '')
    .replace(/[🍽️🍴]/g, '')
    .trim();

  // 1. Essayer Unsplash (nécessite UNSPLASH_ACCESS_KEY dans les variables Render)
  if (process.env.UNSPLASH_ACCESS_KEY) {
    try {
      const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query + ' food dish')}&per_page=1&orientation=landscape&client_id=${process.env.UNSPLASH_ACCESS_KEY}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const data = await res.json();
        if (data.results && data.results.length > 0) {
          return data.results[0].urls.regular + '&w=600&q=80';
        }
      }
    } catch (e) {
      console.log('Unsplash error:', e.message);
    }
  }

  // 2. Fallback : Pexels (nécessite PEXELS_API_KEY)
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
          return data.photos[0].src.large;
        }
      }
    } catch (e) {
      console.log('Pexels error:', e.message);
    }
  }

  // 3. Fallback statique : Unsplash source (pas de clé, mais deprecated)
  try {
    const url = `https://source.unsplash.com/600x400/?${encodeURIComponent(query + ',food')}`;
    const res = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: AbortSignal.timeout(4000)
    });
    if (res.ok && res.url && res.url.includes('unsplash.com/photo')) {
      return res.url;
    }
  } catch (e) {
    console.log('Unsplash source error:', e.message);
  }

  return null; // Pas d'image trouvée
}

// POST /api/ai/chat
router.post('/chat', authMiddleware, async (req, res) => {
  const { systemPrompt, messages } = req.body;
  if (!messages || !Array.isArray(messages))
    return res.status(400).json({ error: 'Messages requis' });
  try {
    const reply = await callGroq(systemPrompt || '', messages);
    res.json({ reply });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/ai/generate-recipe
router.post('/generate-recipe', authMiddleware, async (req, res) => {
  const { query, servings = 4 } = req.body;
  if (!query) return res.status(400).json({ error: 'Query requise' });
  const systemPrompt = `Tu es un chef cuisinier expert. Génère une recette pour ${servings} personnes.
Réponds UNIQUEMENT avec un objet JSON valide, sans markdown, sans commentaire:
{"id":"gen_${Date.now()}","title":"Nom","category":"🍽️ Catégorie","imageUrl":null,"durationMinutes":30,"servings":${servings},"description":"Description.","ingredients":["200g de ..."],"steps":["Étape 1."]}`;
  try {
    const text = await callGroq(systemPrompt, [{ content: query, isUser: true }]);
    const clean = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const recipe = JSON.parse(clean);
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

module.exports = router;

// POST /api/ai/generate-recipe-list — 10 recettes
router.post('/generate-recipe-list', authMiddleware, async (req, res) => {
  const { query, servings = 4 } = req.body;
  if (!query) return res.status(400).json({ error: 'Query requise' });

  const systemPrompt = `Tu es un chef cuisinier expert. Génère exactement 10 recettes variées en lien avec la demande.
Réponds UNIQUEMENT avec un tableau JSON valide, sans markdown, sans commentaire, sans texte avant ou après.
Chaque recette doit avoir cette structure exacte :
{"id":"gen_${Date.now()}_INDEX","title":"Nom","category":"🍽️ Catégorie","imageUrl":null,"durationMinutes":30,"servings":${servings},"description":"Description courte.","ingredients":["200g de ..."],"steps":["Étape 1."]}
Retourne un tableau de 10 objets : [recette1, recette2, ..., recette10]
Les recettes doivent être VARIÉES (différents pays, styles, ingrédients principaux).`;

  try {
    const text = await callGroq(systemPrompt, [{ content: `Génère 10 recettes variées pour : ${query}`, isUser: true }]);
    const clean = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    // Extraire le tableau JSON
    const match = clean.match(/\[[\s\S]*\]/);
    if (!match) throw new Error('Format JSON invalide');
    const recipes = JSON.parse(match[0]);
    // Assigner des IDs uniques
    recipes.forEach((r, i) => { r.id = `gen_${Date.now()}_${i}`; });
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