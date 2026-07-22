const appEl = document.getElementById('app');
const accountEl = document.getElementById('account');
const toastEl = document.getElementById('toast');

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function showToast(message) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { toastEl.hidden = true; }, 3500);
}

async function fetchJson(url, opts) {
  const res = await fetch(url, opts);
  if (res.redirected && res.url.includes('/setup')) {
    window.location.href = '/setup';
    return new Promise(() => {}); // page is navigating away, never resolve
  }
  if (res.status === 401) return { unauthenticated: true };
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.message || `Request to ${url} failed: ${res.status}`);
  }
  return res.json();
}

function renderLoggedOut() {
  document.getElementById('view-nav').hidden = true;
  accountEl.innerHTML = '';
  appEl.innerHTML = `
    <div class="login-screen">
      <p>Sign in with Steam to see the games you have in common with your friends.</p>
      <a href="/auth/steam"><button>Sign in through Steam</button></a>
    </div>
  `;
}

function renderAccount(me) {
  accountEl.innerHTML = `
    ${me.avatar ? `<img src="${escapeHtml(me.avatar)}" alt="">` : ''}
    <span>${escapeHtml(me.name)}</span>
    <button class="secondary" id="logout-btn">Log out</button>
  `;
  document.getElementById('logout-btn').addEventListener('click', async () => {
    await fetch('/auth/logout', { method: 'POST' });
    window.location.reload();
  });
}

function askToPlay(friend, game) {
  const message = `Hey! Want to play ${game.name}?`;
  const steamUri = `steam://friends/message/${friend.steamid}`;

  // A real <a> click is handled more reliably by browsers for custom
  // protocols than a scripted window.location.href assignment.
  const link = document.createElement('a');
  link.href = steamUri;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();

  if (navigator.clipboard) {
    navigator.clipboard.writeText(message).catch(() => {});
  }

  showToast(`Copied "${message}" — paste it in the Steam chat that just opened.`);
}

function renderFriendCard(friend) {
  const card = document.createElement('div');
  card.className = 'friend-card';

  const badge = friend.gamesVisible
    ? `<span class="badge">${friend.commonGames.length} in common</span>`
    : `<span class="badge private">library private</span>`;

  const header = document.createElement('div');
  header.className = 'friend-header';
  header.innerHTML = `
    ${friend.avatar ? `<img src="${escapeHtml(friend.avatar)}" alt="">` : ''}
    <div class="friend-name">${escapeHtml(friend.name)}</div>
    ${badge}
  `;

  const gameList = document.createElement('div');
  gameList.className = 'game-list';
  gameList.hidden = true;

  if (friend.gamesVisible && friend.commonGames.length > 0) {
    gameList.innerHTML = friend.commonGames.map((game) => `
      <div class="game-row" data-appid="${game.appid}">
        <div class="game-name">${escapeHtml(game.name)}</div>
        <div class="game-playtime">${Math.round((game.myPlaytime || 0) / 60)}h you / ${Math.round((game.theirPlaytime || 0) / 60)}h them</div>
        <button data-action="ask">Ask to play</button>
      </div>
    `).join('');

    gameList.querySelectorAll('[data-action="ask"]').forEach((btn, i) => {
      btn.addEventListener('click', () => askToPlay(friend, friend.commonGames[i]));
    });
  } else if (friend.gamesVisible) {
    gameList.innerHTML = `<p class="empty">No games in common.</p>`;
  } else {
    gameList.innerHTML = `<p class="empty">This friend's game library isn't public, so we can't compare.</p>`;
  }

  header.addEventListener('click', () => {
    gameList.hidden = !gameList.hidden;
  });

  card.appendChild(header);
  card.appendChild(gameList);
  return card;
}

let allFriends = [];

function renderFriendList(friends) {
  const list = document.getElementById('friend-list');
  list.innerHTML = '';
  if (friends.length === 0) {
    list.innerHTML = `<p class="empty">No friends match your search.</p>`;
    return;
  }
  for (const friend of friends) {
    list.appendChild(renderFriendCard(friend));
  }
}

