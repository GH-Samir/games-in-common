const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const { getPlayerSummariesCached, getOwnedGamesCached, FriendsListPrivateError } = require('../services/steamApi');
const { getCommonGamesForUser } = require('../services/commonGames');

const router = express.Router();

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
