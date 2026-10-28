// Страница студента /play/:id: id берётся из адреса, скелет — с сервера.
// Прогресс (введённые буквы) живёт в LocalStorage этого устройства.
import { api, setStatus } from './app.js';
import { mountPlayUI } from './play-common.js';

const statusEl = document.getElementById('play-status');
const loadEl = document.getElementById('load-status');

// /play/<id> -> страница play.html; извлекаем id из пути
const id = location.pathname.split('/').filter(Boolean)[1] || '';

async function init() {
  if (!/^[A-Za-z0-9_-]{12,64}$/.test(id)) {
    setStatus(loadEl, 'Некорректная ссылка на кроссворд.', 'bad');
    return;
  }
  try {
    const skeleton = await api('/api/crossword/' + id);
    setStatus(loadEl, '');
    mountPlayUI(skeleton, {
      progressId: skeleton.id,
      statusEl,
      buttons: {
        check: document.getElementById('btn-check'),
        hint: document.getElementById('btn-hint'),
        reset: document.getElementById('btn-reset'),
        print: document.getElementById('btn-print')
      }
    });
    // Управление доступно только при загруженном кроссворде
    document.getElementById('btn-check').disabled = false;
    document.getElementById('btn-hint').disabled = false;
    document.getElementById('btn-reset').disabled = false;
    // Кнопка шеринга
    const copy = document.getElementById('btn-copy');
    copy.hidden = false;
    copy.addEventListener('click', async () => {
      const url = location.origin + '/play/' + skeleton.id;
      try {
        await navigator.clipboard.writeText(url);
        setStatus(statusEl, 'Ссылка скопирована: ' + url, 'ok');
      } catch {
        setStatus(statusEl, url);
      }
    });
  } catch (e) {
    setStatus(loadEl, e.message, 'bad');
    document.getElementById('btn-check').disabled = true;
  }
}

init();
