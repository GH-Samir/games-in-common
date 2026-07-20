const cache = require('./cache');

const BASE = 'https://api.steampowered.com';

class FriendsListPrivateError extends Error {
  constructor() {
    super('Steam friends list is private');
    this.name = 'FriendsListPrivateError';
  }
}

function apiKey() {
  const key = process.env.STEAM_API_KEY;
  if (!key) throw new Error('STEAM_API_KEY is not set in .env');
  return key;
}

async function getPlayerSummaries(steamids) {
  const results = new Map();
  // GetPlayerSummaries accepts up to 100 steamids per call.
  for (let i = 0; i < steamids.length; i += 100) {
    const chunk = steamids.slice(i, i + 100);
    const url = `${BASE}/ISteamUser/GetPlayerSummaries/v2/?key=${apiKey()}&steamids=${chunk.join(',')}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GetPlayerSummaries failed: ${res.status}`);
    const data = await res.json();
    for (const player of data.response?.players ?? []) {
      results.set(player.steamid, player);
    }
  }
  return results;
}

async function getFriendList(steamid) {
  const url = `${BASE}/ISteamUser/GetFriendList/v1/?key=${apiKey()}&steamid=${steamid}&relationship=friend`;
  const res = await fetch(url);
  if (res.status === 401) throw new FriendsListPrivateError();
  if (!res.ok) throw new Error(`GetFriendList failed: ${res.status}`);
  const data = await res.json();
  return (data.friendslist?.friends ?? []).map((f) => f.steamid);
}

async function getOwnedGames(steamid) {
  const url = `${BASE}/IPlayerService/GetOwnedGames/v1/?key=${apiKey()}&steamid=${steamid}&include_appinfo=1&include_played_free_games=1`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GetOwnedGames failed: ${res.status}`);
  const data = await res.json();
  const games = data.response?.games;
  if (!games) {
    return { gamesVisible: false, games: [] };
  }
  return { gamesVisible: true, games };
}

async function getOwnedGamesCached(steamid) {
  return cache.getOrSet(`ownedGames:${steamid}`, 5 * 60 * 1000, () => getOwnedGames(steamid));
}

async function getPlayerSummariesCached(steamids) {
  const uncached = steamids.filter((id) => cache.get(`summary:${id}`) === undefined);
  if (uncached.length > 0) {
    const fetched = await getPlayerSummaries(uncached);
    for (const [id, player] of fetched) {
      cache.set(`summary:${id}`, player, 5 * 60 * 1000);
    }
  }
  const results = new Map();
  for (const id of steamids) {
    const player = cache.get(`summary:${id}`);
    if (player) results.set(id, player);
  }
  return results;
}

module.exports = {
  FriendsListPrivateError,
  getPlayerSummaries,
  getFriendList,
  getOwnedGames,
  getOwnedGamesCached,
  getPlayerSummariesCached,
};
