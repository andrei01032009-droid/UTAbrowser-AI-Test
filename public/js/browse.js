/* ============================================================
   Окно браузера: адресная строка, назад/вперёд/обновить,
   серверный прокси + запасной режим загрузки.
   ============================================================ */
(function () {
  const U = window.UTA;
  const ENGINE_KEY = 'uta_engine';

  const frame = document.getElementById('view');
  const addressInput = document.getElementById('addressInput');
  const backBtn = document.getElementById('backBtn');
  const forwardBtn = document.getElementById('forwardBtn');
  const reloadBtn = document.getElementById('reloadBtn');
  const homeBtn = document.getElementById('homeBtn');
  const externalBtn = document.getElementById('externalBtn');
  const loadingLine = document.getElementById('loadingLine');
  const lockIcon = document.getElementById('lockIcon');

  // История текущей вкладки: { finalUrl, proxied?, blobUrl?, mode, title }
  let stack = [];
  let index = -1;
  let pendingMode = null; // 'server' | 'fallback' | 'failed' | null
  let pendingSince = 0;
  let serverEgress = 'direct'; // 'direct' | 'limited' — может ли сервер сам выходить в сеть

  function engine() {
    const saved = localStorage.getItem(ENGINE_KEY);
    return U.ENGINES[saved] ? saved : 'ddg';
  }

  /* ============================================================
     Запасной режим: загрузка через публичные CORS-прокси
     (нужен, когда сервер UTA не может сам выйти в интернет)
     ============================================================ */
  const CORS_PROXIES = [
    (u) => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u),
    (u) => 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(u),
    (u) => 'https://api.cors.lol/?url=' + encodeURIComponent(u),
    (u) => 'https://cors.eu.org/' + encodeURIComponent(u),
  ];

  // Скрипт, встраиваемый в страницы запасного режима.
  // Клики и формы отправляются родительскому окну через postMessage.
  const NAV_FALLBACK = `<script>
(function () {
  'use strict';
  var FINAL = __FINAL_URL__;
  function abs(h) { try { return new URL(h, FINAL).href; } catch (e) { return null; } }
  function isSpecial(h) { return /^(#|javascript:|mailto:|tel:|data:|blob:)/i.test(String(h).trim()); }

  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || a.hasAttribute('download')) return;
    var href = a.getAttribute('href');
    if (!href || isSpecial(href)) return;
    e.preventDefault();
    e.stopPropagation();
    var u = abs(href);
    if (!u) return;
    if (a.target && a.target.toLowerCase() !== '_self') {
      parent.postMessage({ uta: true, type: 'open', url: u }, '*');
    } else {
      parent.postMessage({ uta: true, type: 'go', url: u }, '*');
    }
  }, true);

  document.addEventListener('submit', function (e) {
    var f = e.target;
    if (!f || f.tagName !== 'FORM' || e.defaultPrevented) return;
    e.preventDefault();
    e.stopPropagation();
    var action = f.getAttribute('action');
    var target;
    try { target = new URL(action || FINAL, FINAL).href; } catch (err) { return; }
    var qs = new URLSearchParams(new FormData(f)).toString();
    var sep = target.indexOf('?') === -1 ? '?' : '&';
    parent.postMessage({ uta: true, type: 'go', url: target + (qs ? sep + qs : '') }, '*');
  }, true);

  var posted = false;
  function post() {
    if (posted) return;
    posted = true;
    try {
      parent.postMessage({
        uta: true,
        type: 'nav',
        url: location.href,
        finalUrl: FINAL,
        title: (document.title || '').trim() || FINAL
      }, '*');
    } catch (e) {}
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', post);
    setTimeout(post, 4000);
  } else {
    post();
  }
})();
</script>`;

  function escapeAttr(value) {
    return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  }

  // Переписывает HTML для показа из blob: убираем чужие base/CSP/refresh,
  // добавляем <base href="настоящий адрес"> и навигационный скрипт.
  function clientRewrite(html, finalUrl) {
    html = html.replace(/<base\b[^>]*>/gi, '');
    html = html.replace(
      /<meta[^>]+http-equiv\s*=\s*["']?\s*(?:content-security-policy|x-frame-options|refresh)\b[^>]*>/gi,
      ''
    );
    const inject =
      `<base href="${escapeAttr(finalUrl)}">\n` +
      `<meta name="referrer" content="no-referrer">\n` +
      NAV_FALLBACK.replace('__FINAL_URL__', JSON.stringify(finalUrl));
    if (/<head[^>]*>/i.test(html)) {
      html = html.replace(/<head[^>]*>/i, (m) => `${m}\n${inject}`);
    } else if (/<html[^>]*>/i.test(html)) {
      html = html.replace(/<html[^>]*>/i, (m) => `${m}\n<head>${inject}</head>`);
    } else {
      html = `<!doctype html><html><head>${inject}</head><body>${html}</body></html>`;
    }
    return html;
  }

  async function fetchWithTimeout(url, ms) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try {
      return await fetch(url, { signal: controller.signal, redirect: 'follow' });
    } finally {
      clearTimeout(timer);
    }
  }

  // Загрузка страницы в запасном режиме (перебираем прокси по очереди).
  // reuse=true — перезаписать текущую запись истории вместо новой.
  async function fallbackLoad(url, { reuse = false } = {}) {
    pendingMode = 'fallback';
    pendingSince = Date.now();
    loadingLine.classList.add('active');

    let entry;
    if (reuse && stack[index] && stack[index].finalUrl === url) {
      entry = stack[index];
    } else {
      index += 1;
      stack = stack.slice(0, index);
      entry = { finalUrl: url, mode: 'fallback', title: url };
      stack.push(entry);
    }

    for (const build of CORS_PROXIES) {
      try {
        const res = await fetchWithTimeout(build(url), 15000);
        if (!res.ok) continue;
        const ct = (res.headers.get('content-type') || '').toLowerCase();

        if (ct.includes('text/html') || ct.includes('xhtml')) {
          const text = await res.text();
          if (!/^\s*(<!doctype|<html[\s>])/i.test(text)) continue; // не похоже на HTML
          const rewritten = clientRewrite(text, url);
          entry.blobUrl = URL.createObjectURL(
            new Blob([rewritten], { type: 'text/html; charset=utf-8' })
          );
          entry.mode = 'fallback';
          entry.finalUrl = url;
          navigate(entry);
          U.addHistory({ url, title: entry.title, time: Date.now() });
          pendingMode = null;
          loadingLine.classList.remove('active');
          return;
        }

        // Не HTML (картинка, PDF...) — открываем файл в новой вкладке
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        window.open(blobUrl, '_blank');
        U.toast('Файл открыт в новой вкладке');
        pendingMode = null;
        loadingLine.classList.remove('active');
        return;
      } catch {
        // пробуем следующий прокси
      }
    }

    // Ни один прокси не сработал — показываем страницу ошибки сервера,
    // на ней есть кнопка «Открыть напрямую в новой вкладке».
    pendingMode = 'failed';
    loadingLine.classList.remove('active');
    frame.src = U.proxied(url);
    U.toast('Не удалось загрузить сайт — открой его напрямую в новой вкладке');
  }

  /* ============================================================
     Навигация
     ============================================================ */
  function navigate(entry) {
    if (entry.blobUrl) {
      frame.src = entry.blobUrl;
      pendingMode = 'fallback';
    } else if (entry.proxied) {
      frame.src = entry.proxied; // сервер отдаёт Cache-Control: no-store
      pendingMode = 'server';
    } else {
      return;
    }
    pendingSince = Date.now();
    loadingLine.classList.add('active');
    syncControls();
  }

  // Загрузка нового адреса: сначала пробуем серверный прокси
  function loadTarget(url) {
    const proxied = U.proxied(url);
    index += 1;
    stack = stack.slice(0, index);
    stack.push({ proxied, finalUrl: url, mode: 'server', title: url });
    navigate(stack[index]);
  }

  function syncControls() {
    backBtn.disabled = index <= 0;
    forwardBtn.disabled = index >= stack.length - 1;
    const entry = stack[index];
    if (entry) {
      addressInput.value = entry.finalUrl;
      document.title = (entry.title || 'UTA') + ' — UTA';
      try {
        lockIcon.style.color = new URL(entry.finalUrl).protocol === 'https:' ? '#34d399' : '';
      } catch {}
    }
  }

  function goTo(newIndex) {
    if (newIndex < 0 || newIndex >= stack.length) return;
    index = newIndex;
    const entry = stack[index];
    if (entry.proxied || entry.blobUrl) {
      navigate(entry);
    } else {
      fallbackLoad(entry.finalUrl, { reuse: true });
    }
    syncControls();
  }

  backBtn.addEventListener('click', () => goTo(index - 1));
  forwardBtn.addEventListener('click', () => goTo(index + 1));

  reloadBtn.addEventListener('click', () => {
    const entry = stack[index];
    if (!entry) return;
    if (entry.mode === 'fallback') {
      fallbackLoad(entry.finalUrl, { reuse: true });
    } else {
      navigate(entry);
    }
  });

  homeBtn.addEventListener('click', () => {
    location.href = '/';
  });

  externalBtn.addEventListener('click', () => {
    const entry = stack[index];
    if (entry && /^https?:\/\//i.test(entry.finalUrl)) {
      window.open(entry.finalUrl, '_blank');
    }
  });

  // ---------- Адресная строка ----------
  addressInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const target = U.buildTarget(addressInput.value, engine());
      if (!target.value) return;
      loadTarget(target.value);
      addressInput.blur();
    }
  });

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
      e.preventDefault();
      addressInput.focus();
      addressInput.select();
    }
  });

  /* ============================================================
     Сообщения от загруженных страниц
     ============================================================ */
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || d.uta !== true || e.source !== frame.contentWindow) return;

    if (d.type === 'error') {
      // Сервер не смог загрузить сайт -> запасной режим
      if (pendingMode === 'server' && stack[index]) {
        fallbackLoad(stack[index].finalUrl, { reuse: true });
      }
      return;
    }

    if (d.type === 'open' && d.url) {
      window.open('/browse?url=' + encodeURIComponent(d.url), '_blank');
      return;
    }

    if (d.type === 'go' && d.url) {
      fallbackLoad(d.url);
      return;
    }

    if (d.type !== 'nav') return;

    // Сообщение от страницы, загруженной через серверный прокси
    if (pendingMode === 'server' && /^https?:\/\/.+\/proxy\?url=/.test(d.url)) {
      loadingLine.classList.remove('active');
      if (stack[index] && stack[index].proxied === d.url) {
        stack[index].finalUrl = d.finalUrl || stack[index].finalUrl;
        stack[index].title = d.title || stack[index].title;
      } else {
        // Переход по ссылке внутри сайта
        index += 1;
        stack = stack.slice(0, index);
        stack.push({
          proxied: d.url,
          finalUrl: d.finalUrl || d.url,
          mode: 'server',
          title: d.title || d.finalUrl,
        });
      }
      pendingMode = null;
      if (/^https?:\/\//i.test(stack[index].finalUrl)) {
        U.addHistory({ url: stack[index].finalUrl, title: stack[index].title, time: Date.now() });
      }
      syncControls();
      return;
    }

    // Сообщение от страницы запасного режима (blob)
    if (pendingMode === 'fallback' && /^blob:/.test(d.url) && stack[index]) {
      loadingLine.classList.remove('active');
      stack[index].finalUrl = d.finalUrl || stack[index].finalUrl;
      stack[index].title = d.title || stack[index].title;
      pendingMode = null;
      U.addHistory({ url: stack[index].finalUrl, title: stack[index].title, time: Date.now() });
      syncControls();
    }
  });

  /* ============================================================
     Сторожевой таймер
     ============================================================ */
  setInterval(() => {
    if (!loadingLine.classList.contains('active') || !stack[index]) return;
    const wait = Date.now() - pendingSince;

    if (pendingMode === 'server' && wait > 6000) {
      // Сервер что-то отдал без сообщения (картинка, PDF) — прячем полоску
      loadingLine.classList.remove('active');
    }
    // Если сервер вообще не может выходить в сеть, а сайт не загрузился, —
    // пробуем запасной режим сами (не дожидаясь сообщения об ошибке)
    if (serverEgress === 'limited' && pendingMode === 'server' && wait > 20000) {
      fallbackLoad(stack[index].finalUrl, { reuse: true });
    }
  }, 3000);

  // ---------- Возможности сервера ----------
  U.api('/api/servercap')
    .then((cap) => {
      serverEgress = cap && cap.egress === 'limited' ? 'limited' : 'direct';
    })
    .catch(() => {});

  // ---------- Старт ----------
  const params = new URLSearchParams(location.search);
  let target = null;

  if (params.get('url')) {
    target = U.buildTarget(params.get('url'), engine());
    if (target.type !== 'url') {
      target = { type: 'search', value: U.ENGINES[engine()](params.get('url')) };
    }
  } else if (params.get('q')) {
    const eng = U.ENGINES[params.get('engine')] ? params.get('engine') : engine();
    target = { type: 'search', value: U.ENGINES[eng](params.get('q')) };
  }

  if (target && target.value) {
    loadTarget(target.value);
  } else {
    location.href = '/';
  }

  U.renderUserChip(document.getElementById('userArea'));
})();
