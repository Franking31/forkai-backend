const express = require('express');
const authMiddleware = require('../middleware/auth');
const supabase = require('../config/supabase');
const router = express.Router();

// ═══════════════════════════════════════════
//  USER PREFERENCES — IA qui apprend
//
//  Stocke et met à jour le profil utilisateur :
//  • goûts dominants (catégories aimées/ignorées)
//  • temps moyen de cuisine
//  • budget moyen
//  • restrictions alimentaires
//  • plats ignorés / évités
// ═══════════════════════════════════════════

// ── GET /api/prefs — Récupérer le profil ──
router.get('/', authMiddleware, async (req, res) => {
  const { data, error } = await supabase
    .from('user_preferences')
    .select('*')
    .eq('user_id', req.userId)
    .single();

  if (error && error.code !== 'PGRST116') {
    return res.status(500).json({ error: error.message });
  }

  // Retourne un profil vide si pas encore créé
  res.json({ prefs: data || _defaultPrefs(req.userId) });
});

// ── PUT /api/prefs — Mettre à jour ─────────
router.put('/', authMiddleware, async (req, res) => {
  const updates = req.body;

  const { data: existing } = await supabase
    .from('user_preferences')
    .select('id')
    .eq('user_id', req.userId)
    .single();

  let result;
  if (existing) {
    const { data, error } = await supabase
      .from('user_preferences')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('user_id', req.userId)
      .select().single();
    if (error) return res.status(500).json({ error: error.message });
    result = data;
  } else {
    const { data, error } = await supabase
      .from('user_preferences')
      .insert({ user_id: req.userId, ..._defaultPrefs(req.userId), ...updates })
      .select().single();
    if (error) return res.status(500).json({ error: error.message });
    result = data;
  }

  res.json({ prefs: result });
});

// ── POST /api/prefs/track — Tracking silencieux ──
// Appelé automatiquement après chaque interaction
router.post('/track', authMiddleware, async (req, res) => {
  const { event, data: eventData } = req.body;
  // events: 'recipe_saved', 'recipe_ignored', 'recipe_viewed', 'recipe_cooked'

  try {
    const { data: prefs } = await supabase
      .from('user_preferences')
      .select('*')
      .eq('user_id', req.userId)
      .single();

    const current = prefs || _defaultPrefs(req.userId);
    const updated = _processEvent(current, event, eventData);

    await supabase
      .from('user_preferences')
      .upsert({ ...updated, user_id: req.userId, updated_at: new Date().toISOString() });

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/prefs/surprise — Recette surprise ──
router.post('/surprise', authMiddleware, async (req, res) => {
  const Groq = require('node-fetch');

  const { data: prefs } = await supabase
    .from('user_preferences')
    .select('*')
    .eq('user_id', req.userId)
    .single();

  const profile = prefs || _defaultPrefs(req.userId);
  const context = _buildProfileContext(profile);

  const systemPrompt = `Tu es un chef créatif et surprenant.
${context}

MISSION : Génère une recette ORIGINALE et INATTENDUE qui :
- Respecte les restrictions alimentaires de l'utilisateur
- Est cohérente avec son niveau de cuisine
- Le sort de sa zone de confort SANS le brusquer
- Évite absolument les plats qu'il ignore habituellement

Réponds UNIQUEMENT avec un objet JSON valide :
{"id":"surprise_${Date.now()}","title":"Nom original","category":"🍽️ Catégorie","imageUrl":null,"durationMinutes":30,"servings":2,"description":"Description appétissante.","ingredients":["ingrédient 1","ingrédient 2"],"steps":["étape 1","étape 2"],"surpriseFact":"Fait amusant sur cette recette ou pourquoi elle est surprenante"}`;

  try {
    const fetch = (await import('node-fetch')).default;
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 1500,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: 'Surprends-moi avec quelque chose d\'original !' },
        ],
      }),
    });

    const groqData = await groqRes.json();
    const text = groqData.choices?.[0]?.message?.content || '';
    const clean = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const recipe = JSON.parse(clean);
    res.json({ recipe });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/prefs/context — Contexte IA ───
// Utilisé par gemini_route pour enrichir les prompts
router.get('/context', authMiddleware, async (req, res) => {
  const { data: prefs } = await supabase
    .from('user_preferences')
    .select('*')
    .eq('user_id', req.userId)
    .single();

  const context = _buildProfileContext(prefs || _defaultPrefs(req.userId));
  res.json({ context });
});

// ═══════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════