function renderFriends(data) {
  allFriends = data.friends;

  if (allFriends.length === 0) {
    appEl.innerHTML = `<p class="empty">No Steam friends found.</p>`;
    return;
  }

  appEl.innerHTML = `
    <input type="text" id="friend-search" class="search-input" placeholder="Search friends by name…">
    <div class="friend-list" id="friend-list"></div>
  `;

  document.getElementById('friend-search').addEventListener('input', (e) => {
    const query = e.target.value.trim().toLowerCase();
    const filtered = query
      ? allFriends.filter((f) => f.name.toLowerCase().includes(query))
      : allFriends;
    renderFriendList(filtered);
  });

  renderFriendList(allFriends);
}

function renderProgress(completed, total) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  appEl.innerHTML = `
    <p class="loading">Comparing your library with your friends&hellip;</p>
    <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
    <p class="progress-label">${completed} / ${total} friends checked</p>
  `;
}

function loadCommonGames() {
  renderProgress(0, 0);

  const source = new EventSource('/api/common-games/stream');

  // The user may switch to the Groups tab while this is still streaming;
  // stop touching #app once this view is no longer the active one.
  const stale = () => currentView !== 'friends';

  source.onmessage = (event) => {
    if (stale()) return source.close();
    const msg = JSON.parse(event.data);
    if (msg.type === 'progress') {
      renderProgress(msg.completed, msg.total);
    } else if (msg.type === 'done') {
      source.close();
      renderFriends(msg.data);
    } else if (msg.type === 'friends-private') {
      source.close();
      appEl.innerHTML = `<p class="error">Your Steam friends list is private. Set it to public in your Steam privacy settings to use this app.</p>`;
    } else if (msg.type === 'error') {
      source.close();
      appEl.innerHTML = `<p class="error">Something went wrong loading your friends: ${escapeHtml(msg.message)}</p>`;
    }
  };

  source.onerror = () => {
    source.close();
    if (!stale()) {
      appEl.innerHTML = `<p class="error">Lost connection while loading your friends. Try refreshing the page.</p>`;
    }
  };
}

let currentUser = null;
let groupsFriendsRoster = null;
let expandedGroupId = null;
let groupMemberSearchQuery = '';

async function ensureFriendsRoster() {
  if (groupsFriendsRoster) return groupsFriendsRoster;
  const data = await fetchJson('/api/friends');
  if (data.unauthenticated || data.error === 'friends-private') {
    groupsFriendsRoster = [];
  } else {
    groupsFriendsRoster = data.friends;
  }
  return groupsFriendsRoster;
}

function createGroupChat(group) {
  if (group.members.length === 0) {
    showToast('Add at least one member before creating a group chat.');
    return;
  }

  const [first, ...rest] = group.members;
  const steamUri = `steam://friends/message/${first.steamid}`;

  const link = document.createElement('a');
  link.href = steamUri;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();

  const roster = group.members.map((m) => `${m.name} (${m.steamid})`).join('\n');
  if (navigator.clipboard) {
    navigator.clipboard.writeText(roster).catch(() => {});
  }

  const extra = rest.length > 0
    ? ` Add the other ${rest.length} with the "+" button in that chat — the full roster is on your clipboard.`
    : '';
  showToast(`Opened a chat with ${first.name}.${extra}`);
}

function renderGroupProgress(container, completed, total) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  container.innerHTML = `
    <p class="loading">Comparing libraries&hellip;</p>
    <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
    <p class="progress-label">${completed} / ${total} members checked</p>
  `;
}

function renderGroupCommonGamesResults(container, data) {
  const { commonGames, excludedMembers } = data;
  let html = '';

  if (excludedMembers.length > 0) {
    const names = excludedMembers.map((m) => escapeHtml(m.name)).join(', ');
    html += `<p class="empty">${names}'s librar${excludedMembers.length === 1 ? 'y is' : 'ies are'} private, so they're excluded from this comparison.</p>`;
  }

  if (commonGames.length === 0) {
    html += `<p class="empty">No games in common across this group.</p>`;
    container.innerHTML = html;
    return;
  }

  const rows = commonGames.map((game) => {
    const playtimeText = game.playtimes
      .map((p) => `${p.steamid === currentUser?.steamid ? 'You' : escapeHtml(p.name)}: ${Math.round(p.minutes / 60)}h`)
      .join(' · ');
    return `
      <div class="game-row">
        <div class="game-name">${escapeHtml(game.name)}</div>
        <div class="game-playtime">${playtimeText}</div>
      </div>
    `;
  }).join('');

  container.innerHTML = `${html}<div class="game-list">${rows}</div>`;
}

