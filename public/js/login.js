/* Страница входа: Google OAuth или демо-режим */
(function () {
  const U = window.UTA;

  const googleBtn = document.getElementById('googleLoginBtn');
  const demoBtn = document.getElementById('demoLoginBtn');
  const actions = document.getElementById('authActions');
  const loggedIn = document.getElementById('loggedIn');
  const note = document.getElementById('authNote');
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
        // Настроен настоящий вход через Google
        googleBtn.addEventListener('click', () => {
          location.href = '/auth/google';
        });
        demoBtn.style.display = 'none';
        document.querySelector('.divider').style.display = 'none';
        note.textContent = 'Аккаунт UTA создаётся автоматически при первом входе через Google.';
      } else {
        // Google OAuth не настроен на сервере — демо-режим
        googleBtn.style.display = 'none';
        document.querySelector('.divider').style.display = 'none';
        demoBtn.addEventListener('click', () => {
          location.href = '/auth/demo';
        });
        note.textContent =
          '⚠️ Вход через Google пока не настроен на сервере, поэтому доступен демо-вход. ' +
          'Инструкция по настройке Google OAuth — в README.';
      }
    } catch {
      demoBtn.addEventListener('click', () => {
        location.href = '/auth/demo';
      });
      googleBtn.style.display = 'none';
      document.querySelector('.divider').style.display = 'none';
    }
  });
})();
