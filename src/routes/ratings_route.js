const express = require('express');
const authMiddleware = require('../middleware/auth');
const supabase = require('../config/supabase');
const router = express.Router();

// GET /api/ratings/:recipeId — Note + commentaires d'une recette
router.get('/:recipeId', async (req, res) => {
  const { recipeId } = req.params;

  const { data: ratings, error } = await supabase
    .from('recipe_ratings')
    .select('id, user_id, rating, comment, user_email, created_at')
    .eq('recipe_id', recipeId)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  const avg = ratings.length > 0
    ? ratings.reduce((s, r) => s + r.rating, 0) / ratings.length
    : 0;

  res.json({
    ratings,
    stats: {
      average: Math.round(avg * 10) / 10,
      count: ratings.length,
    }
  });
});

// POST /api/ratings/:recipeId — Ajouter ou modifier sa note
router.post('/:recipeId', authMiddleware, async (req, res) => {
  const { recipeId } = req.params;
  const { rating, comment, userEmail } = req.body;

  if (!rating || rating < 1 || rating > 5)
    return res.status(400).json({ error: 'Note entre 1 et 5 requise' });

  // Upsert : 1 note par user par recette
  const { data, error } = await supabase
    .from('recipe_ratings')
    .upsert({
      user_id: req.userId,
      recipe_id: recipeId,
      rating: parseInt(rating),
      comment: comment?.trim() || null,
      user_email: userEmail || 'Anonyme',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,recipe_id' })
    .select().single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ rating: data });
});

// DELETE /api/ratings/:recipeId — Supprimer sa note
router.delete('/:recipeId', authMiddleware, async (req, res) => {
  const { error } = await supabase
    .from('recipe_ratings')
    .delete()
    .eq('recipe_id', req.params.recipeId)
    .eq('user_id', req.userId);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: 'Note supprimée' });
});

module.exports = router;