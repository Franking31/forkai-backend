const express = require('express');
const authMiddleware = require('../middleware/auth');
const supabase = require('../config/supabase');
const router = express.Router();

// GET /api/recipes/search — Recherche avancée
// Query params: q, category, maxDuration, limit
router.get('/search', authMiddleware, async (req, res) => {
  const { q = '', category, maxDuration, limit = 20 } = req.query;

  try {
    let query = supabase
      .from('recipes')
      .select('*')
      .eq('user_id', req.userId)
      .order('created_at', { ascending: false })
      .limit(parseInt(limit));

    // Filtre catégorie
    if (category && category !== 'Tout') {
      query = query.ilike('category', `%${category}%`);
    }

    // Filtre durée max
    if (maxDuration) {
      query = query.lte('duration_minutes', parseInt(maxDuration));
    }

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    // Filtre texte sur titre + ingrédients (post-fetch)
    let recipes = data;
    if (q.trim()) {
      const qLow = q.trim().toLowerCase();
      recipes = data.filter(r => {
        const titleMatch = r.title?.toLowerCase().includes(qLow);
        const ingredientMatch = Array.isArray(r.ingredients) &&
          r.ingredients.some(ing => ing?.toLowerCase().includes(qLow));
        return titleMatch || ingredientMatch;
      });
    }

    res.json({ recipes, total: recipes.length, query: q });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/recipes/categories — Catégories distinctes
router.get('/categories', authMiddleware, async (req, res) => {
  const { data, error } = await supabase
    .from('recipes')
    .select('category')
    .eq('user_id', req.userId)
    .not('category', 'is', null);

  if (error) return res.status(500).json({ error: error.message });

  const categories = [...new Set(
    data.map(r => r.category).filter(Boolean)
  )].sort();

  res.json({ categories });
});

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