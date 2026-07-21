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

function renderFriends(data) {
  if (data.friends.length === 0) {
    appEl.innerHTML = `<p class="empty">No Steam friends found.</p>`;
    return;
  }

  const list = document.createElement('div');
  list.className = 'friend-list';
  for (const friend of data.friends) {
    list.appendChild(renderFriendCard(friend));
  }
  appEl.innerHTML = '';
  appEl.appendChild(list);
}

async function init() {
  const me = await fetchJson('/api/me');
  if (me.unauthenticated) {
    renderLoggedOut();
    return;
  }
  renderAccount(me);

  appEl.innerHTML = `<p class="loading">Comparing your library with your friends&hellip;</p>`;

  try {
    const data = await fetchJson('/api/common-games');
    if (data.unauthenticated) {
      renderLoggedOut();
      return;
    }
    if (data.error === 'friends-private') {
      appEl.innerHTML = `<p class="error">Your Steam friends list is private. Set it to public in your Steam privacy settings to use this app.</p>`;
      return;
    }
    renderFriends(data);
  } catch (err) {
    appEl.innerHTML = `<p class="error">Something went wrong loading your friends: ${escapeHtml(err.message)}</p>`;
  }
}

init();
