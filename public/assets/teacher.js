// Панель преподавателя: конструктор, публикация, управление своими кроссвордами.
// Токены управления живут только в LocalStorage этого браузера; сервер хранит
// их хеши. Слова банка подставляются на сервере (clueId) — в браузер не попадают.
import { api, setStatus } from './app.js';

const $ = id => document.getElementById(id);
const status = $('teacher-status');

const LS_LIST = 'pbx:teacher:list';
const myList = () => { try { return JSON.parse(localStorage.getItem(LS_LIST) || '[]'); } catch { return []; } };
const saveList = l => localStorage.setItem(LS_LIST, JSON.stringify(l));

// --- Секретная ссылка из адреса: /teacher#<id>|<token> ---
(function captureHash() {
  const m = /^#([A-Za-z0-9_-]{12,64})\|([A-Za-z0-9_-]+)$/.exec(location.hash);
  if (!m) return;
  const [id, token] = [m[1], m[2]];
  const list = myList();
  if (!list.some(x => x.id === id)) {
    list.unshift({ id, token, title: '(без названия)', createdAt: Date.now() });
    saveList(list);
  }
  history.replaceState(null, '', location.pathname); // токен не остаётся в адресной строке
  renderList();
})();

// --- Строки «слово + вопрос» ---
function addRow({ word = '', clue = '', clueId = '' } = {}) {
  const bank = !!clueId;
  const row = document.createElement('div');
  row.className = 'word-row';
  if (bank) row.dataset.clueId = clueId;
  const w = document.createElement('input');
  w.type = 'text';
  w.className = 'w-word';
  w.placeholder = 'Слово';
  w.maxLength = 40;
  w.value = word;
  if (bank) { w.disabled = true; }
  const c = document.createElement('input');
  c.type = 'text';
  c.className = 'w-clue';
  c.placeholder = 'Вопрос (определение)';
  c.maxLength = 500;
  c.value = clue;
  const del = document.createElement('button');
  del.className = 'btn btn-small btn-danger';
  del.type = 'button';
  del.textContent = '✕';
  del.setAttribute('aria-label', 'Удалить строку');
  del.addEventListener('click', () => row.remove());
  row.append(w, c);
  if (bank) {
    const mark = document.createElement('span');
    mark.className = 'bank-mark';
    mark.textContent = 'из банка';
    row.append(mark);
  }
  row.append(del);
  $('word-rows').appendChild(row);
}

$('btn-add-word').addEventListener('click', () => addRow());
addRow(); addRow(); addRow();

// --- Банк вопросов: только вопросы, слова подставит сервер ---
$('btn-bank').addEventListener('click', () => {
  $('bank-panel').hidden = !$('bank-panel').hidden;
});
$('btn-load-bank').addEventListener('click', async () => {
  const theme = $('bank-theme').value;
  setStatus($('bank-status'), 'Загружаем вопросы…');
  try {
    const data = await api('/api/bank/' + theme);
    const list = $('bank-list');
    list.replaceChildren(...data.clues.map(cl => {
      const label = document.createElement('label');
      label.dataset.clue = cl.clue;
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = cl.clueId;
      label.append(cb, document.createTextNode(' '), document.createTextNode(cl.clue));
      const len = document.createElement('span');
      len.className = 'len';
      len.textContent = ` (${cl.len} букв)`;
      label.append(len);
      return label;
    }));
    setStatus($('bank-status'), `Тема «${data.name}»: ${data.clues.length} вопросов. Слова будут подставлены на сервере.`);
  } catch (e) {
    setStatus($('bank-status'), e.message, 'bad');
  }
});
$('btn-add-bank').addEventListener('click', () => {
  for (const cb of $('bank-list').querySelectorAll('input:checked')) {
    const label = cb.closest('label');
    addRow({ word: '', clue: label.dataset.clue, clueId: cb.value });
    label.style.opacity = .45;
    cb.disabled = true;
  }
  $('bank-panel').hidden = true;
});

