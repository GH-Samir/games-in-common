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

module.exports = { getCommonGamesForUser, intersectGames, mapWithConcurrency };
