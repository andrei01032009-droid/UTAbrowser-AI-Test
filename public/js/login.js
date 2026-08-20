/* Страница входа: Google OAuth или демо-режим.
   Обе кнопки — настоящие ссылки, поэтому работают всегда,
   даже если скрипты не успели загрузиться. */
(function () {
  const U = window.UTA;

  const googleBtn = document.getElementById('googleLoginBtn');
  const demoBtn = document.getElementById('demoLoginBtn');
  const divider = document.getElementById('divider');
  const actions = document.getElementById('authActions');
  const loggedIn = document.getElementById('loggedIn');
  const note = document.getElementById('authNote');
  const sub = document.getElementById('authSub');
  const errorBox = document.getElementById('authError');

  const params = new URLSearchParams(location.search);
  if (params.get('error') === 'auth') {
    errorBox.style.display = 'block';
    errorBox.textContent = 'Не удалось войти через Google. Попробуй ещё раз.';
  }

  U.getMe().then(async (user) => {
    if (user) {
      actions.style.display = 'none';
      loggedIn.style.display = 'block';
      return;
    }

    try {
      const info = await U.api('/api/authinfo');
      if (info.google) {
        // Настоящий вход через Google настроен на сервере
        demoBtn.style.display = 'none';
        divider.style.display = 'none';
        note.textContent = 'Аккаунт UTA создаётся автоматически при первом входе через Google.';
      } else {
        // Google OAuth не настроен: кнопка Google ведёт в демо-вход
        sub.textContent = 'Сейчас включён демо-режим входа.';
        googleBtn.style.display = 'none';
        divider.style.display = 'none';
        note.textContent =
          'Настоящий вход через Google появится, когда в .env будут добавлены ключи Google OAuth. ' +
          'Инструкция — в README.';
      }
    } catch {
      // Сервер недоступен — оставляем обе кнопки как есть
      note.textContent = 'Не удалось проверить настройки сервера — попробуй демо-вход.';
    }
  });
})();
