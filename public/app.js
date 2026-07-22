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

  showToast(`Copied "${message}" - paste it in the Steam chat that just opened.`);
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

  const body = document.createElement('div');
  body.className = 'friend-body';
  body.hidden = true;

  const gameList = document.createElement('div');
  gameList.className = 'game-list';

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
    body.hidden = !body.hidden;
  });

  body.appendChild(gameList);
  body.appendChild(renderDiscoverySection(
    '🎮 Find new games we might like',
    'friend-discovery',
    `/api/friends/${friend.steamid}/recommendations`,
    'you both'
  ));

  card.appendChild(header);
  card.appendChild(body);
  return card;
}

let currenciesCache = null;

async function ensureCurrencies() {
  if (currenciesCache) return currenciesCache;
  const data = await fetchJson('/api/currencies');
  currenciesCache = data.currencies || [];
  return currenciesCache;
}

function getSavedCurrency() {
  return localStorage.getItem('gic-currency') || 'GBP';
}

function getSavedBudget() {
  return localStorage.getItem('gic-budget') || '30';
}

function formatPrice(game) {
  if (game.isFree) return 'Free to play';
  if (!game.price) return 'Price unavailable';
  const { finalFormatted, discountPercent } = game.price;
  return discountPercent > 0
    ? `${escapeHtml(finalFormatted)} <span class="discount-badge">-${discountPercent}%</span>`
    : escapeHtml(finalFormatted);
}

async function saveToChest(appid) {
  try {
    await fetchJson('/api/chest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appid }),
    });
    showToast('Saved to your Game Chest.');
  } catch (err) {
    showToast(err.message);
  }
}

async function buildDiscoveryPanel(endpoint, panel, { noteWho }) {
  const currencies = await ensureCurrencies();

  panel.innerHTML = `
    <div class="discovery-controls">
      <select class="discovery-currency">
        ${currencies.map((c) => `<option value="${escapeHtml(c.code)}">${escapeHtml(c.code)} (${escapeHtml(c.symbol)})</option>`).join('')}
      </select>
      <input type="number" class="discovery-budget" min="0" step="1" placeholder="Max price">
      <button data-action="search">Find games</button>
    </div>
    <label class="discovery-checkbox">
      <input type="checkbox" class="discovery-multiplayer-only">
      Show multiplayer games only
    </label>
    <div class="discovery-results"></div>
  `;

  const currencySelect = panel.querySelector('.discovery-currency');
  const budgetInput = panel.querySelector('.discovery-budget');
  const multiplayerCheckbox = panel.querySelector('.discovery-multiplayer-only');
  const resultsEl = panel.querySelector('.discovery-results');

  currencySelect.value = getSavedCurrency();
  budgetInput.value = getSavedBudget();
  multiplayerCheckbox.checked = localStorage.getItem('gic-multiplayer-only') === 'true';

  let seenAppIds = [];

  function renderResults(data) {
    const { games, genres, visibleCount, totalCount } = data;
    let html = '';

    if (genres?.length > 0) {
      const who = totalCount === 2 && visibleCount < 2 ? 'you' : noteWho;
      let note = `Prioritizing genres ${who} play most: ${genres.map(escapeHtml).join(', ')}`;
      if (totalCount > 2 && visibleCount < totalCount) {
        note += ` (${visibleCount} of ${totalCount} libraries visible)`;
      }
      html += `<p class="discovery-note">${note}</p>`;
    }

    if (games.length === 0) {
      html += `<p class="empty">No more games found in this budget. Try a higher budget, or check back later.</p>`;
      resultsEl.innerHTML = html;
      return;
    }

    html += `<div class="discovery-grid">${games.map((game) => `
      <div class="discovery-card" data-appid="${game.appid}">
        ${game.headerImage ? `<img src="${escapeHtml(game.headerImage)}" alt="">` : ''}
        <div class="discovery-card-name">${escapeHtml(game.name)}</div>
        <div class="discovery-card-price">${formatPrice(game)}</div>
        <div class="discovery-card-actions">
          <a href="${escapeHtml(game.storeUrl)}" target="_blank" rel="noopener">View on Steam</a>
          <button class="secondary" data-action="save" title="Save to Game Chest">🧰 Save</button>
        </div>
      </div>
    `).join('')}</div>`;
    html += `<button class="secondary discovery-dice" data-action="dice">🎲 Show 6 more</button>`;

    resultsEl.innerHTML = html;

    resultsEl.querySelectorAll('[data-action="save"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        saveToChest(Number(btn.closest('.discovery-card').dataset.appid));
      });
    });

    resultsEl.querySelector('[data-action="dice"]').addEventListener('click', () => search(false));
  }

  async function search(reset) {
    const currency = currencySelect.value;
    const budget = budgetInput.value;
    const multiplayerOnly = multiplayerCheckbox.checked;
    localStorage.setItem('gic-currency', currency);
    localStorage.setItem('gic-budget', budget);
    localStorage.setItem('gic-multiplayer-only', String(multiplayerOnly));

    if (reset) seenAppIds = [];

    resultsEl.innerHTML = `<p class="loading">Finding games&hellip;</p>`;
    try {
      const params = new URLSearchParams({ currency, maxPrice: budget, multiplayerOnly: String(multiplayerOnly), seen: seenAppIds.join(',') });
      const data = await fetchJson(`${endpoint}?${params}`);
      seenAppIds.push(...data.games.map((g) => g.appid));
      renderResults(data);
    } catch (err) {
      resultsEl.innerHTML = `<p class="error">${escapeHtml(err.message)}</p>`;
    }
  }

  panel.querySelector('[data-action="search"]').addEventListener('click', () => search(true));

  search(true);
}

