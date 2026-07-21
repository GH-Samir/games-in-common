require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');

const authRoutes = require('./src/routes/auth');
const apiRoutes = require('./src/routes/api');
const configStore = require('./src/services/configStore');

function createApp() {
  const app = express();

  app.use(express.json());

  app.use((req, res, next) => {
    const { steamApiKey } = configStore.getConfig();
    if (steamApiKey) return next();
    if (req.path === '/setup' || req.path === '/api/config/steam-key') return next();
    return res.redirect('/setup');
  });

  app.get('/setup', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'setup.html'));
  });

  const { sessionSecret } = configStore.getConfig();
  app.use(session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 },
  }));

  app.use(express.static(path.join(__dirname, 'public')));
  app.use('/auth', authRoutes);
  app.use('/api', apiRoutes);

  return app;
}

function startServer({ port } = {}) {
  const app = createApp();
  const PORT = port || process.env.PORT || 3000;
  const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

  return new Promise((resolve) => {
    const server = app.listen(PORT, () => {
      console.log(`Games in Common running at ${BASE_URL}`);
      resolve({ server, port: PORT, baseUrl: BASE_URL });
    });
  });
}

if (require.main === module) {
  startServer();
}

module.exports = { startServer, createApp };
