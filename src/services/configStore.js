const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function configDir() {
  return process.env.CONFIG_DIR || path.join(__dirname, '..', '..', '.gic-data');
}

function configPath() {
  return path.join(configDir(), 'config.json');
}

function readStoredConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), 'utf8'));
  } catch {
    return {};
  }
}

function writeStoredConfig(data) {
  fs.mkdirSync(configDir(), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(data, null, 2));
}

function getConfig() {
  const stored = readStoredConfig();

  let sessionSecret = stored.sessionSecret;
  if (!sessionSecret) {
    sessionSecret = crypto.randomBytes(32).toString('hex');
    writeStoredConfig({ ...stored, sessionSecret });
  }

  const steamApiKey = process.env.STEAM_API_KEY || stored.steamApiKey || null;

  return { steamApiKey, sessionSecret };
}

function setSteamApiKey(key) {
  const stored = readStoredConfig();
  writeStoredConfig({ ...stored, steamApiKey: key });
}

module.exports = { getConfig, setSteamApiKey };
