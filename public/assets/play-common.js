// Общая логика страницы решения: сетка, вопросы, Проверить / Подсказка / Сбросить.
// Используется и студенческой страницей /play/:id, и генератором.
// Ответов в клиенте нет: проверка — только серверная (/api/check).
import { CrosswordBoard } from './crossword.js';
import { api, loadProgress, saveProgress, clearProgress, setStatus } from './app.js';

export function mountPlayUI(skeleton, { progressId, statusEl, buttons = {} }) {
  const boardEl = document.getElementById('cw-board');
  const inputEl = document.getElementById('cw-input');
  const cluesH = document.getElementById('clues-h');
  const cluesV = document.getElementById('clues-v');
  const boardSection = document.getElementById('board-section');
  const titleEl = document.getElementById('cw-title');

  boardSection.hidden = false;
  titleEl.textContent = skeleton.title || 'Кроссворд';

  const progress = loadProgress(progressId);
  progress.sessionId = progress.sessionId || (() => {
    // sessionId из app.js — импортируем отдельно, чтобы не дублировать
    return null;
  })();

  const board = new CrosswordBoard(boardEl, skeleton, {
    letters: progress.letters,
    onChange: () => saveProgress(progressId, { sessionId: progress.sessionId, letters: board.letters })
  });

  // Вопросы: по горизонтали и вертикали, в порядке номеров
  const hs = skeleton.words.filter(w => w.dir === 'h').sort((a, b) => a.number - b.number);
  const vs = skeleton.words.filter(w => w.dir === 'v').sort((a, b) => a.number - b.number);
  const fillClues = (ol, list) => {
    ol.replaceChildren(...list.map(w => {
      const li = document.createElement('li');
      li.dataset.index = w.index;
      const b = document.createElement('span');
      b.className = 'clue-num';
      b.textContent = w.number + '. ';
      li.appendChild(b);
      li.appendChild(document.createTextNode(w.clue));
      li.addEventListener('click', () => board.select(w, 0));
      return li;
    }));
  };
  fillClues(cluesH, hs);
  fillClues(cluesV, vs);

  // Выбор слова кликом по вопросу -> фокус на скрытый input (мобильная клавиатура)
  [cluesH, cluesV].forEach(ol => ol.addEventListener('click', () => inputEl.focus()));
  boardEl.addEventListener('click', () => inputEl.focus());

  // Клавиатура: физическая — на документе, экранная — через скрытый input
  document.addEventListener('keydown', e => {
    if (e.target.closest('input, textarea, select') && e.target !== inputEl) return;
    if (board.handleKey(e)) {
      saveProgress(progressId, { sessionId: progress.sessionId, letters: board.letters });
      setStatus(statusEl, '');
    }
  });
  inputEl.addEventListener('input', () => {
    const v = inputEl.value;
    inputEl.value = '';
    for (const ch of v) board.inputLetter(ch);
    saveProgress(progressId, { sessionId: progress.sessionId, letters: board.letters });
  });

  // Проверка — только на сервере
  buttons.check?.addEventListener('click', async () => {
    try {
      setStatus(statusEl, 'Проверяем…');
      const res = await api('/api/check', {
        method: 'POST',
        body: JSON.stringify({ id: skeleton.id, sessionId: progress.sessionId, letters: board.letters })
      });
      board.paintResults(res.results);
      for (const r of res.results) {
        const li = document.querySelector(`.clues li[data-index="${r.index}"]`);
        if (li && r.correct !== null) li.className = r.correct ? 'state-ok' : 'state-bad';
      }
      if (res.finished) {
        setStatus(statusEl, `Поздравляем! Кроссворд решён полностью: верно ${res.correct} из ${res.total}.`, 'ok');
        if (res.answers) {
          const box = document.createElement('div');
          box.className = 'result-box';
          const h = document.createElement('h3');
          h.textContent = 'Ответы';
          box.appendChild(h);
          for (const a of res.answers.sort((x, y) => x.number - y.number)) {
            const p = document.createElement('div');
            p.textContent = `${a.number} (${a.dir === 'h' ? 'по горизонтали' : 'по вертикали'}): ${a.answer}`;
            box.appendChild(p);
          }
          boardSection.appendChild(box);
        }
      } else {
        setStatus(statusEl, `Полностью заполнено и проверено: верно ${res.correct} из ${res.total}.`, res.correct === res.total ? 'ok' : '');
      }
    } catch (e) {
      board.clearResults();
      setStatus(statusEl, e.message, 'bad');
    }
  });

  // Подсказка — сервер открывает одну букву
  buttons.hint?.addEventListener('click', async () => {
    try {
      const res = await api('/api/hint', {
        method: 'POST',
        body: JSON.stringify({ id: skeleton.id, sessionId: progress.sessionId, letters: board.letters })
      });
      if (res.done) { setStatus(statusEl, 'Все клетки уже заполнены.'); return; }
      board.setCell(res.row + ',' + res.col, res.letter);
      saveProgress(progressId, { sessionId: progress.sessionId, letters: board.letters });
      setStatus(statusEl, `Открыта буква. Осталось подсказок: ${res.remaining}.`);
    } catch (e) {
      setStatus(statusEl, e.message, 'bad');
    }
  });

  // Сброс локального прогресса
  buttons.reset?.addEventListener('click', () => {
    if (!confirm('Очистить все введённые буквы?')) return;
    clearProgress(progressId);
    location.reload();
  });

  // Печать пустой сетки с вопросами (без ответов)
  if (buttons.print) {
    buttons.print.hidden = false;
    buttons.print.addEventListener('click', () => window.print());
  }

  inputEl.focus();
  return board;
}
