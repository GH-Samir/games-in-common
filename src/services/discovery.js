const { getOwnedGamesCached } = require('./steamApi');
const { mapWithConcurrency } = require('./commonGames');
const steamStore = require('./steamStore');

const CONCURRENCY_LIMIT = 8;
const TOP_GENRES_FOR_DISCOVERY = 3;
const RESULTS_PER_PAGE = 6;
const MAX_CANDIDATES_TO_SCAN = 60;

// Per-person cap on how many of their top-playtime games get genre-profiled.
// Keeps a 2-person friend comparison as thorough as before (~25 each) while
// bounding the total appdetails calls for a large group (e.g. 32 members).
function topGamesCapFor(peopleCount) {
  return Math.max(8, Math.round(200 / peopleCount));
}

// Used when neither party's library is visible enough to build a genre
// profile from, so discovery still has somewhere reasonable to start.
const POPULAR_FALLBACK_GENRES = ['Action', 'Indie', 'Adventure', 'RPG', 'Strategy'];

const MULTIPLAYER_CATEGORY_PATTERN = /multi-player|co-op|mmo|pvp/i;

function isMultiplayer(details) {
  return (details.categories ?? []).some((c) => MULTIPLAYER_CATEGORY_PATTERN.test(c.description ?? ''));
}

async function buildGenreProfile(steamid, cc, topGamesCap) {
  const { gamesVisible, games } = await getOwnedGamesCached(steamid);
  if (!gamesVisible) return null;

  const topGames = [...games]
    .sort((a, b) => (b.playtime_forever ?? 0) - (a.playtime_forever ?? 0))
    .slice(0, topGamesCap);

  const genreHours = new Map();

  await mapWithConcurrency(topGames, CONCURRENCY_LIMIT, async (game) => {
    const details = await steamStore.getAppDetails(game.appid, cc);
    if (!details?.genres) return;
    const hours = (game.playtime_forever ?? 0) / 60;
    for (const genre of details.genres) {
      genreHours.set(genre.description, (genreHours.get(genre.description) ?? 0) + hours);
    }
  });

  return { genreHours, ownedAppIds: new Set(games.map((g) => g.appid)) };
}

async function getCombinedGenreProfile(steamids, cc) {
  const topGamesCap = topGamesCapFor(steamids.length);
  const profiles = await Promise.all(steamids.map((id) => buildGenreProfile(id, cc, topGamesCap)));

  const combined = new Map();
  for (const profile of profiles) {
    if (!profile) continue;
    for (const [genre, hours] of profile.genreHours) {
      combined.set(genre, (combined.get(genre) ?? 0) + hours);
    }
  }

  const genres = [...combined.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([genre]) => genre);

  const ownedAppIds = new Set(profiles.flatMap((p) => (p ? [...p.ownedAppIds] : [])));
  const visibleCount = profiles.filter(Boolean).length;

  return { genres, ownedAppIds, visibleCount, totalCount: steamids.length };
}

async function discoverGames({ steamids, maxPriceMinor, cc, seenAppIds = [], multiplayerOnly = false }) {
  const profile = await getCombinedGenreProfile(steamids, cc);

  const genresToUse = (profile.genres.length > 0 ? profile.genres : POPULAR_FALLBACK_GENRES)
    .slice(0, TOP_GENRES_FOR_DISCOVERY);

  const genreAppLists = await Promise.all(genresToUse.map((g) => steamStore.getGenreAppList(g)));

  // Concatenate rather than interleave: genres are already ranked by shared
  // hours, and each list is already popularity-sorted, so this naturally
  // prioritizes "most relevant, most popular" first.
  const candidates = [];
  const seenCandidate = new Set();
  for (const list of genreAppLists) {
    for (const appid of list) {
      if (!seenCandidate.has(appid)) {
        seenCandidate.add(appid);
        candidates.push(appid);
      }
    }
  }

  const excludeIds = new Set([...profile.ownedAppIds, ...seenAppIds.map(Number)]);
  const toScan = candidates.filter((id) => !excludeIds.has(id)).slice(0, MAX_CANDIDATES_TO_SCAN);

  const games = [];
  for (let i = 0; i < toScan.length && games.length < RESULTS_PER_PAGE; i += CONCURRENCY_LIMIT) {
    const batch = toScan.slice(i, i + CONCURRENCY_LIMIT);
    const batchResults = await mapWithConcurrency(batch, CONCURRENCY_LIMIT, (appid) => steamStore.getAppDetails(appid, cc));

    batchResults.forEach((details, j) => {
      if (games.length >= RESULTS_PER_PAGE) return;
      if (!details || details.error || details.type !== 'game') return;

      const priceOk = details.is_free || (details.price_overview && details.price_overview.final <= maxPriceMinor);
      if (!priceOk) return;

      if (multiplayerOnly && !isMultiplayer(details)) return;

      games.push({
        appid: batch[j],
        name: details.name,
        headerImage: details.header_image,
        isFree: Boolean(details.is_free),
        price: details.price_overview ? {
          currency: details.price_overview.currency,
          finalMinor: details.price_overview.final,
          initialMinor: details.price_overview.initial,
          discountPercent: details.price_overview.discount_percent,
          finalFormatted: details.price_overview.final_formatted,
        } : null,
        storeUrl: `https://store.steampowered.com/app/${batch[j]}`,
      });
    });
  }

  return { genres: genresToUse, visibleCount: profile.visibleCount, totalCount: profile.totalCount, games };
}

module.exports = { getCombinedGenreProfile, discoverGames };
