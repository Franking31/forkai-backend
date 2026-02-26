const express = require('express');
const authMiddleware = require('../middleware/auth');
const router = express.Router();

const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent`;

async function callGemini(systemPrompt, messages) {
  const fetch = (await import('node-fetch')).default;
  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: messages.map(m => ({
      role: m.isUser ? 'user' : 'model',
      parts: [{ text: m.content }],
    })),
    generationConfig: { maxOutputTokens: 2048, temperature: 0.8 },
  };

  const res = await fetch(`${GEMINI_URL}?key=${process.env.GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.candidates[0].content.parts[0].text;
}

// POST /api/ai/chat
router.post('/chat', authMiddleware, async (req, res) => {
  const { systemPrompt, messages } = req.body;
  if (!messages || !Array.isArray(messages))
    return res.status(400).json({ error: 'Messages requis' });

  try {
    const reply = await callGemini(systemPrompt || '', messages);
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
Réponds UNIQUEMENT avec un objet JSON valide, sans markdown, dans ce format exact :
{
  "id": "gen_${Date.now()}",
  "title": "Nom de la recette",
  "category": "🍽️ Catégorie",
  "imageUrl": null,
  "durationMinutes": 30,
  "servings": 4,
  "description": "Description courte et appétissante.",
  "ingredients": ["200g de ...", "3 ..."],
  "steps": ["Étape 1...", "Étape 2..."]
}`;

  try {
    const text = await callGemini(systemPrompt, [{ content: query, isUser: true }]);
    const clean = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const recipe = JSON.parse(clean);
    res.json({ recipe });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur génération recette: ' + e.message });
  }
});

module.exports = router;