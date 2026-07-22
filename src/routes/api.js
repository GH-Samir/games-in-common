const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const { getPlayerSummariesCached, getOwnedGamesCached, getFriendList, FriendsListPrivateError } = require('../services/steamApi');
const { getCommonGamesForUser, getGroupCommonGames } = require('../services/commonGames');
const configStore = require('../services/configStore');
const groupStore = require('../services/groupStore');

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

  const send = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);

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

  res.end();
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

  const send = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);

  try {
    const group = groupStore.listGroups(req.session.steamid).find((g) => g.id === req.params.id);
    if (!group) {
      send({ type: 'error', message: 'Group not found' });
      return res.end();
    }

    const data = await getGroupCommonGames(req.session.steamid, group.members, (completed, total) => {
      send({ type: 'progress', completed, total });
    });
    send({ type: 'done', data });
  } catch (err) {
    console.error('GET /api/groups/:id/common-games/stream failed:', err);
    send({ type: 'error', message: err.message });
  }

  res.end();
});

module.exports = router;
