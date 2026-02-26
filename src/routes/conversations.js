const express = require('express');
const authMiddleware = require('../middleware/auth');
const supabase = require('../config/supabase');
const router = express.Router();

// GET /api/conversations
router.get('/', authMiddleware, async (req, res) => {
  const { data, error } = await supabase
    .from('ai_conversations')
    .select('id, mode, title, created_at, updated_at')
    .eq('user_id', req.userId)
    .order('updated_at', { ascending: false })
    .limit(50);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ conversations: data });
});

// GET /api/conversations/:id
router.get('/:id', authMiddleware, async (req, res) => {
  const { data, error } = await supabase
    .from('ai_conversations')
    .select('*')
    .eq('id', req.params.id)
    .eq('user_id', req.userId)
    .single();

  if (error) return res.status(404).json({ error: 'Conversation introuvable' });
  res.json({ conversation: data });
});

// POST /api/conversations — Créer ou mettre à jour
router.post('/', authMiddleware, async (req, res) => {
  const { id, mode, title, messages } = req.body;

  if (id) {
    // Mise à jour
    const { data, error } = await supabase
      .from('ai_conversations')
      .update({ messages, title, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', req.userId)
      .select().single();

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ conversation: data });
  }

  // Création
  const { data, error } = await supabase
    .from('ai_conversations')
    .insert({
      user_id: req.userId,
      mode: mode || 'chat',
      title: title || 'Nouvelle conversation',
      messages: messages || [],
    })
    .select().single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ conversation: data });
});

// DELETE /api/conversations/:id
router.delete('/:id', authMiddleware, async (req, res) => {
  const { error } = await supabase
    .from('ai_conversations')
    .delete()
    .eq('id', req.params.id)
    .eq('user_id', req.userId);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: 'Conversation supprimée' });
});

module.exports = router;