function renderDiscoverySection(buttonLabel, className, endpoint, noteWho) {
  const container = document.createElement('div');
  container.className = className;
  container.innerHTML = `<button class="secondary" data-action="find-games">${buttonLabel}</button>`;

  const panel = document.createElement('div');
  panel.className = 'discovery-panel';
  panel.hidden = true;
  container.appendChild(panel);

  let panelBuilt = false;

  container.querySelector('[data-action="find-games"]').addEventListener('click', (e) => {
    e.stopPropagation();
    panel.hidden = !panel.hidden;
    if (!panel.hidden && !panelBuilt) {
      panelBuilt = true;
      buildDiscoveryPanel(endpoint, panel, { noteWho });
    }
  });

  return container;
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

function revealNav() {
  document.getElementById('view-nav').hidden = false;
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
      revealNav();
    } else if (msg.type === 'friends-private') {
      source.close();
      appEl.innerHTML = `<p class="error">Your Steam friends list is private. Set it to public in your Steam privacy settings to use this app.</p>`;
      revealNav();
    } else if (msg.type === 'error') {
      source.close();
      appEl.innerHTML = `<p class="error">Something went wrong loading your friends: ${escapeHtml(msg.message)}</p>`;
      revealNav();
    }
  };

  source.onerror = () => {
    source.close();
    if (!stale()) {
      appEl.innerHTML = `<p class="error">Lost connection while loading your friends. Try refreshing the page.</p>`;
      revealNav();
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
    ? ` Add the other ${rest.length} with the "+" button in that chat - the full roster is on your clipboard.`
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

  const groupDiscoverySection = renderDiscoverySection(
    '🎮 Find new games for this group',
    'group-discovery',
    `/api/groups/${group.id}/recommendations`,
    'your group'
  );

  body.appendChild(memberList);
  body.appendChild(addMember);
  body.appendChild(commonGamesSection);
  body.appendChild(groupDiscoverySection);

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
        <option value="small">Small - up to 6</option>
        <option value="medium">Medium - up to 10</option>
        <option value="large">Large - up to 32</option>
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
    list.innerHTML = `<p class="empty">No groups yet - create one above.</p>`;
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

function renderChestView(games, currencies, currency) {
  appEl.innerHTML = `
    <div class="chest-controls">
      <label>Currency:
        <select id="chest-currency">
          ${currencies.map((c) => `<option value="${escapeHtml(c.code)}" ${c.code === currency ? 'selected' : ''}>${escapeHtml(c.code)} (${escapeHtml(c.symbol)})</option>`).join('')}
        </select>
      </label>
    </div>
    <div class="chest-list" id="chest-list"></div>
  `;

  document.getElementById('chest-currency').addEventListener('change', (e) => {
    localStorage.setItem('gic-currency', e.target.value);
    loadChest();
  });

  const list = document.getElementById('chest-list');
  if (games.length === 0) {
    list.innerHTML = `<p class="empty">No saved games yet. Save games from the "Find new games" panel on a friend's card.</p>`;
    return;
  }

  list.innerHTML = games.map((game) => `
    <div class="chest-row" data-appid="${game.appid}">
      ${game.headerImage ? `<img src="${escapeHtml(game.headerImage)}" alt="">` : ''}
      <div class="chest-name">${escapeHtml(game.name)}</div>
      <div class="chest-price">${formatPrice(game)}</div>
      <a href="${escapeHtml(game.storeUrl)}" target="_blank" rel="noopener">View on Steam</a>
      <button class="secondary" data-action="remove">Remove</button>
    </div>
  `).join('');

  list.querySelectorAll('[data-action="remove"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const appid = btn.closest('.chest-row').dataset.appid;
      try {
        await fetchJson(`/api/chest/${appid}`, { method: 'DELETE' });
        loadChest();
      } catch (err) {
        showToast(err.message);
      }
    });
  });
}

async function loadChest() {
  appEl.innerHTML = `<p class="loading">Loading your Game Chest&hellip;</p>`;
  try {
    const currency = getSavedCurrency();
    const [currencies, data] = await Promise.all([
      ensureCurrencies(),
      fetchJson(`/api/chest?currency=${encodeURIComponent(currency)}`),
    ]);
    if (currentView !== 'chest') return;
    if (data.unauthenticated) {
      renderLoggedOut();
      return;
    }
    renderChestView(data.games, currencies, currency);
  } catch (err) {
    appEl.innerHTML = `<p class="error">Something went wrong loading your Game Chest: ${escapeHtml(err.message)}</p>`;
  }
}

