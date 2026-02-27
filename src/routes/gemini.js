const express = require('express');
const authMiddleware = require('../middleware/auth');
const router = express.Router();

// ── Groq API (compatible OpenAI) ─────────────
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile'; // Rapide + gratuit + très capable

async function callGroq(systemPrompt, messages) {
  const fetch = (await import('node-fetch')).default;

  const formattedMessages = [
    { role: 'system', content: systemPrompt || 'Tu es un assistant cuisinier expert.' },
    ...messages.map(m => ({
      role: m.isUser ? 'user' : 'assistant',
      content: m.content,
    })),
  ];

  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: formattedMessages,
      max_tokens: 2048,
      temperature: 0.8,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Groq error ${res.status}: ${err}`);
  }

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
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/ai/generate-recipe
router.post('/generate-recipe', authMiddleware, async (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: 'Query requise' });

  const systemPrompt = `Tu es un chef cuisinier expert. Génère une recette en lien avec la demande.
Réponds UNIQUEMENT avec un objet JSON valide, sans markdown, sans commentaire, dans ce format exact :
{
  "id": "gen_${Date.now()}",
  "title": "Nom de la recette",
  "category": "🍽️ Catégorie",
  "imageUrl": null,
  "durationMinutes": 30,
  "servings": 4,
  "description": "Description courte et appétissante en 1-2 phrases.",
  "ingredients": ["200g de ...", "3 ..."],
  "steps": ["Étape 1 détaillée.", "Étape 2."]
}`;

  try {
    const text = await callGroq(systemPrompt, [{ content: query, isUser: true }]);
    const clean = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const recipe = JSON.parse(clean);
    res.json({ recipe });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur génération recette: ' + e.message });
  }
});

module.exports = router;