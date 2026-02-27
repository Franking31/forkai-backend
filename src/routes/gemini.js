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
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: 'Query requise' });
  const systemPrompt = `Tu es un chef cuisinier expert. Génère une recette en lien avec la demande.
Réponds UNIQUEMENT avec un objet JSON valide, sans markdown, sans commentaire:
{"id":"gen_${Date.now()}","title":"Nom","category":"🍽️ Catégorie","imageUrl":null,"durationMinutes":30,"servings":4,"description":"Description.","ingredients":["200g de ..."],"steps":["Étape 1."]}`;
  try {
    const text = await callGroq(systemPrompt, [{ content: query, isUser: true }]);
    const clean = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    res.json({ recipe: JSON.parse(clean) });
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