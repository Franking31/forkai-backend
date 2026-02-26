const express = require('express');
const jwt = require('jsonwebtoken');
const supabase = require('../config/supabase');
const router = express.Router();

const makeToken = (userId, email) => 
     jwt.sign({userId, email}, process.env.JWT_SECRET, { expiresIn: '30d'}); 

router.post('/signup', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password)
        return res.status(400).json({ error: 'Email et mot de passe requis' });
    
    const  { data, error } = await supabase.auth.admin.createUser({
        email, password, email_confirm: true, 
    }); 
    if (error) return res.status(400).json({ error: error.message}); 

    const token = makeToken(data.user.id, email); 
    res.json({token, userId: data.user.id, email}); 
    
}); 


// POST /api/auth/login

router.post('/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password)
        return res.status(400).json({ error: 'Email et mot de passe requis' });
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return res.status(401).json({ error: 'Email ou mot de passe incorrect' });

    const token = makeToken(data.user.id, email); 
    res.json({ token, userId: data.user.id, email });
}); 

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.json({ message: 'Déconnecté avec succès' });
});

module.exports = router;


