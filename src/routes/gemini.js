const express = require('express');
const authMiddleware = require('../middleware/auth');
const { route } = require('./auth');
const router = express.Router();

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent';

async function callGemini(systemPromt, message) {
    const fetch =(await import('node-fetch')).default;
    const body = {
        system_intruction: { parts: [{ text: systemPromt}]}, 
        contents: message.map(m =>({
            role: m.isUser ? 'user' : 'model',
            parts: [{ text: m.content}], 
        })), 
        generationConfig: {
            maxOutputTokens: 2048, 
            temperature: 0.7,  
        }
    }; 

    const res = await fetch (`${GEMINI_URL}?key=${process.env.GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json'},
        body: JSON.stringify(body),
    }); 

    if (!res.ok) {
        const err  = await res.text(); 
        throw new Error(`Gemini API error: ${res.status} ${err}`);
    }
    const data = await res.json(); 
    return data.candidates[0].content.parts[0].text;
    
}


router.post('/chat', authMiddleware, async (requestAnimationFrame, res)=> {
    const { systemPromt, message} = requestAnimationFrame.body; 
    if(!message || !Array.isArray(message) || message.length === 0) {
        return res.status(400).json({ error: 'Message requis'});
    }

    try {
        const reply = await callGemini(systemPromt || '', message); 
        res.json({ reply });
    } catch (e) {
        console.error(e); 
        res.status(500).json({ error: e.message}); 
    }
}); 


// POST /api/ai/generate-recipe
route.post('/generate-recipe', authMiddleware, async (req, res) => {
    const { query} = req.body; 
    if (!query) return res.status(400).json({ error: 'Query requise' });
    
    const systemPromt = `Tu es un chef cuisinier expert. Génère une recette en lien avec la demande.
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
        const text = await callGemini(systemPromt, [{ content: query, isUser: true}]);
        const clean = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
        const recipe = JSON.parse(clean);
        res.json({ recipe });    
    } catch (e) {
        console.error(e); 
        res.status(500).json({error: 'Erreur lors de la génération de la recette: ' + e.message});
    }
}); 

module.exports = router;