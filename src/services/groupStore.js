const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const configStore = require('./configStore');

const CAPACITY = { small: 6, medium: 10, large: 32 };

class GroupError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function groupsPath() {
  return path.join(configStore.dataDir(), 'groups.json');
}

function readAll() {
  try {
    return JSON.parse(fs.readFileSync(groupsPath(), 'utf8'));
  } catch {
    return {};
  }
}

function writeAll(data) {
  fs.mkdirSync(configStore.dataDir(), { recursive: true });
  fs.writeFileSync(groupsPath(), JSON.stringify(data, null, 2));
}

function listGroups(ownerId) {
  return readAll()[ownerId] || [];
}

function saveOwnerGroups(ownerId, groups) {
  const all = readAll();
  all[ownerId] = groups;
  writeAll(all);
}

function getGroupOrThrow(groups, groupId) {
  const group = groups.find((g) => g.id === groupId);
  if (!group) throw new GroupError('not-found', 'Group not found');
  return group;
}

function createGroup(ownerId, { name, size }) {
  const trimmedName = (name || '').trim();
  if (!trimmedName) throw new GroupError('invalid-name', 'Group name is required');
  if (!CAPACITY[size]) throw new GroupError('invalid-size', 'Size must be small, medium, or large');

  const groups = listGroups(ownerId);
  const group = {
    id: crypto.randomUUID(),
    name: trimmedName,
    size,
    createdBy: ownerId,
    createdAt: new Date().toISOString(),
    members: [],
  };
  groups.push(group);
  saveOwnerGroups(ownerId, groups);
  return group;
}

function renameGroup(ownerId, groupId, name) {
  const trimmedName = (name || '').trim();
  if (!trimmedName) throw new GroupError('invalid-name', 'Group name is required');

  const groups = listGroups(ownerId);
  const group = getGroupOrThrow(groups, groupId);
  group.name = trimmedName;
  saveOwnerGroups(ownerId, groups);
  return group;
}

function deleteGroup(ownerId, groupId) {
  const groups = listGroups(ownerId);
  const next = groups.filter((g) => g.id !== groupId);
  if (next.length === groups.length) throw new GroupError('not-found', 'Group not found');
  saveOwnerGroups(ownerId, next);
}

function addMember(ownerId, groupId, steamid) {
  const groups = listGroups(ownerId);
  const group = getGroupOrThrow(groups, groupId);

  if (group.members.includes(steamid)) return group;

  const capacity = CAPACITY[group.size];
  if (group.members.length >= capacity) {
    throw new GroupError('group-full', `This group is full (max ${capacity} members for size "${group.size}")`);
  }

  group.members.push(steamid);
  saveOwnerGroups(ownerId, groups);
  return group;
}

function removeMember(ownerId, groupId, steamid) {
  const groups = listGroups(ownerId);
  const group = getGroupOrThrow(groups, groupId);
  group.members = group.members.filter((id) => id !== steamid);
  saveOwnerGroups(ownerId, groups);
  return group;
}

module.exports = {
  CAPACITY,
  GroupError,
  listGroups,
  createGroup,
  renameGroup,
  deleteGroup,
  addMember,
  removeMember,
};
