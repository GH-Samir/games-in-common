const DEFAULT_TTL_MS = 5 * 60 * 1000;

const store = new Map();

function get(key) {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return undefined;
  }
  return entry.value;
}

function set(key, value, ttlMs = DEFAULT_TTL_MS) {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

async function getOrSet(key, ttlMs, fn) {
  const cached = get(key);
  if (cached !== undefined) return cached;
  const value = await fn();
  set(key, value, ttlMs);
  return value;
}

module.exports = { get, set, getOrSet };
