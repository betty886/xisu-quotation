'use strict';
(() => {
  const form = document.getElementById('login-form');
  const error = document.getElementById('login-error');
  form.addEventListener('submit', async event => {
    event.preventDefault();
    error.hidden = true;
    const password = document.getElementById('password').value;
    try {
      const response = await fetch('./api/login', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({password})
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        error.textContent = body.error?.message || '口令不正确。';
        error.hidden = false;
        return;
      }
      location.replace('./');
    } catch {
      error.textContent = '报价服务暂不可用，请稍后重试。';
      error.hidden = false;
    }
  });
})();
