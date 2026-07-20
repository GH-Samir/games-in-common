const express = require('express');
const { buildLoginUrl, verifyAndExtractSteamId } = require('../services/steamOpenId');

const router = express.Router();

router.get('/steam', (req, res) => {
  const baseUrl = process.env.BASE_URL;
  res.redirect(buildLoginUrl(baseUrl));
});

router.get('/steam/return', async (req, res) => {
  try {
    const steamid = await verifyAndExtractSteamId(req.query);
    req.session.steamid = steamid;
    res.redirect('/');
  } catch (err) {
    res.status(401).send(`Steam login failed: ${err.message}`);
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

module.exports = router;