const ACCENT_OPTIONS = ['blue', 'violet', 'emerald', 'amber'];

function getPref(key, fallback) {
  return localStorage.getItem(key) || fallback;
}

function resolveTheme(theme) {
  if (theme !== 'system') return theme;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme) {
  localStorage.setItem('gic-theme', theme);
  document.documentElement.setAttribute('data-theme', resolveTheme(theme));
}

function applyAccent(accent) {
  localStorage.setItem('gic-accent', accent);
  document.documentElement.setAttribute('data-accent', accent);
}

function applyDensity(density) {
  localStorage.setItem('gic-density', density);
  document.documentElement.setAttribute('data-density', density);
}

function applyReduceMotion(enabled) {
  localStorage.setItem('gic-reduce-motion', String(enabled));
  document.documentElement.setAttribute('data-reduce-motion', String(enabled));
}

// Keep the resolved theme in sync with the OS while the user has "System" selected.
if (window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (getPref('gic-theme', 'system') === 'system') {
      document.documentElement.setAttribute('data-theme', resolveTheme('system'));
    }
  });
}

function renderSettings() {
  const currentTheme = getPref('gic-theme', 'system');
  const currentAccent = getPref('gic-accent', 'blue');
  const currentDensity = getPref('gic-density', 'comfortable');
  const currentReduceMotion = localStorage.getItem('gic-reduce-motion') === 'true';

  appEl.innerHTML = `
    <h1>Settings</h1>
    <div class="settings-view">
      <section class="settings-section">
        <h2>Appearance</h2>
        <div class="settings-row">
          <div class="settings-label">
            <div class="settings-label-title">Theme</div>
            <div class="settings-label-desc">Choose how Games in Common looks.</div>
          </div>
          <div class="segmented" data-setting="theme">
            <button type="button" data-value="light" class="${currentTheme === 'light' ? 'active' : ''}">Light</button>
            <button type="button" data-value="dark" class="${currentTheme === 'dark' ? 'active' : ''}">Dark</button>
            <button type="button" data-value="system" class="${currentTheme === 'system' ? 'active' : ''}">System</button>
          </div>
        </div>
        <div class="settings-row">
          <div class="settings-label">
            <div class="settings-label-title">Accent colour</div>
            <div class="settings-label-desc">Pick the colour used for buttons and highlights.</div>
          </div>
          <div class="accent-swatches" data-setting="accent">
            ${ACCENT_OPTIONS.map((a) => `<button type="button" class="accent-swatch ${a === currentAccent ? 'active' : ''}" data-value="${a}" title="${a[0].toUpperCase()}${a.slice(1)}"></button>`).join('')}
          </div>
        </div>
        <div class="settings-row">
          <div class="settings-label">
            <div class="settings-label-title">Density</div>
            <div class="settings-label-desc">Compact fits more on screen; comfortable is roomier.</div>
          </div>
          <div class="segmented" data-setting="density">
            <button type="button" data-value="comfortable" class="${currentDensity === 'comfortable' ? 'active' : ''}">Comfortable</button>
            <button type="button" data-value="compact" class="${currentDensity === 'compact' ? 'active' : ''}">Compact</button>
          </div>
        </div>
        <div class="settings-row">
          <div class="settings-label">
            <div class="settings-label-title">Reduce motion</div>
            <div class="settings-label-desc">Turn off transitions and animations.</div>
          </div>
          <label class="switch">
            <input type="checkbox" id="reduce-motion-toggle" ${currentReduceMotion ? 'checked' : ''}>
            <span class="switch-track"></span>
          </label>
        </div>
      </section>
    </div>
  `;

  appEl.querySelectorAll('.segmented[data-setting]').forEach((group) => {
    const setting = group.dataset.setting;
    group.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        const value = btn.dataset.value;
        if (setting === 'theme') applyTheme(value);
        else if (setting === 'density') applyDensity(value);
        group.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === btn));
      });
    });
  });

  appEl.querySelectorAll('.accent-swatch').forEach((btn) => {
    btn.addEventListener('click', () => {
      applyAccent(btn.dataset.value);
      appEl.querySelectorAll('.accent-swatch').forEach((b) => b.classList.toggle('active', b === btn));
    });
  });

  document.getElementById('reduce-motion-toggle').addEventListener('change', (e) => {
    applyReduceMotion(e.target.checked);
  });
}

let currentView = 'friends';

function switchView(view) {
  currentView = view;
  document.querySelectorAll('.nav-tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });
  if (view === 'friends') {
    loadCommonGames();
  } else if (view === 'groups') {
    loadGroups();
  } else if (view === 'chest') {
    loadChest();
  } else if (view === 'settings') {
    renderSettings();
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
  nav.querySelectorAll('.nav-tab').forEach((btn) => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  switchView('friends');
}

init();
