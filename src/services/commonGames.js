const { getOwnedGamesCached, getPlayerSummariesCached, getFriendList } = require('./steamApi');

const CONCURRENCY_LIMIT = 8;

async function mapWithConcurrency(items, limit, fn, onItemDone) {
  const results = new Array(items.length);
  let cursor = 0;
  let completed = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = await fn(items[index]);
      } catch (err) {
        results[index] = { error: err };
      }
      completed++;
      onItemDone?.(completed, items.length);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

function intersectGames(myGames, theirGames) {
  const myByAppId = new Map(myGames.map((g) => [g.appid, g]));
  const common = [];
  for (const theirGame of theirGames) {
    const mine = myByAppId.get(theirGame.appid);
    if (mine) {
      common.push({
        appid: theirGame.appid,
        name: theirGame.name ?? mine.name,
        myPlaytime: mine.playtime_forever ?? 0,
        theirPlaytime: theirGame.playtime_forever ?? 0,
      });
    }
  }
  common.sort((a, b) => b.myPlaytime + b.theirPlaytime - (a.myPlaytime + a.theirPlaytime));
  return common;
}

async function getCommonGamesForUser(mySteamId, onProgress) {
  const [myGamesResult, friendSteamIds] = await Promise.all([
    getOwnedGamesCached(mySteamId),
    getFriendList(mySteamId),
  ]);

  onProgress?.(0, friendSteamIds.length);

  const myGames = myGamesResult.games;

  const friendGameResults = await mapWithConcurrency(
    friendSteamIds,
    CONCURRENCY_LIMIT,
    async (friendSteamId) => {
      const result = await getOwnedGamesCached(friendSteamId);
      return { steamid: friendSteamId, ...result };
    },
    onProgress
  );

  const allSteamIds = [mySteamId, ...friendSteamIds];
  const summaries = await getPlayerSummariesCached(allSteamIds);

  const me = summaries.get(mySteamId);

  const friends = friendGameResults.map((result, i) => {
    const steamid = friendSteamIds[i];
    const summary = summaries.get(steamid);
    const base = {
      steamid,
      name: summary?.personaname ?? 'Unknown',
      avatar: summary?.avatarmedium ?? null,
    };

    if (result.error || !result.gamesVisible) {
      return { ...base, gamesVisible: false, commonGames: [] };
    }

    return {
      ...base,
      gamesVisible: true,
      commonGames: intersectGames(myGames, result.games),
    };
  });

  friends.sort((a, b) => b.commonGames.length - a.commonGames.length);

  return {
    me: {
      steamid: mySteamId,
      name: me?.personaname ?? 'Unknown',
      avatar: me?.avatarmedium ?? null,
      gameCount: myGames.length,
    },
    friends,
  };
}

function intersectGamesAcross(players) {
  if (players.length === 0) return [];

  let commonAppIds = new Set(players[0].gamesById.keys());
  for (const player of players.slice(1)) {
    commonAppIds = new Set([...commonAppIds].filter((id) => player.gamesById.has(id)));
  }

  const common = [];
  for (const appid of commonAppIds) {
    common.push({
      appid,
      name: players[0].gamesById.get(appid).name,
      playtimes: players.map((p) => ({
        steamid: p.steamid,
        name: p.name,
        avatar: p.avatar,
        minutes: p.gamesById.get(appid)?.playtime_forever ?? 0,
      })),
    });
  }

  common.sort((a, b) => {
    const totalA = a.playtimes.reduce((sum, p) => sum + p.minutes, 0);
    const totalB = b.playtimes.reduce((sum, p) => sum + p.minutes, 0);
    return totalB - totalA;
  });

  return common;
}

// N-way intersection across the logged-in user and every group member, unlike
// intersectGames() above which is pairwise (user vs. one friend at a time).
async function getGroupCommonGames(ownerId, memberIds, onProgress) {
  const allIds = [ownerId, ...memberIds];
  onProgress?.(0, allIds.length);

  const results = await mapWithConcurrency(
    allIds,
    CONCURRENCY_LIMIT,
    async (steamid) => ({ steamid, ...(await getOwnedGamesCached(steamid)) }),
    onProgress
  );

  const summaries = await getPlayerSummariesCached(allIds);

  const players = [];
  const excludedMembers = [];

  results.forEach((result, i) => {
    const steamid = allIds[i];
    const summary = summaries.get(steamid);
    const name = summary?.personaname ?? 'Unknown';
    const avatar = summary?.avatarmedium ?? null;

    if (result.error || !result.gamesVisible) {
      excludedMembers.push({ steamid, name, avatar });
      return;
    }

    players.push({
      steamid,
      name,
      avatar,
      gamesById: new Map(result.games.map((g) => [g.appid, g])),
    });
  });

  return {
    commonGames: players.length > 0 ? intersectGamesAcross(players) : [],
    excludedMembers,
  };
}

module.exports = { getCommonGamesForUser, getGroupCommonGames, intersectGames, mapWithConcurrency };