function _defaultPrefs(userId) {
  return {
    user_id: userId,
    // Goûts
    liked_categories: [],      // ex: ['🍝 Pâtes', '🍗 Viande']
    disliked_categories: [],
    ignored_recipes: [],       // titres de recettes jamais cliquées
    // Restrictions
    dietary_restrictions: [],  // ex: ['végétarien', 'sans gluten']
    allergies: [],
    // Stats calculées
    avg_cook_time: null,       // minutes moyennes
    avg_budget: null,          // € moyen par repas
    dominant_cuisine: null,    // cuisine la plus cuisinée
    skill_level: 'débutant',   // débutant / intermédiaire / avancé
    // Objectif
    goal: null,                // null / perte_poids / prise_masse / budget / rapide / gastro
    // Compteurs
    total_recipes_saved: 0,
    total_recipes_cooked: 0,
    last_active: null,
  };
}

function _processEvent(prefs, event, data) {
  const updated = { ...prefs };

  switch (event) {
    case 'recipe_saved':
      updated.total_recipes_saved = (updated.total_recipes_saved || 0) + 1;
      if (data?.category && !updated.liked_categories.includes(data.category)) {
        updated.liked_categories = [...(updated.liked_categories || []), data.category].slice(-10);
      }
      if (data?.durationMinutes) {
        const times = updated._cook_times || [];
        times.push(data.durationMinutes);
        updated._cook_times = times.slice(-20);
        updated.avg_cook_time = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
      }
      // Niveau skill : si souvent des recettes > 45min → intermédiaire
      if (updated.avg_cook_time > 45) updated.skill_level = 'intermédiaire';
      if (updated.avg_cook_time > 75) updated.skill_level = 'avancé';
      break;

    case 'recipe_ignored':
      if (data?.title) {
        updated.ignored_recipes = [...(updated.ignored_recipes || []), data.title].slice(-30);
      }
      if (data?.category) {
        const count = (updated._ignored_cat_count || {})[data.category] || 0;
        updated._ignored_cat_count = { ...(updated._ignored_cat_count || {}), [data.category]: count + 1 };
        // Si ignorée 3+ fois → catégorie non aimée
        if (count + 1 >= 3 && !updated.disliked_categories.includes(data.category)) {
          updated.disliked_categories = [...(updated.disliked_categories || []), data.category];
        }
      }
      break;

    case 'recipe_cooked':
      updated.total_recipes_cooked = (updated.total_recipes_cooked || 0) + 1;
      if (data?.category) {
        const catCount = (updated._cat_count || {});
        catCount[data.category] = (catCount[data.category] || 0) + 1;
        updated._cat_count = catCount;
        // Cuisine dominante = catégorie la plus cuisinée
        updated.dominant_cuisine = Object.entries(catCount)
          .sort(([, a], [, b]) => b - a)[0]?.[0] || null;
      }
      break;
  }

  updated.last_active = new Date().toISOString();
  return updated;
}

function _buildProfileContext(prefs) {
  if (!prefs) return '';

  const lines = ['PROFIL UTILISATEUR (adapte ta réponse en fonction) :'];

  if (prefs.skill_level) lines.push(`- Niveau cuisine : ${prefs.skill_level}`);
  if (prefs.avg_cook_time) lines.push(`- Temps moyen de cuisine : ${prefs.avg_cook_time} min`);
  if (prefs.dominant_cuisine) lines.push(`- Cuisine favorite : ${prefs.dominant_cuisine}`);
  if (prefs.goal) lines.push(`- Objectif : ${prefs.goal}`);

  if (prefs.liked_categories?.length > 0)
    lines.push(`- Aime cuisiner : ${prefs.liked_categories.slice(-5).join(', ')}`);
  if (prefs.disliked_categories?.length > 0)
    lines.push(`- N'aime pas : ${prefs.disliked_categories.join(', ')}`);
  if (prefs.dietary_restrictions?.length > 0)
    lines.push(`- Restrictions : ${prefs.dietary_restrictions.join(', ')}`);
  if (prefs.allergies?.length > 0)
    lines.push(`- Allergies : ${prefs.allergies.join(', ')}`);
  if (prefs.ignored_recipes?.length > 0)
    lines.push(`- Évite ces plats : ${prefs.ignored_recipes.slice(-5).join(', ')}`);
  if (prefs.avg_budget)
    lines.push(`- Budget moyen : ${prefs.avg_budget}€ par repas`);

  return lines.join('\n');
}

module.exports = router;
module.exports.buildProfileContext = _buildProfileContext;