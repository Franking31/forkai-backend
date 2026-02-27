const express = require('express');
const authMiddleware = require('../middleware/auth');
const supabase = require('../config/supabase');
const router = express.Router();

// GET /api/favorites
router.get('/', authMiddleware, async (req, res) => {
  const { data, error } = await supabase
    .from('favorites')
    .select('*')
    .eq('user_id', req.userId)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ favorites: data });
});

// POST /api/favorites
router.post('/', authMiddleware, async (req, res) => {
  // Accepter recipeId ou recipe_id (compatibilité)
  const recipeId   = req.body.recipeId   || req.body.recipe_id;
  const recipeData = req.body.recipeData || req.body.recipe_data;

  if (!recipeId || !recipeData)
    return res.status(400).json({ error: 'recipeId et recipeData requis' });

  const { data, error } = await supabase
    .from('favorites')
    .upsert({
      user_id:     req.userId,
      recipe_id:   String(recipeId),
      recipe_data: recipeData,
    }, { onConflict: 'user_id,recipe_id' })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ favorite: data });
});

// DELETE /api/favorites/:recipeId
router.delete('/:recipeId', authMiddleware, async (req, res) => {
  const { error } = await supabase
    .from('favorites')
    .delete()
    .eq('user_id', req.userId)
    .eq('recipe_id', req.params.recipeId);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: 'Favori supprimé' });
});

module.exports = router;