function loadGroupCommonGames(group, container) {
  renderGroupProgress(container, 0, 0);

  const source = new EventSource(`/api/groups/${group.id}/common-games/stream`);

  source.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === 'progress') {
      renderGroupProgress(container, msg.completed, msg.total);
    } else if (msg.type === 'done') {
      source.close();
      renderGroupCommonGamesResults(container, msg.data);
    } else if (msg.type === 'error') {
      source.close();
      container.innerHTML = `<p class="error">${escapeHtml(msg.message)}</p>`;
    }
  };

  source.onerror = () => {
    source.close();
    container.innerHTML = `<p class="error">Lost connection while loading common games.</p>`;
  };
}

function renderGroupCard(group) {
  const card = document.createElement('div');
  card.className = 'group-card';

  const header = document.createElement('div');
  header.className = 'group-header';
  header.innerHTML = `
    <div class="group-name">${escapeHtml(group.name)}</div>
    <span class="badge">${group.memberCount} / ${group.capacity}</span>
    <span class="group-size-label">${escapeHtml(group.size)}</span>
  `;
  header.addEventListener('click', () => {
    expandedGroupId = expandedGroupId === group.id ? null : group.id;
    body.hidden = expandedGroupId !== group.id;
  });

  const actions = document.createElement('div');
  actions.className = 'group-actions';
  actions.innerHTML = `
    <button class="secondary" data-action="chat">Create group chat</button>
    <button class="secondary" data-action="rename">Rename</button>
    <button class="secondary" data-action="delete">Delete</button>
  `;

  actions.querySelector('[data-action="chat"]').addEventListener('click', (e) => {
    e.stopPropagation();
    createGroupChat(group);
  });

  actions.querySelector('[data-action="rename"]').addEventListener('click', async (e) => {
    e.stopPropagation();
    const name = prompt('Rename group', group.name);
    if (!name || !name.trim()) return;
    try {
      await fetchJson(`/api/groups/${group.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      loadGroups();
    } catch (err) {
      showToast(err.message);
    }
  });

  actions.querySelector('[data-action="delete"]').addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!confirm(`Delete "${group.name}"? This can't be undone.`)) return;
    try {
      await fetchJson(`/api/groups/${group.id}`, { method: 'DELETE' });
      loadGroups();
    } catch (err) {
      showToast(err.message);
    }
  });

  const body = document.createElement('div');
  body.className = 'group-body';
  body.hidden = expandedGroupId !== group.id;

  const memberList = document.createElement('div');
  memberList.className = 'member-list';
  if (group.members.length === 0) {
    memberList.innerHTML = `<p class="empty">No members yet.</p>`;
  } else {
    memberList.innerHTML = group.members.map((m) => `
      <div class="member-row" data-steamid="${escapeHtml(m.steamid)}">
        ${m.avatar ? `<img src="${escapeHtml(m.avatar)}" alt="">` : ''}
        <div class="member-name">${escapeHtml(m.name)}</div>
        <button class="secondary" data-action="remove-member">Remove</button>
      </div>
    `).join('');
    memberList.querySelectorAll('[data-action="remove-member"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const steamid = btn.closest('.member-row').dataset.steamid;
        try {
          await fetchJson(`/api/groups/${group.id}/members/${steamid}`, { method: 'DELETE' });
          loadGroups();
        } catch (err) {
          showToast(err.message);
        }
      });
    });
  }

  const addMember = document.createElement('div');
  addMember.className = 'add-member';
  addMember.innerHTML = `
    <input type="text" class="search-input" placeholder="Search friends to add…" value="${escapeHtml(groupMemberSearchQuery)}">
    <div class="friend-picker-results"></div>
  `;

  const searchInput = addMember.querySelector('input');
  const resultsEl = addMember.querySelector('.friend-picker-results');

  function renderPicker() {
    const query = searchInput.value.trim().toLowerCase();
    const memberIds = new Set(group.members.map((m) => m.steamid));
    const matches = (groupsFriendsRoster || [])
      .filter((f) => !memberIds.has(f.steamid))
      .filter((f) => !query || f.name.toLowerCase().includes(query))
      .slice(0, 8);

    if (matches.length === 0) {
      resultsEl.innerHTML = `<p class="empty">No matching friends.</p>`;
      return;
    }

    resultsEl.innerHTML = matches.map((f) => `
      <div class="picker-row" data-steamid="${escapeHtml(f.steamid)}">
        ${f.avatar ? `<img src="${escapeHtml(f.avatar)}" alt="">` : ''}
        <div class="member-name">${escapeHtml(f.name)}</div>
        <button data-action="add-member">Add</button>
      </div>
    `).join('');

    resultsEl.querySelectorAll('[data-action="add-member"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const steamid = btn.closest('.picker-row').dataset.steamid;
        try {
          await fetchJson(`/api/groups/${group.id}/members`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ steamid }),
          });
          loadGroups();
        } catch (err) {
          showToast(err.message);
        }
      });
    });
  }

  searchInput.addEventListener('input', () => {
    groupMemberSearchQuery = searchInput.value;
    renderPicker();
  });

  renderPicker();

  const commonGamesSection = document.createElement('div');
  commonGamesSection.className = 'group-common-games';
  commonGamesSection.innerHTML = `
    <button class="secondary" data-action="show-common-games">Show common games in this group</button>
    <div class="group-common-games-results"></div>
  `;
  commonGamesSection.querySelector('[data-action="show-common-games"]').addEventListener('click', () => {
    loadGroupCommonGames(group, commonGamesSection.querySelector('.group-common-games-results'));
  });

  body.appendChild(memberList);
  body.appendChild(addMember);
  body.appendChild(commonGamesSection);

  card.appendChild(header);
  card.appendChild(actions);
  card.appendChild(body);
  return card;
}

