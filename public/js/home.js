/* Главная страница: поиск, выбор поисковика, история, вход */
(function () {
  const U = window.UTA;
  const ENGINE_KEY = 'uta_engine';

  const form = document.getElementById('searchForm');
  const input = document.getElementById('searchInput');
  const engineBtn = document.getElementById('engineBtn');
  const enginePop = document.getElementById('enginePop');
  const engineLabel = document.getElementById('engineLabel');
  const historyGrid = document.getElementById('historyGrid');
  const clearBtn = document.getElementById('clearHistory');

  // ---------- Поисковик ----------
  function currentEngine() {
    const saved = localStorage.getItem(ENGINE_KEY);
    return U.ENGINES[saved] ? saved : 'ddg';
  }

  function syncEngineUI() {
    const engine = currentEngine();
    engineLabel.textContent = U.ENGINE_NAMES[engine];
    enginePop.querySelectorAll('input[name="engine"]').forEach((r) => {
      r.checked = r.value === engine;
    });
  }

  engineBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    enginePop.classList.toggle('open');
  });
  document.addEventListener('click', () => enginePop.classList.remove('open'));
  enginePop.addEventListener('click', (e) => e.stopPropagation());

  enginePop.addEventListener('change', (e) => {
    localStorage.setItem(ENGINE_KEY, e.target.value);
    syncEngineUI();
    enginePop.classList.remove('open');
  });

  // ---------- Поиск ----------
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const target = U.buildTarget(input.value, currentEngine());
    if (!target.value) return;
    if (target.type === 'url') {
      location.href = '/browse?url=' + encodeURIComponent(target.value);
    } else {
      location.href = '/browse?q=' + encodeURIComponent(input.value.trim()) + '&engine=' + currentEngine();
    }
  });

  // ---------- История ----------
  function renderHistory() {
    const list = U.getHistory();
    clearBtn.style.display = list.length ? '' : 'none';
    if (!list.length) {
      historyGrid.innerHTML =
        '<div class="empty-note" style="grid-column:1/-1">Здесь появятся сайты, которые ты посещал в UTA</div>';
      return;
    }
    historyGrid.innerHTML = list
      .map((h) => {
        const host = (() => {
          try {
            return new URL(h.url).hostname.replace(/^www\./, '');
          } catch {
            return h.url;
          }
        })();
        return `
          <a class="history-card" href="/browse?url=${encodeURIComponent(h.url)}">
            <div class="dot">${host.slice(0, 1).toUpperCase()}</div>
            <div class="info">
              <div class="title"></div>
              <div class="url"></div>
            </div>
          </a>`;
      })
      .join('');
    historyGrid.querySelectorAll('.history-card').forEach((card, i) => {
      card.querySelector('.title').textContent = list[i].title || list[i].url;
      card.querySelector('.url').textContent = list[i].url;
    });
  }

  clearBtn.addEventListener('click', () => {
    U.clearHistory();
    renderHistory();
  });

  // ---------- Аккаунт и приветствие ----------
  U.renderUserChip(document.getElementById('userArea'));

  const params = new URLSearchParams(location.search);
  if (params.get('welcome') === '1') {
    U.getMe().then((user) => {
      if (user) U.toast(`Добро пожаловать, ${user.name}! 👋`);
      history.replaceState(null, '', '/');
    });
  }
  if (params.get('logout') === '1') {
    U.toast('Ты вышел из аккаунта');
  }

  syncEngineUI();
  renderHistory();
})();
