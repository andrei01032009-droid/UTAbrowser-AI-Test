// Прокси-ядро браузера UTA.
// Загружает страницу на сервере, переписывает её так, чтобы ссылки и формы
// работали через наш прокси, и защищает приложение песочницей (CSP sandbox).

const MAX_HTML_BYTES = 8 * 1024 * 1024; // 8 МБ — защита от огромных страниц
const TIMEOUT_MS = 20000;

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// Скрипт, который встраивается в каждую загруженную страницу.
// Он перехватывает клики по ссылкам и отправку форм, направляя их через прокси,
// и сообщает родительскому окну (панели браузера) текущий адрес и заголовок.
//
// Все внутренние переходы строятся как АБСОЛЮТНЫЕ адреса от ROOT (адрес сервера
// UTA), чтобы <base href> исходного сайта не влиял на них.
const NAV_SCRIPT = `<script>
(function () {
  'use strict';
  var FINAL = __FINAL_URL__;
  var ROOT = __ROOT__;
  if (!ROOT) { try { ROOT = new URL(location.href).origin; } catch (e) {} }

  function prox(href) {
    try {
      return ROOT + '/proxy?url=' + encodeURIComponent(new URL(href, document.baseURI || FINAL).href);
    } catch (e) {
      return null;
    }
  }

  function isSpecial(href) {
    return /^(#|javascript:|mailto:|tel:|data:|blob:)/i.test(String(href).trim());
  }

  // Клики по ссылкам -> через прокси
  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || a.hasAttribute('download')) return;
    var href = a.getAttribute('href');
    if (!href || isSpecial(href)) return;
    e.preventDefault();
    e.stopPropagation();
    var p = prox(href);
    if (!p) return;
    if (a.target && a.target.toLowerCase() !== '_self') {
      var w = window.open(p, '_blank');
      if (!w) location.href = p;
    } else {
      location.href = p;
    }
  }, true);

  // Отправка форм -> через прокси
  document.addEventListener('submit', function (e) {
    var f = e.target;
    if (!f || f.tagName !== 'FORM' || e.defaultPrevented) return;
    var method = (f.getAttribute('method') || 'get').toLowerCase();
    var action = f.getAttribute('action') || document.baseURI || FINAL;
    var target;
    try { target = new URL(action, document.baseURI || FINAL).href; } catch (err) { return; }
    e.preventDefault();
    e.stopPropagation();
    if (method === 'get') {
      var qs = new URLSearchParams(new FormData(f)).toString();
      var sep = target.indexOf('?') === -1 ? '?' : '&';
      location.href = ROOT + '/proxy?url=' + encodeURIComponent(target + (qs ? sep + qs : ''));
    } else {
      var hf = document.createElement('form');
      hf.method = 'post';
      hf.action = ROOT + '/proxy?url=' + encodeURIComponent(target);
      hf.style.display = 'none';
      new FormData(f).forEach(function (v, k) {
        var i = document.createElement('input');
        i.type = 'hidden';
        i.name = k;
        i.value = v;
        hf.appendChild(i);
      });
      document.body.appendChild(hf);
      hf.submit();
    }
  }, true);

  // Сообщаем панели браузера, куда мы приехали
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

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Переписывает HTML: убирает чужие <base> и CSP, переписывает meta refresh,
// встраивает <base>, referrer и навигационный скрипт.
// root — адрес сервера UTA (например, https://host), для абсолютных ссылок прокси.
function rewrite(html, finalUrl, root) {
  // 1) Убираем существующие <base> и мета-теги CSP/X-Frame-Options
  html = html.replace(/<base\b[^>]*>/gi, '');
  html = html.replace(
    /<meta[^>]+http-equiv\s*=\s*["']?\s*(?:content-security-policy|x-frame-options)\b[^>]*>/gi,
    ''
  );

  // 2) Переписываем meta refresh (автопереходы сайтов) через прокси
  html = html.replace(/<meta\b[^>]*>/gi, (meta) => {
    if (!/http-equiv\s*=\s*["']?refresh/i.test(meta)) return meta;
    const contentMatch = meta.match(/content\s*=\s*["']([^"']*)["']/i);
    if (!contentMatch) return meta;
    const parts = contentMatch[1].split(/;\s*/);
    const delay = parts[0] || '0';
    const urlPart = parts.slice(1).join(';');
    const urlMatch = urlPart.match(/url\s*=\s*(.+)/i);
    if (!urlMatch) return meta;
    let href = urlMatch[1].trim().replace(/^['"]|['"]$/g, '');
    try {
      href = new URL(href, finalUrl).href;
    } catch {
      return meta;
    }
    const newContent = `${delay}; url=${root ? root + '/' : '/'}proxy?url=${encodeURIComponent(href)}`;
    return meta.replace(contentMatch[1], newContent);
  });

  // 3) Встраиваем <base>, referrer и скрипт навигации в <head>
  const inject =
    `<base href="${escapeHtml(finalUrl)}">\n` +
    `<meta name="referrer" content="no-referrer">\n` +
    NAV_SCRIPT
      .replace('__FINAL_URL__', JSON.stringify(finalUrl))
      .replace('__ROOT__', JSON.stringify(root || ''));

  if (/<head[^>]*>/i.test(html)) {
    html = html.replace(/<head[^>]*>/i, (m) => `${m}\n${inject}`);
  } else if (/<html[^>]*>/i.test(html)) {
    html = html.replace(/<html[^>]*>/i, (m) => `${m}\n<head>${inject}</head>`);
  } else {
    html = `<!doctype html><html><head>${inject}</head><body>${html}</body></html>`;
  }

  return html;
}

// Загружает URL и возвращает готовый к показу контент.
// Опции: method ('GET'/'POST'), body (строка form-urlencoded), root (адрес UTA).
async function fetchAndRewrite(url, { method = 'GET', body = null, root = '' } = {}) {
  const response = await fetch(url, {
    method,
    body,
    redirect: 'follow',
    headers: {
      'User-Agent': BROWSER_UA,
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'ru,en;q=0.9',
      ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const finalUrl = response.url || url;
  const contentType = (response.headers.get('content-type') || '').toLowerCase();

  if (!contentType.includes('text/html') && !contentType.includes('xhtml')) {
    // Не HTML (картинка, PDF, файл...) — отдаём как есть
    const buffer = Buffer.from(await response.arrayBuffer());
    return { html: buffer, contentType: contentType || 'application/octet-stream', finalUrl, binary: true };
  }

  let text = await response.text();
  if (Buffer.byteLength(text) > MAX_HTML_BYTES) {
    text = text.slice(0, MAX_HTML_BYTES);
  }

  return {
    html: rewrite(text, finalUrl, root),
    contentType: 'text/html; charset=utf-8',
    finalUrl,
    binary: false,
  };
}

module.exports = { fetchAndRewrite, rewrite };
