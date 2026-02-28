const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const authRoutes       = require('./routes/auth');
const geminiRoutes     = require('./routes/gemini');
const favoritesRoutes  = require('./routes/favorites');
const recipesRoutes    = require('./routes/recipes');
const shoppingRoutes   = require('./routes/shopping');
const conversationsRoutes = require('./routes/conversations');
const ratingsRoutes    = require('./routes/ratings');
const shareRoutes      = require('./routes/share');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet());
app.use(cors({ origin: '*', methods: ['GET','POST','PUT','DELETE'] }));
app.use(express.json({ limit: '2mb' }));

// Rate limiting
const limiter    = rateLimit({ windowMs: 15*60*1000, max: 100 });
const aiLimiter  = rateLimit({ windowMs: 60*1000, max: 10 });
app.use('/api/', limiter);
app.use('/api/ai/', aiLimiter);

// Routes
app.use('/api/auth',          authRoutes);
app.use('/api/ai',            geminiRoutes);
app.use('/api/favorites',     favoritesRoutes);
app.use('/api/recipes',       recipesRoutes);
app.use('/api/shopping',      shoppingRoutes);
app.use('/api/conversations',  conversationsRoutes);
app.use('/api/ratings',        ratingsRoutes);
app.use('/api/share',          shareRoutes);

// Health
app.get('/health', (_, res) => res.json({ status: 'ok', app: 'ForkAI Backend' }));

// 404
app.use((req, res) => res.status(404).json({ error: 'Route non trouvée' }));

// Erreurs
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Erreur serveur' });
});

app.listen(PORT, () => console.log(`🍴 ForkAI Backend sur port ${PORT}`));