// --- Сбор данных формы ---
function formWords() {
  const words = [];
  for (const row of $('word-rows').querySelectorAll('.word-row')) {
    const w = row.querySelector('.w-word');
    const c = row.querySelector('.w-clue');
    const clue = c.value.trim();
    if (!clue && !w.value.trim()) continue; // пустую строку пропускаем
    if (w.disabled) words.push({ clueId: row.dataset.clueId || undefined, clue });
    else words.push({ word: w.value, clue });
  }
  return words;
}

function fillForm(title, words, settings) {
  $('cw-title').value = title || '';
  $('word-rows').replaceChildren();
  for (const w of words) addRow({ word: w.answer || w.word || '', clue: w.clue });
  $('set-hints').value = String(settings?.hintLimit ?? 3);
  $('set-checks').value = String(settings?.checkLimit ?? 0);
  $('set-show-answers').checked = !!settings?.showAnswersAfterFinish;
}

// --- Публикация ---
$('btn-publish').addEventListener('click', async () => {
  const words = formWords();
  const payload = {
    title: $('cw-title').value.trim(),
    words,
    settings: {
      hintLimit: Number($('set-hints').value),
      checkLimit: Number($('set-checks').value),
      showAnswersAfterFinish: $('set-show-answers').checked
    }
  };
  setStatus(status, 'Публикуем…');
  try {
    const res = await api('/api/crossword', { method: 'POST', body: JSON.stringify(payload) });
    showPublishResult(res);
    const list = myList();
    list.unshift({ id: res.id, token: res.token, title: payload.title || '(без названия)', createdAt: Date.now() });
    saveList(list);
    renderList();
    setStatus(status, 'Кроссворд опубликован.', 'ok');
  } catch (e) {
    setStatus(status, e.message, 'bad');
  }
});

function showPublishResult(res) {
  const box = $('publish-result');
  box.hidden = false;
  box.replaceChildren();

  const ok = document.createElement('h3');
  ok.textContent = 'Кроссворд создан';
  box.appendChild(ok);

  const warn = document.createElement('p');
  warn.className = 'warn';
  warn.textContent = '⚠ Сохраните секретную ссылку управления сейчас: после закрытия страницы восстановить её невозможно.';
  box.appendChild(warn);

  const mkLine = (labelText, url, copyable = true) => {
    const line = document.createElement('div');
    line.className = 'link-line';
    const b = document.createElement('strong');
    b.textContent = labelText + ' ';
    const code = document.createElement('code');
    code.textContent = location.origin + url;
    line.append(b, code);
    if (copyable) {
      const btn = document.createElement('button');
      btn.className = 'btn btn-small';
      btn.type = 'button';
      btn.textContent = 'Скопировать';
      btn.addEventListener('click', () => navigator.clipboard.writeText(location.origin + url));
      line.append(btn);
    }
    const open = document.createElement('a');
    open.className = 'btn btn-small';
    open.href = url.split('#')[0];
    open.textContent = 'Открыть';
    line.append(open);
    return line;
  };
  box.appendChild(mkLine('Публичная ссылка для студентов:', res.playUrl));
  box.appendChild(mkLine('Секретная ссылка управления:', res.manageUrl, false));
  if (res.unplaced?.length) {
    const p = document.createElement('p');
    p.textContent = 'Не поместились в сетку: ' + res.unplaced.join(', ');
    box.appendChild(p);
  }
}

$('btn-clear-form').addEventListener('click', () => {
  fillForm('', [{}, {}, {}], {});
  $('publish-result').hidden = true;
  setStatus(status, '');
});

