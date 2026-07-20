const STEAM_OPENID_URL = 'https://steamcommunity.com/openid/login';
const CLAIMED_ID_PREFIX = 'https://steamcommunity.com/openid/id/';

function buildLoginUrl(baseUrl) {
  const params = new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'checkid_setup',
    'openid.return_to': `${baseUrl}/auth/steam/return`,
    'openid.realm': `${baseUrl}/`,
    'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
  });
  return `${STEAM_OPENID_URL}?${params.toString()}`;
}

async function verifyAndExtractSteamId(query) {
  const verifyParams = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    verifyParams.set(key, value);
  }
  verifyParams.set('openid.mode', 'check_authentication');

  const res = await fetch(STEAM_OPENID_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: verifyParams.toString(),
  });
  const body = await res.text();

  if (!/is_valid\s*:\s*true/.test(body)) {
    throw new Error('Steam OpenID verification failed');
  }

  const claimedId = query['openid.claimed_id'];
  if (!claimedId || !claimedId.startsWith(CLAIMED_ID_PREFIX)) {
    throw new Error('Unexpected claimed_id from Steam');
  }

  const steamid = claimedId.slice(CLAIMED_ID_PREFIX.length);
  if (!/^\d+$/.test(steamid)) {
    throw new Error('Could not parse steamid64 from claimed_id');
  }

  return steamid;
}

module.exports = { buildLoginUrl, verifyAndExtractSteamId };
