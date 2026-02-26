const express = require('express');
const authMiddleware = require('../middleware/auth');
const supabase = require('../config/supabase');
const router = express.Router();

// GET /api/recipes — Toutes les recettes de l'user
router.get('/', authMiddleware, async (req, res) => {
  const { data, error } = await supabase
    .from('recipes')
    .select('*')
    .eq('user_id', req.userId)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ recipes: data });
});

// POST /api/recipes — Sauvegarder une recette
router.post('/', authMiddleware, async (req, res) => {
  const { title, category, imageUrl, durationMinutes, servings,
          description, ingredients, steps, isAiGenerated } = req.body;
  if (!title) return res.status(400).json({ error: 'Titre requis' });

  const { data, error } = await supabase
    .from('recipes')
    .insert({
      user_id: req.userId,
      title, category,
      image_url: imageUrl,
      duration_minutes: durationMinutes || 30,
      servings: servings || 4,
      description, ingredients, steps,
      is_ai_generated: isAiGenerated || false,
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ recipe: data });
});

// DELETE /api/recipes/:id
router.delete('/:id', authMiddleware, async (req, res) => {
  const { error } = await supabase
    .from('recipes')
    .delete()
    .eq('id', req.params.id)
    .eq('user_id', req.userId);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: 'Recette supprimée' });
});

module.exports = router;