function renderGroupsView(groups) {
  appEl.innerHTML = `
    <form id="create-group-form" class="create-group-form">
      <input type="text" id="group-name-input" placeholder="Group name" required maxlength="60">
      <select id="group-size-select">
        <option value="small">Small — up to 6</option>
        <option value="medium">Medium — up to 10</option>
        <option value="large">Large — up to 32</option>
      </select>
      <button type="submit">Create group</button>
    </form>
    <div class="group-list" id="group-list"></div>
  `;

  document.getElementById('create-group-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('group-name-input').value;
    const size = document.getElementById('group-size-select').value;
    try {
      await fetchJson('/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, size }),
      });
      loadGroups();
    } catch (err) {
      showToast(err.message);
    }
  });

  const list = document.getElementById('group-list');
  if (groups.length === 0) {
    list.innerHTML = `<p class="empty">No groups yet — create one above.</p>`;
    return;
  }
  for (const group of groups) {
    list.appendChild(renderGroupCard(group));
  }
}

async function loadGroups() {
  appEl.innerHTML = `<p class="loading">Loading your groups&hellip;</p>`;
  try {
    const [, data] = await Promise.all([ensureFriendsRoster(), fetchJson('/api/groups')]);
    if (currentView !== 'groups') return;
    if (data.unauthenticated) {
      renderLoggedOut();
      return;
    }
    renderGroupsView(data.groups);
  } catch (err) {
    appEl.innerHTML = `<p class="error">Something went wrong loading your groups: ${escapeHtml(err.message)}</p>`;
  }
}

let currentView = 'friends';

function switchView(view) {
  currentView = view;
  document.querySelectorAll('.nav-tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });
  if (view === 'friends') {
    loadCommonGames();
  } else {
    loadGroups();
  }
}

async function init() {
  const me = await fetchJson('/api/me');
  if (me.unauthenticated) {
    renderLoggedOut();
    return;
  }
  currentUser = me;
  renderAccount(me);

  const nav = document.getElementById('view-nav');
  nav.hidden = false;
  nav.querySelectorAll('.nav-tab').forEach((btn) => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  switchView('friends');
}

init();
