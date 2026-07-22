const fs = require('fs');
const path = require('path');
const configStore = require('./configStore');

function chestPath() {
  return path.join(configStore.dataDir(), 'chest.json');
}

function readAll() {
  try {
    return JSON.parse(fs.readFileSync(chestPath(), 'utf8'));
  } catch {
    return {};
  }
}

function writeAll(data) {
  fs.mkdirSync(configStore.dataDir(), { recursive: true });
  fs.writeFileSync(chestPath(), JSON.stringify(data, null, 2));
}

function listChest(ownerId) {
  return readAll()[ownerId] || [];
}

function addToChest(ownerId, appid) {
  const all = readAll();
  const owned = all[ownerId] || [];
  if (!owned.some((entry) => entry.appid === appid)) {
    owned.push({ appid, savedAt: new Date().toISOString() });
  }
  all[ownerId] = owned;
  writeAll(all);
  return owned;
}

function removeFromChest(ownerId, appid) {
  const all = readAll();
  const owned = (all[ownerId] || []).filter((entry) => entry.appid !== appid);
  all[ownerId] = owned;
  writeAll(all);
  return owned;
}

module.exports = { listChest, addToChest, removeFromChest };
