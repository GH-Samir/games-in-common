const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const { getPlayerSummariesCached, getOwnedGamesCached, getFriendList, FriendsListPrivateError } = require('../services/steamApi');
const { getCommonGamesForUser, getGroupCommonGames } = require('../services/commonGames');
const configStore = require('../services/configStore');
const groupStore = require('../services/groupStore');
const chestStore = require('../services/chestStore');
const steamStore = require('../services/steamStore');
const discovery = require('../services/discovery');

const router = express.Router();

// Gabe Newell's public steamid — a stable id to sanity-check a candidate API key against.
const TEST_STEAMID = '76561197960435530';

router.post('/config/steam-key', async (req, res) => {
  // Reachable without a session only for first-run setup, before a key exists.
  // Once a key is configured, changing it requires an authenticated session so
  // that anyone who can merely reach the server can't silently swap it out.
  const alreadyConfigured = Boolean(configStore.getConfig().steamApiKey);
  if (alreadyConfigured && !req.session?.steamid) {
    return res.status(401).json({ error: 'not-authenticated', message: 'Sign in before changing the configured API key.' });
  }

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

router.get('/common-games/stream', requireAuth, async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  // If the client disconnects mid-stream (closes the tab, navigates away),
  // writing to the socket afterward throws an unhandled 'error' event that
  // would otherwise crash the whole process — guard against both halves.
  let closed = false;
  req.on('close', () => { closed = true; });
  res.on('error', () => {});

  const send = (payload) => {
    if (closed) return;
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  try {
    const data = await getCommonGamesForUser(req.session.steamid, (completed, total) => {
      send({ type: 'progress', completed, total });
    });
    send({ type: 'done', data });
  } catch (err) {
    if (err instanceof FriendsListPrivateError) {
      send({ type: 'friends-private' });
    } else {
      console.error('GET /api/common-games/stream failed:', err);
      send({ type: 'error', message: err.message });
    }
  }

  if (!closed) res.end();
});

router.get('/friends', requireAuth, async (req, res) => {
  try {
    const friendIds = await getFriendList(req.session.steamid);
    const summaries = await getPlayerSummariesCached(friendIds);
    const friends = friendIds.map((steamid) => {
      const summary = summaries.get(steamid);
      return {
        steamid,
        name: summary?.personaname ?? 'Unknown',
        avatar: summary?.avatarmedium ?? null,
      };
    });
    res.json({ friends });
  } catch (err) {
    if (err instanceof FriendsListPrivateError) {
      return res.status(200).json({ error: 'friends-private' });
    }
    console.error('GET /api/friends failed:', err);
    res.status(500).json({ error: 'internal-error', message: err.message });
  }
});

router.get('/currencies', requireAuth, (req, res) => {
  res.json({ currencies: steamStore.CURRENCIES });
});

router.get('/friends/:steamid/recommendations', requireAuth, async (req, res) => {
  try {
    const friendId = req.params.steamid;
    const friendIds = await getFriendList(req.session.steamid);
    if (!friendIds.includes(friendId)) {
      return res.status(400).json({ error: 'not-a-friend', message: 'That steamid is not in your friends list.' });
    }

    const currency = steamStore.CURRENCIES.some((c) => c.code === req.query.currency) ? req.query.currency : 'GBP';
    const cc = steamStore.currencyToCc(currency);

    const maxPriceMajor = Number(req.query.maxPrice);
    if (!Number.isFinite(maxPriceMajor) || maxPriceMajor < 0) {
      return res.status(400).json({ error: 'invalid-budget', message: 'maxPrice must be a non-negative number.' });
    }
    const maxPriceMinor = Math.round(maxPriceMajor * 100);

    const seenAppIds = (req.query.seen || '').split(',').map((s) => s.trim()).filter(Boolean);
    const multiplayerOnly = req.query.multiplayerOnly === 'true';

    const data = await discovery.discoverGames({
      steamids: [req.session.steamid, friendId],
      maxPriceMinor,
      cc,
      seenAppIds,
      multiplayerOnly,
    });

    res.json(data);
  } catch (err) {
    if (err instanceof FriendsListPrivateError) {
      return res.status(400).json({ error: 'friends-private', message: 'Your friends list is private.' });
    }
    console.error('GET /api/friends/:steamid/recommendations failed:', err);
    res.status(500).json({ error: 'internal-error', message: err.message });
  }
});

router.get('/groups/:id/recommendations', requireAuth, async (req, res) => {
  try {
    const group = groupStore.listGroups(req.session.steamid).find((g) => g.id === req.params.id);
    if (!group) {
      return res.status(404).json({ error: 'not-found', message: 'Group not found.' });
    }

    const currency = steamStore.CURRENCIES.some((c) => c.code === req.query.currency) ? req.query.currency : 'GBP';
    const cc = steamStore.currencyToCc(currency);

    const maxPriceMajor = Number(req.query.maxPrice);
    if (!Number.isFinite(maxPriceMajor) || maxPriceMajor < 0) {
      return res.status(400).json({ error: 'invalid-budget', message: 'maxPrice must be a non-negative number.' });
    }
    const maxPriceMinor = Math.round(maxPriceMajor * 100);

    const seenAppIds = (req.query.seen || '').split(',').map((s) => s.trim()).filter(Boolean);
    const multiplayerOnly = req.query.multiplayerOnly === 'true';

    const data = await discovery.discoverGames({
      steamids: [req.session.steamid, ...group.members],
      maxPriceMinor,
      cc,
      seenAppIds,
      multiplayerOnly,
    });

    res.json(data);
  } catch (err) {
    console.error('GET /api/groups/:id/recommendations failed:', err);
    res.status(500).json({ error: 'internal-error', message: err.message });
  }
});

router.get('/chest', requireAuth, async (req, res) => {
  try {
    const currency = steamStore.CURRENCIES.some((c) => c.code === req.query.currency) ? req.query.currency : 'GBP';
    const cc = steamStore.currencyToCc(currency);

    const entries = chestStore.listChest(req.session.steamid);
    const games = await Promise.all(entries.map(async (entry) => {
      const details = await steamStore.getAppDetails(entry.appid, cc).catch(() => null);
      return {
        appid: entry.appid,
        savedAt: entry.savedAt,
        name: details?.name ?? `App ${entry.appid}`,
        headerImage: details?.header_image ?? null,
        isFree: Boolean(details?.is_free),
        price: details?.price_overview ? {
          currency: details.price_overview.currency,
          finalMinor: details.price_overview.final,
          initialMinor: details.price_overview.initial,
          discountPercent: details.price_overview.discount_percent,
          finalFormatted: details.price_overview.final_formatted,
        } : null,
        storeUrl: `https://store.steampowered.com/app/${entry.appid}`,
      };
    }));

    res.json({ games });
  } catch (err) {
    console.error('GET /api/chest failed:', err);
    res.status(500).json({ error: 'internal-error', message: err.message });
  }
});

router.post('/chest', requireAuth, (req, res) => {
  const appid = Number(req.body?.appid);
  if (!Number.isInteger(appid) || appid <= 0) {
    return res.status(400).json({ error: 'invalid-appid', message: 'A valid appid is required.' });
  }
  chestStore.addToChest(req.session.steamid, appid);
  res.status(201).json({ ok: true });
});

router.delete('/chest/:appid', requireAuth, (req, res) => {
  const appid = Number(req.params.appid);
  if (!Number.isInteger(appid) || appid <= 0) {
    return res.status(400).json({ error: 'invalid-appid', message: 'A valid appid is required.' });
  }
  chestStore.removeFromChest(req.session.steamid, appid);
  res.json({ ok: true });
});

async function enrichGroup(group) {
  const summaries = await getPlayerSummariesCached(group.members);
  return {
    id: group.id,
    name: group.name,
    size: group.size,
    capacity: groupStore.CAPACITY[group.size],
    memberCount: group.members.length,
    createdAt: group.createdAt,
    members: group.members.map((steamid) => {
      const summary = summaries.get(steamid);
      return {
        steamid,
        name: summary?.personaname ?? 'Unknown',
        avatar: summary?.avatarmedium ?? null,
      };
    }),
  };
}

router.get('/groups', requireAuth, async (req, res) => {
  try {
    const groups = groupStore.listGroups(req.session.steamid);
    res.json({ groups: await Promise.all(groups.map(enrichGroup)) });
  } catch (err) {
    console.error('GET /api/groups failed:', err);
    res.status(500).json({ error: 'internal-error', message: err.message });
  }
});

router.post('/groups', requireAuth, async (req, res) => {
  try {
    const group = groupStore.createGroup(req.session.steamid, req.body || {});
    res.status(201).json(await enrichGroup(group));
  } catch (err) {
    if (err instanceof groupStore.GroupError) {
      return res.status(400).json({ error: err.code, message: err.message });
    }
    console.error('POST /api/groups failed:', err);
    res.status(500).json({ error: 'internal-error', message: err.message });
  }
});

router.patch('/groups/:id', requireAuth, async (req, res) => {
  try {
    const group = groupStore.renameGroup(req.session.steamid, req.params.id, req.body?.name);
    res.json(await enrichGroup(group));
  } catch (err) {
    if (err instanceof groupStore.GroupError) {
      return res.status(err.code === 'not-found' ? 404 : 400).json({ error: err.code, message: err.message });
    }
    console.error('PATCH /api/groups/:id failed:', err);
    res.status(500).json({ error: 'internal-error', message: err.message });
  }
});

router.delete('/groups/:id', requireAuth, (req, res) => {
  try {
    groupStore.deleteGroup(req.session.steamid, req.params.id);
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof groupStore.GroupError) {
      return res.status(404).json({ error: err.code, message: err.message });
    }
    console.error('DELETE /api/groups/:id failed:', err);
    res.status(500).json({ error: 'internal-error', message: err.message });
  }
});

router.post('/groups/:id/members', requireAuth, async (req, res) => {
  try {
    const steamid = req.body?.steamid;
    if (!steamid) {
      return res.status(400).json({ error: 'missing-steamid', message: 'steamid is required.' });
    }

    const friendIds = await getFriendList(req.session.steamid);
    if (!friendIds.includes(steamid)) {
      return res.status(400).json({ error: 'not-a-friend', message: 'That steamid is not in your friends list.' });
    }

    const group = groupStore.addMember(req.session.steamid, req.params.id, steamid);
    res.json(await enrichGroup(group));
  } catch (err) {
    if (err instanceof FriendsListPrivateError) {
      return res.status(400).json({ error: 'friends-private', message: 'Your friends list is private.' });
    }
    if (err instanceof groupStore.GroupError) {
      return res.status(err.code === 'not-found' ? 404 : 400).json({ error: err.code, message: err.message });
    }
    console.error('POST /api/groups/:id/members failed:', err);
    res.status(500).json({ error: 'internal-error', message: err.message });
  }
});

router.delete('/groups/:id/members/:steamid', requireAuth, async (req, res) => {
  try {
    const group = groupStore.removeMember(req.session.steamid, req.params.id, req.params.steamid);
    res.json(await enrichGroup(group));
  } catch (err) {
    if (err instanceof groupStore.GroupError) {
      return res.status(404).json({ error: err.code, message: err.message });
    }
    console.error('DELETE /api/groups/:id/members/:steamid failed:', err);
    res.status(500).json({ error: 'internal-error', message: err.message });
  }
});

router.get('/groups/:id/common-games/stream', requireAuth, async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  let closed = false;
  req.on('close', () => { closed = true; });
  res.on('error', () => {});

  const send = (payload) => {
    if (closed) return;
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  try {
    const group = groupStore.listGroups(req.session.steamid).find((g) => g.id === req.params.id);
    if (!group) {
      send({ type: 'error', message: 'Group not found' });
      if (!closed) res.end();
      return;
    }

    const data = await getGroupCommonGames(req.session.steamid, group.members, (completed, total) => {
      send({ type: 'progress', completed, total });
    });
    send({ type: 'done', data });
  } catch (err) {
    console.error('GET /api/groups/:id/common-games/stream failed:', err);
    send({ type: 'error', message: err.message });
  }

  if (!closed) res.end();
});

module.exports = router;
