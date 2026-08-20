/* ============================================================
   UTA Browser — общие скрипты (API, история, пользователь)
   ============================================================ */
window.UTA = (function () {
  const ENGINES = {
    ddg: (q) => 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q),
    google: (q) => 'https://www.google.com/search?q=' + encodeURIComponent(q),
    yandex: (q) => 'https://yandex.ru/search/?text=' + encodeURIComponent(q),
    bing: (q) => 'https://www.bing.com/search?q=' + encodeURIComponent(q),
  };

  const ENGINE_NAMES = { ddg: 'DuckDuckGo', google: 'Google', yandex: 'Яндекс', bing: 'Bing' };

  // Похоже ли на адрес сайта? (не запрос)
  function isUrl(input) {
    const s = input.trim();
    if (/^https?:\/\//i.test(s)) return true;
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(s) && !s.includes(' ');
  }

  // Строка ввода -> { type: 'url'|'search', value }
  function buildTarget(input, engine) {
    const s = input.trim();
    if (isUrl(s)) {
      return { type: 'url', value: /^https?:\/\//i.test(s) ? s : 'https://' + s };
    }
    const fn = ENGINES[engine] || ENGINES.ddg;
    return { type: 'search', value: fn(s) };
  }

  // Открыть адрес в новой вкладке (без прокси — напрямую).
  function openTarget(url) {
    try {
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {
      window.open(url, '_blank', 'noopener');
    }
  }

  async function api(path, options) {
    const res = await fetch(path, options);
    return res.json();
  }

  async function getMe() {
    try {
      const data = await api('/api/me');
      return data.user || null;
    } catch {
      return null;
    }
  }

  // ---------- История (localStorage) ----------
  const HISTORY_KEY = 'uta_history';
  const HISTORY_MAX = 30;

  function getHistory() {
    try {
      return JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
    } catch {
      return [];
    }
  }

  function addHistory(entry) {
    let list = getHistory();
    list = list.filter((h) => h.url !== entry.url);
    list.unshift(entry);
    list = list.slice(0, HISTORY_MAX);
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
    } catch {}
  }

  function clearHistory() {
    localStorage.removeItem(HISTORY_KEY);
  }

  // ---------- Аватар ----------
  function initials(name) {
    return String(name || '?')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0])
      .join('')
      .toUpperCase();
  }

  // ---------- Карточка пользователя в шапке ----------
  async function renderUserChip(container) {
    if (!container) return;
    const user = await getMe();

    if (!user) {
      container.innerHTML =
        '<a class="btn btn-primary" href="/login">Войти</a>';
      return;
    }

    const img = user.avatar
      ? `<img class="avatar" src="${user.avatar.replace(/"/g, '&quot;')}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'avatar-fallback',textContent:UTA.initials(${JSON.stringify(user.name)})}))">`
      : `<div class="avatar-fallback">${initials(user.name)}</div>`;

    container.innerHTML = `
      <div class="user-chip" id="userChip">
        ${img}
        <span class="name"></span>
        <div class="user-menu" id="userMenu">
          <div class="email"></div>
          <button id="logoutBtn">Выйти из аккаунта</button>
        </div>
      </div>`;
    container.querySelector('.name').textContent = user.name;
    container.querySelector('.email').textContent = user.email || '';

    const chip = container.querySelector('#userChip');
    const menu = container.querySelector('#userMenu');
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.classList.toggle('open');
    });
    document.addEventListener('click', () => menu.classList.remove('open'));

    container.querySelector('#logoutBtn').addEventListener('click', async () => {
      await api('/api/logout', { method: 'POST' });
      location.reload();
    });
  }

  // ---------- Тост ----------
  function toast(message, ms = 3200) {
    let el = document.getElementById('utaToast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'utaToast';
      el.className = 'toast';
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), ms);
  }

  return {
    ENGINES,
    ENGINE_NAMES,
    isUrl,
    buildTarget,
    openTarget,
    api,
    getMe,
    getHistory,
    addHistory,
    clearHistory,
    initials,
    renderUserChip,
    toast,
  };
})();
