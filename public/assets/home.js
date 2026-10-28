// Главная: кнопка «Решать» создаёт кроссворд темы через сервер и ведёт на /play/:id
import { api, setStatus } from './app.js';

const status = document.getElementById('home-status');

document.querySelectorAll('button[data-solve]').forEach(btn => {
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    setStatus(status, 'Собираем кроссворд на сервере…');
    try {
      const res = await api('/api/generate', {
        method: 'POST',
        body: JSON.stringify({ themes: [btn.dataset.solve], count: Number(btn.dataset.count) })
      });
      location.href = '/play/' + res.id;
    } catch (e) {
      setStatus(status, e.message, 'bad');
      btn.disabled = false;
    }
  });
});
