const express = require('express');
const authMiddleware = require('../middleware/auth');
const supabase = require('../config/supabase');
const router = express.Router();

// POST /api/share — Créer un lien de partage
router.post('/', authMiddleware, async (req, res) => {
  const { recipeId, recipeData } = req.body;
  if (!recipeId || !recipeData) return res.status(400).json({ error: 'recipeId et recipeData requis' });

  // Créer ou récupérer le partage existant
  const { data: existing } = await supabase
    .from('shared_recipes')
    .select('share_token')
    .eq('recipe_id', recipeId)
    .eq('user_id', req.userId)
    .single();

  if (existing) return res.json({ token: existing.share_token });

  const token = Math.random().toString(36).substring(2, 10) +
                Math.random().toString(36).substring(2, 10);

  const { data, error } = await supabase
    .from('shared_recipes')
    .insert({
      user_id: req.userId,
      recipe_id: recipeId,
      share_token: token,
      recipe_data: recipeData,
    })
    .select().single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ token: data.share_token });
});

// GET /api/share/:token — Page HTML de partage (public)
router.get('/:token', async (req, res) => {
  const { data, error } = await supabase
    .from('shared_recipes')
    .select('recipe_data, created_at')
    .eq('share_token', req.params.token)
    .single();

  if (error || !data) {
    return res.status(404).send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Recette introuvable — ForkAI</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#FAF6F1;margin:0}
.box{text-align:center;padding:40px}.emoji{font-size:64px}.title{font-size:24px;font-weight:900;color:#1C1C1E;margin:16px 0 8px}
.sub{color:#8E8E93}</style></head>
<body><div class="box"><div class="emoji">😕</div>
<div class="title">Recette introuvable</div>
<div class="sub">Ce lien de partage n'existe plus ou est invalide.</div></div></body></html>`);
  }

  const r = data.recipe_data;
  const ingredientsList = (r.ingredients || []).map(i => `<li>${i}</li>`).join('');
  const stepsList = (r.steps || []).map((s, i) => `
    <div class="step">
      <div class="step-num">${i + 1}</div>
      <div class="step-text">${s}</div>
    </div>`).join('');
  const sharedDate = new Date(data.created_at).toLocaleDateString('fr-FR', {day:'numeric',month:'long',year:'numeric'});
  const imageHtml = r.imageUrl ? `<img src="${r.imageUrl}" alt="${r.title}" class="hero-img">` : '';

  res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${r.title} — ForkAI</title>
  <meta property="og:title" content="${r.title}">
  <meta property="og:description" content="${r.description || ''}">
  ${r.imageUrl ? `<meta property="og:image" content="${r.imageUrl}">` : ''}
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, 'Nunito', sans-serif; background: #FAF6F1; color: #1C1C1E; min-height: 100vh; }
    .header { background: linear-gradient(135deg, #E8604A, #FF8A65); padding: 20px 24px; display: flex; align-items: center; gap: 12px; }
    .logo { font-size: 28px; }
    .app-name { color: white; font-size: 20px; font-weight: 900; }
    .app-sub { color: rgba(255,255,255,0.8); font-size: 12px; }
    .hero-img { width: 100%; max-height: 300px; object-fit: cover; display: block; }
    .container { max-width: 680px; margin: 0 auto; padding: 0 16px 40px; }
    .card { background: white; border-radius: 20px; overflow: hidden; margin-top: -20px; box-shadow: 0 8px 32px rgba(0,0,0,0.08); }
    .card-body { padding: 24px; }
    .category { display: inline-block; background: rgba(255,209,102,0.25); border-radius: 8px; padding: 4px 10px; font-size: 12px; font-weight: 700; color: #1C1C1E; margin-bottom: 10px; }
    h1 { font-size: 28px; font-weight: 900; line-height: 1.2; margin-bottom: 8px; }
    .description { color: #8E8E93; font-size: 15px; line-height: 1.5; margin-bottom: 20px; }
    .meta { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 28px; }
    .chip { background: #FAF6F1; border-radius: 10px; padding: 8px 14px; display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 700; }
    .section-title { font-size: 20px; font-weight: 800; margin-bottom: 14px; }
    .ingredients { background: #FAF6F1; border-radius: 14px; padding: 4px 0; margin-bottom: 28px; }
    .ingredients li { padding: 10px 18px; list-style: none; border-bottom: 1px solid rgba(0,0,0,0.06); display: flex; align-items: center; gap: 10px; font-size: 14px; }
    .ingredients li:last-child { border-bottom: none; }
    .ingredients li::before { content: ''; width: 7px; height: 7px; background: #E8604A; border-radius: 50%; flex-shrink: 0; }
    .step { display: flex; gap: 14px; margin-bottom: 14px; align-items: flex-start; }
    .step-num { width: 30px; height: 30px; background: #E8604A; border-radius: 50%; color: white; font-weight: 800; font-size: 13px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .step-text { font-size: 14px; line-height: 1.6; padding-top: 4px; }
    .footer { text-align: center; margin-top: 32px; padding: 20px; }
    .footer-badge { background: linear-gradient(135deg, #E8604A, #FF8A65); display: inline-flex; align-items: center; gap: 8px; padding: 10px 20px; border-radius: 20px; color: white; font-weight: 800; font-size: 14px; text-decoration: none; }
    .shared-date { color: #8E8E93; font-size: 12px; margin-top: 12px; }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo">🍴</div>
    <div><div class="app-name">ForkAI</div><div class="app-sub">Recette partagée</div></div>
  </div>
  ${imageHtml}
  <div class="container">
    <div class="card">
      <div class="card-body">
        ${r.category ? `<div class="category">${r.category}</div>` : ''}
        <h1>${r.title}</h1>
        <div class="description">${r.description || ''}</div>
        <div class="meta">
          <div class="chip">⏱ ${r.durationMinutes || 30} min</div>
          <div class="chip">👥 ${r.servings || 4} personnes</div>
        </div>
        <div class="section-title">🛒 Ingrédients</div>
        <ul class="ingredients">${ingredientsList}</ul>
        <div class="section-title">👨‍🍳 Préparation</div>
        ${stepsList}
      </div>
    </div>
    <div class="footer">
      <a class="footer-badge" href="#">🤖 Créé avec ForkAI</a>
      <div class="shared-date">Partagé le ${sharedDate}</div>
    </div>
  </div>
</body>
</html>`);
});

// GET /api/share/:token/json — Pour l'app (récupérer JSON)
router.get('/:token/json', async (req, res) => {
  const { data, error } = await supabase
    .from('shared_recipes')
    .select('recipe_data, created_at')
    .eq('share_token', req.params.token)
    .single();
  if (error || !data) return res.status(404).json({ error: 'Recette introuvable' });
  res.json({ recipe: data.recipe_data, sharedAt: data.created_at });
});

module.exports = router;