// --- Список «Мои кроссворды» ---
function renderList() {
  const wrap = $('my-list');
  wrap.replaceChildren();
  const list = myList();
  if (list.length === 0) {
    const p = document.createElement('p');
    p.textContent = 'Пока пусто. Опубликованные кроссворды появятся здесь.';
    wrap.appendChild(p);
    return;
  }
  for (const item of list) {
    const div = document.createElement('div');
    div.className = 'my-item';
    const t = document.createElement('div');
    t.className = 'title';
    t.textContent = item.title;
    const id = document.createElement('div');
    id.className = 'id';
    id.textContent = 'id: ' + item.id + ' · ' + new Date(item.createdAt).toLocaleString('ru-RU');
    div.append(t, id);

    const row = document.createElement('div');
    row.className = 'row';
    const btn = (label, fn, cls = 'btn btn-small') => {
      const b = document.createElement('button');
      b.className = cls;
      b.type = 'button';
      b.textContent = label;
      b.addEventListener('click', fn);
      row.appendChild(b);
    };
    btn('Открыть', () => location.href = '/play/' + item.id);
    btn('Редактировать', () => editItem(item));
    btn('Удалить', async () => {
      if (!confirm('Удалить кроссворд с сервера? Действие необратимо.')) return;
      try {
        await api(`/api/crossword/${item.id}/manage`, {
          method: 'DELETE',
          headers: { 'X-Manage-Token': item.token }
        });
        saveList(myList().filter(x => x.id !== item.id));
        renderList();
        setStatus(status, 'Кроссворд удалён.', 'ok');
      } catch (e) { setStatus(status, e.message, 'bad'); }
    });
    btn('Скопировать ссылку', () => navigator.clipboard.writeText(location.origin + '/play/' + item.id));
    btn('Печать с ответами', () => printWithAnswers(item));
    btn('Скачать JSON', () => downloadJson(item));
    div.appendChild(row);
    wrap.appendChild(div);
  }
}

async function manageGet(item) {
  return api(`/api/crossword/${item.id}/manage`, { headers: { 'X-Manage-Token': item.token } });
}

async function editItem(item) {
  try {
    const data = await manageGet(item);
    fillForm(data.title, data.words, data.settings);
    setStatus(status, 'Кроссворд загружен в форму. Нажмите «Опубликовать», чтобы сохранить изменения (создастся новая версия).', 'ok');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (e) {
    setStatus(status, e.message, 'bad');
  }
}

async function printWithAnswers(item) {
  try {
    const data = await manageGet(item);
    const box = $('print-answers');
    box.replaceChildren();
    const h = document.createElement('h1');
    h.textContent = data.title + ' — ответы';
    box.appendChild(h);
    const p = document.createElement('p');
    p.textContent = 'Конфиденциально: материал для преподавателя.';
    box.appendChild(p);
    const table = document.createElement('table');
    for (const w of data.words.sort((a, b) => a.index - b.index)) {
      const tr = document.createElement('tr');
      const n = document.createElement('td');
      n.textContent = w.index + 1;
      const a = document.createElement('td');
      a.textContent = w.answer;
      const q = document.createElement('td');
      q.textContent = w.clue;
      tr.append(n, a, q);
      table.appendChild(tr);
    }
    box.appendChild(table);
    document.body.classList.add('printing-answers');
    window.print();
    document.body.classList.remove('printing-answers');
  } catch (e) {
    setStatus(status, e.message, 'bad');
  }
}

async function downloadJson(item) {
  try {
    const data = await manageGet(item);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `crossword-${item.id}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    setStatus(status, 'Файл скачан. Он содержит ответы — конфиденциально.', 'ok');
  } catch (e) {
    setStatus(status, e.message, 'bad');
  }
}

// Импорт из файла (резервная копия, формат manage-GET)
$('import-file').addEventListener('change', async ev => {
  const file = ev.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.words)) throw new Error('В файле нет списка слов');
    fillForm(data.title, data.words, data.settings);
    setStatus(status, 'Файл загружен в форму. Проверьте данные и опубликуйте.', 'ok');
  } catch (e) {
    setStatus(status, 'Не удалось прочитать файл: ' + e.message, 'bad');
  } finally {
    ev.target.value = '';
  }
});

renderList();
