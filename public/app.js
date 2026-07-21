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

  source.onmessage = (event) => {
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
    appEl.innerHTML = `<p class="error">Lost connection while loading your friends. Try refreshing the page.</p>`;
  };
}

async function init() {
  const me = await fetchJson('/api/me');
  if (me.unauthenticated) {
    renderLoggedOut();
    return;
  }
  renderAccount(me);
  loadCommonGames();
}

init();
