// ============================================================
//  UTA Browser — сервер
//  Простой браузер: главная страница с поиском, открытие
//  сайтов напрямую и вход в аккаунт через Google (OAuth 2.0).
// ============================================================
require('dotenv').config();

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const Store = require('./lib/store');

const PORT = process.env.PORT || 3000;
const SESSION_DAYS = 30;

const app = express();
app.set('trust proxy', 1); // за прокси (preview-окружение) req.protocol = https
app.use(express.urlencoded({ extended: false, limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Хранилища ----------
const users = new Store('users.json'); // id -> пользователь
const sessions = new Store('sessions.json'); // токен -> id пользователя

// ---------- Google OAuth ----------
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const isGoogleConfigured = Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);

const oauthStates = new Map(); // state -> время истечения (10 минут)

// ---------- Помощники ----------
function baseUrl(req) {
  return `${req.protocol}://${req.get('host')}`;
}

function googleRedirectUri(req) {
  return process.env.GOOGLE_REDIRECT_URI || `${baseUrl(req)}/auth/google/callback`;
}

function setSessionCookie(res, token) {
  res.setHeader(
    'Set-Cookie',
    `uta_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 24 * 3600}`
  );
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'uta_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, avatar: user.avatar };
}

// Достаём пользователя из cookie-сессии
app.use((req, res, next) => {
  const cookies = (req.headers.cookie || '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  const session = cookies.find((s) => s.startsWith('uta_session='));
  req.token = session ? session.slice('uta_session='.length) : null;
  req.user = req.token ? users.get(sessions.get(req.token)) || null : null;
  next();
});

// ---------- Страницы ----------
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));

// ---------- API аккаунта ----------
app.get('/api/me', (req, res) => {
  res.json({ user: req.user ? publicUser(req.user) : null });
});

app.post('/api/logout', (req, res) => {
  if (req.token) sessions.del(req.token);
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/api/authinfo', (req, res) => {
  res.json({ google: isGoogleConfigured });
});

// ---------- Вход через Google ----------
// Шаг 1: перенаправляем пользователя на страницу Google
app.get('/auth/google', (req, res) => {
  if (!isGoogleConfigured) return res.redirect('/auth/demo');
  const state = crypto.randomBytes(16).toString('hex');
  oauthStates.set(state, Date.now() + 10 * 60 * 1000);
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: googleRedirectUri(req),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

// Шаг 2: Google вернул код — обмениваем его на токен и получаем профиль.
// Первый вход автоматически создаёт аккаунт (это и есть "регистрация").
app.get('/auth/google/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error || !code || !state || !oauthStates.has(state) || oauthStates.get(state) < Date.now()) {
    return res.redirect('/login?error=auth');
  }
  oauthStates.delete(state);

  try {
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: googleRedirectUri(req),
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenResponse.ok) throw new Error('token exchange failed');
    const tokens = await tokenResponse.json();

    const infoResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (!infoResponse.ok) throw new Error('userinfo failed');
    const info = await infoResponse.json();

    let user = Object.values(users.all()).find((u) => u.googleId === info.sub);
    if (!user) {
      user = {
        id: crypto.randomUUID(),
        googleId: info.sub,
        name: info.name || info.email || 'Пользователь UTA',
        email: info.email || '',
        avatar: info.picture || null,
        createdAt: new Date().toISOString(),
      };
    } else {
      user.name = info.name || user.name;
      user.avatar = info.picture || user.avatar;
    }
    users.set(user.id, user);

    const token = crypto.randomBytes(24).toString('hex');
    sessions.set(token, user.id);
    setSessionCookie(res, token);
    res.redirect('/?welcome=1');
  } catch (err) {
    console.error('Google auth error:', err.message);
    res.redirect('/login?error=auth');
  }
});

// Демо-вход: работает без настройки Google-ключей (для тестов)
app.get('/auth/demo', (req, res) => {
  let user = Object.values(users.all()).find((u) => u.googleId === 'demo');
  if (!user) {
    user = {
      id: crypto.randomUUID(),
      googleId: 'demo',
      name: 'Тестовый пользователь',
      email: 'demo@uta.browser',
      avatar: null,
      createdAt: new Date().toISOString(),
    };
  }
  users.set(user.id, user);

  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, user.id);
  setSessionCookie(res, token);
  res.redirect('/?welcome=1');
});

// ---------- 404 ----------
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🦊 UTA Browser запущен: http://localhost:${PORT}`);
  if (!isGoogleConfigured) {
    console.log('ℹ️  Google OAuth не настроен — вход работает в демо-режиме (см. .env.example)');
  }
});
