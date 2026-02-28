const express = require('express');
const authMiddleware = require('../middleware/auth');
const supabase = require('../config/supabase');
const router = express.Router();

// POST /api/share — Créer un lien de partage
router.post('/', authMiddleware, async (req, res) => {
  const { recipeId, recipeData } = req.body;
  if (!recipeId || !recipeData) return res.status(400).json({ error: 'recipeId et recipeData requis' });

  // Créer ou récupérer le partage existant
  const { data: existing } = await supabase
    .from('shared_recipes')
    .select('share_token')
    .eq('recipe_id', recipeId)
    .eq('user_id', req.userId)
    .single();

  if (existing) return res.json({ token: existing.share_token });

  const token = Math.random().toString(36).substring(2, 10) +
                Math.random().toString(36).substring(2, 10);

  const { data, error } = await supabase
    .from('shared_recipes')
    .insert({
      user_id: req.userId,
      recipe_id: recipeId,
      share_token: token,
      recipe_data: recipeData,
    })
    .select().single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ token: data.share_token });
});

// GET /api/share/:token — Récupérer une recette partagée (public)
router.get('/:token', async (req, res) => {
  const { data, error } = await supabase
    .from('shared_recipes')
    .select('recipe_data, created_at')
    .eq('share_token', req.params.token)
    .single();

  if (error || !data) return res.status(404).json({ error: 'Recette introuvable' });
  res.json({ recipe: data.recipe_data, sharedAt: data.created_at });
});

module.exports = router;