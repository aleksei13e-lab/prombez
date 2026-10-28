// Генератор: собирает кроссворд через POST /api/generate и монтирует игровую логику
import { api, setStatus } from './app.js';
import { mountPlayUI } from './play-common.js';

const status = document.getElementById('gen-status');
const btnGenerate = document.getElementById('btn-generate');
const btnCheck = document.getElementById('btn-check');
const btnHint = document.getElementById('btn-hint');
const btnReset = document.getElementById('btn-reset');
const btnPrint = document.getElementById('btn-print');

btnGenerate.addEventListener('click', async () => {
  const themes = [...document.querySelectorAll('input[name="theme"]:checked')].map(i => i.value);
  const count = Number(document.getElementById('count').value);

  if (themes.length === 0) { setStatus(status, 'Выберите хотя бы одну тему.', 'bad'); return; }
  if (!(count >= 5 && count <= 20)) { setStatus(status, 'Количество слов — от 5 до 20.', 'bad'); return; }

  btnGenerate.disabled = true;
  setStatus(status, 'Собираем кроссворд на сервере…');
  try {
    const res = await api('/api/generate', {
      method: 'POST',
      body: JSON.stringify({ themes, count })
    });
    setStatus(status, `Готово: ${res.skeleton.stats.total} слов в сетке.` +
      (res.unplaced?.length ? ` Не поместились: ${res.unplaced.join(', ')}.` : ''));
    btnCheck.disabled = btnHint.disabled = btnReset.disabled = false;
    mountPlayUI(res.skeleton, {
      progressId: res.id,
      statusEl: status,
      buttons: { check: btnCheck, hint: btnHint, reset: btnReset, print: btnPrint }
    });
  } catch (e) {
    setStatus(status, e.message, 'bad');
  } finally {
    btnGenerate.disabled = false;
  }
});
