const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const { getPlayerSummariesCached, getOwnedGamesCached, FriendsListPrivateError } = require('../services/steamApi');
const { getCommonGamesForUser } = require('../services/commonGames');
const configStore = require('../services/configStore');

const router = express.Router();

// Gabe Newell's public steamid — a stable id to sanity-check a candidate API key against.
const TEST_STEAMID = '76561197960435530';

router.post('/config/steam-key', async (req, res) => {
  const key = (req.body?.steamApiKey || '').trim();
  if (!key) {
    return res.status(400).json({ error: 'missing-key', message: 'Steam API key is required.' });
  }

  try {
    const testRes = await fetch(
      `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${key}&steamids=${TEST_STEAMID}`
    );
    if (!testRes.ok) {
      return res.status(400).json({ error: 'invalid-key', message: 'Steam rejected that API key. Double-check it and try again.' });
    }
  } catch (err) {
    return res.status(502).json({ error: 'validation-failed', message: `Could not reach Steam to validate the key: ${err.message}` });
  }

  configStore.setSteamApiKey(key);
  res.json({ ok: true });
});

router.get('/me', requireAuth, async (req, res) => {
  try {
    const steamid = req.session.steamid;
    const [summaries, ownedGames] = await Promise.all([
      getPlayerSummariesCached([steamid]),
      getOwnedGamesCached(steamid),
    ]);
    const summary = summaries.get(steamid);
    res.json({
      steamid,
      name: summary?.personaname ?? 'Unknown',
      avatar: summary?.avatarmedium ?? null,
      gameCount: ownedGames.games.length,
    });
  } catch (err) {
    console.error('GET /api/me failed:', err);
    res.status(500).json({ error: 'internal-error', message: err.message });
  }
});

router.get('/common-games', requireAuth, async (req, res) => {
  try {
    const data = await getCommonGamesForUser(req.session.steamid);
    res.json(data);
  } catch (err) {
    if (err instanceof FriendsListPrivateError) {
      return res.status(200).json({ error: 'friends-private' });
    }
    console.error('GET /api/common-games failed:', err);
    res.status(500).json({ error: 'internal-error', message: err.message });
  }
});

module.exports = router;
