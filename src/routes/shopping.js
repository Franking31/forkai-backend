const express = require('express');
const authMiddleware = require('../middleware/auth');
const supabase = require('../config/supabase');
const router = express.Router();

// GET /api/shopping — Récupérer la liste active
router.get('/', authMiddleware, async (req, res) => {
  const { data, error } = await supabase
    .from('shopping_lists')
    .select('*')
    .eq('user_id', req.userId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .single();

  if (error && error.code !== 'PGRST116')
    return res.status(500).json({ error: error.message });

  res.json({ list: data || null });
});

// POST /api/shopping — Sauvegarder la liste
router.post('/', authMiddleware, async (req, res) => {
  const { id, name, items } = req.body;

  if (id) {
    const { data, error } = await supabase
      .from('shopping_lists')
      .update({ name, items, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', req.userId)
      .select().single();

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ list: data });
  }

  const { data, error } = await supabase
    .from('shopping_lists')
    .insert({
      user_id: req.userId,
      name: name || 'Ma liste de courses',
      items: items || [],
    })
    .select().single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ list: data });
});

module.exports = router;