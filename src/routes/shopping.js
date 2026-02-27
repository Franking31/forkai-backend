const express = require('express');
const authMiddleware = require('../middleware/auth');
const supabase = require('../config/supabase');
const router = express.Router();

// GET /api/shopping — Toutes les listes
router.get('/', authMiddleware, async (req, res) => {
  const { data, error } = await supabase
    .from('shopping_lists')
    .select('*')
    .eq('user_id', req.userId)
    .order('updated_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ lists: data || [] });
});

// POST /api/shopping — Créer une liste
router.post('/', authMiddleware, async (req, res) => {
  const { name, items } = req.body;
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

// PUT /api/shopping/:id — Mettre à jour une liste
router.put('/:id', authMiddleware, async (req, res) => {
  const { name, items } = req.body;
  const { data, error } = await supabase
    .from('shopping_lists')
    .update({ name, items, updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .eq('user_id', req.userId)
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ list: data });
});

// DELETE /api/shopping/:id — Supprimer une liste
router.delete('/:id', authMiddleware, async (req, res) => {
  const { error } = await supabase
    .from('shopping_lists')
    .delete()
    .eq('id', req.params.id)
    .eq('user_id', req.userId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: 'Liste supprimée' });
});

module.exports = router;