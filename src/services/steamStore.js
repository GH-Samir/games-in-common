const cache = require('./cache');

const STORE_BASE = 'https://store.steampowered.com/api/appdetails';
const STEAMSPY_BASE = 'https://steamspy.com/api.php';

const APP_DETAILS_TTL_MS = 6 * 60 * 60 * 1000; // prices/discounts change infrequently
const GENRE_LIST_TTL_MS = 24 * 60 * 60 * 1000; // SteamSpy data refreshes once a day

const RATE_LIMIT_STATUSES = new Set([403, 429]);
const MAX_RETRIES = 3;

// Ordered for the client dropdown; "cc" is the Steam store country code used
// to localize price_overview, "symbol" is just for display.
const CURRENCIES = [
  { code: 'GBP', cc: 'gb', symbol: '£' },
  { code: 'USD', cc: 'us', symbol: '$' },
  { code: 'EUR', cc: 'de', symbol: '€' },
  { code: 'CAD', cc: 'ca', symbol: 'CA$' },
  { code: 'AUD', cc: 'au', symbol: 'AU$' },
  { code: 'JPY', cc: 'jp', symbol: '¥' },
  { code: 'CHF', cc: 'ch', symbol: 'Fr' },
  { code: 'NZD', cc: 'nz', symbol: 'NZ$' },
];

function currencyToCc(code) {
  return CURRENCIES.find((c) => c.code === code)?.cc || 'gb';
}

async function fetchWithRetry(url) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url);
    if (!RATE_LIMIT_STATUSES.has(res.status) || attempt >= MAX_RETRIES) {
      return res;
    }
    const delayMs = 1000 * 2 ** attempt;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

async function fetchAppDetails(appid, cc) {
  const url = `${STORE_BASE}?appids=${appid}&cc=${cc}&filters=basic,price_overview,genres,categories`;
  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error(`appdetails failed for ${appid}: ${res.status}`);
  const data = await res.json();
  const entry = data[String(appid)];
  if (!entry?.success) return null;
  return entry.data;
}

async function getAppDetails(appid, cc) {
  return cache.getOrSet(`appdetails:${appid}:${cc}`, APP_DETAILS_TTL_MS, () => fetchAppDetails(appid, cc));
}

async function fetchGenreAppList(genre) {
  const url = `${STEAMSPY_BASE}?request=genre&genre=${encodeURIComponent(genre)}`;
  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error(`SteamSpy genre lookup failed for ${genre}: ${res.status}`);
  const data = await res.json();
  return Object.values(data)
    .sort((a, b) => (b.positive ?? 0) - (a.positive ?? 0))
    .map((entry) => Number(entry.appid));
}

async function getGenreAppList(genre) {
  try {
    return await cache.getOrSet(`genreapps:${genre}`, GENRE_LIST_TTL_MS, () => fetchGenreAppList(genre));
  } catch (err) {
    console.error(`getGenreAppList(${genre}) failed, degrading to empty list:`, err);
    return [];
  }
}

module.exports = { CURRENCIES, currencyToCc, getAppDetails, getGenreAppList };
