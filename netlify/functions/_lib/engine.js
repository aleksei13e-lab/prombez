// Серверный движок кроссвордов: построение сетки из списка слов.
// Работает ТОЛЬКО на сервере. Ответы (слова) не покидают этот модуль
// в публичных функциях — наружу отдаётся лишь «скелет» сетки.
//
// Алгоритм: первое слово (самое длинное) — по горизонтали; далее поиск
// с возвратом (backtracking) по принципу «самое ограниченное слово вперёд»:
// на каждом шаге берётся слово с наименьшим числом допустимых пересечений.
// Правила укладки: пересечения строго перпендикулярны и по совпадающей
// букве; соседние с новым словом клетки (кроме пересечений) пусты —
// случайные «лишние слова» не возникают. Слова без единой общей буквы
// с остальными (изоляты) не помещаются принципиально — отсекаются сразу.
// Несколько попыток с разным джиттером; лучшая — по числу слов,
// затем по плотности пересечений и компактности.

const MAX_SIDE = 64; // предельная сторона сетки в клетках
const MAX_NODE_BUDGET = 4000; // бюджет размещений на одну попытку
const DIRS = { h: [0, 1], v: [1, 0] };
const key = (r, c) => r + ',' + c;

// Нормализация слова: верхний регистр, Ё→Е, без пробелов и дефисов
export function normalizeWord(raw) {
  return String(raw ?? '')
    .toUpperCase()
    .replace(/Ё/g, 'Е')
    .replace(/[\s\-–—_.,()«»"']/g, '');
}

// Детерминированный ГПСЧ (mulberry32) — воспроизводимые сетки по seed
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Сетка одной попытки: укладка с отменой (undo) для backtracking
function Grid() {
  const cells = new Map(); // "r,c" -> { letter, dirs:Set }
  const placements = [];   // { wordIndex, row, col, dir }
  let bbox = { minR: 0, maxR: 0, minC: 0, maxC: 0 };
  const bboxStack = [];

  const g = {
    cells, placements,
    box: () => bbox,
    // Можно ли положить слово w в (r0,c0) направлением dir.
    // Возвращает { inter, grow } либо null.
    canPlace(w, r0, c0, dir) {
      const [dr, dc] = DIRS[dir];
      const len = w.length;
      // До начала и после конца — свободно (слова не склеиваются)
      if (cells.has(key(r0 - dr, c0 - dc))) return null;
      if (cells.has(key(r0 + dr * len, c0 + dc * len))) return null;
      let inter = 0;
      for (let i = 0; i < len; i++) {
        const r = r0 + dr * i, c = c0 + dc * i;
        const cell = cells.get(key(r, c));
        if (cell) {
          if (cell.letter !== w[i]) return null;
          if (cell.dirs.has(dir)) return null; // параллельное перекрытие
          inter++;
        } else {
          // перпендикулярные соседи пустой клетки должны быть пусты
          const pr = dr === 0 ? 1 : 0, pc = dc === 0 ? 1 : 0;
          if (cells.has(key(r + pr, c + pc)) || cells.has(key(r - pr, c - pc))) return null;
        }
      }
      // Предохранитель по размеру
      const nMinR = Math.min(bbox.minR, r0), nMaxR = Math.max(bbox.maxR, r0 + dr * (len - 1));
      const nMinC = Math.min(bbox.minC, c0), nMaxC = Math.max(bbox.maxC, c0 + dc * (len - 1));
      if (nMaxR - nMinR + 1 > MAX_SIDE || nMaxC - nMinC + 1 > MAX_SIDE) return null;
      return { inter, grow: (nMaxR - nMinR + 1) * (nMaxC - nMinC + 1) };
    },
    // Все допустимые размещения слова w через пересечения с текущей сеткой
    candidates(w) {
      const out = [];
      for (const [k, cell] of cells) {
        const [r, c] = k.split(',').map(Number);
        const dirs = cell.dirs.has('h') ? ['v'] : [];
        if (cell.dirs.has('v')) dirs.push('h');
        for (const dir of dirs) {
          for (let i = 0; i < w.length; i++) {
            if (w[i] !== cell.letter) continue;
            const [dr, dc] = DIRS[dir];
            const r0 = r - dr * i, c0 = c - dc * i;
            const fit = this.canPlace(w, r0, c0, dir);
            if (fit) out.push({ r0, c0, dir, ...fit });
          }
        }
      }
      return out;
    },
    place(wordIndex, w, r0, c0, dir) {
      const [dr, dc] = DIRS[dir];
      const created = [];
      for (let i = 0; i < w.length; i++) {
        const k = key(r0 + dr * i, c0 + dc * i);
        let cell = cells.get(k);
        if (!cell) { cell = { letter: w[i], dirs: new Set() }; cells.set(k, cell); created.push(k); }
        cell.dirs.add(dir);
      }
      const er = r0 + dr * (w.length - 1), ec = c0 + dc * (w.length - 1);
      bboxStack.push(bbox);
      bbox = {
        minR: Math.min(bbox.minR, r0, er), maxR: Math.max(bbox.maxR, r0, er),
        minC: Math.min(bbox.minC, c0, ec), maxC: Math.max(bbox.maxC, c0, ec)
      };
      placements.push({ wordIndex, row: r0, col: c0, dir });
      return created;
    },
    // Отмена последнего place (created — список ключей, возвращённых place)
    undo(created) {
      const p = placements.pop();
      const [dr, dc] = DIRS[p.dir];
      const wlen = created.length;
      for (let i = 0; i < wlen; i++) {
        const k = key(p.row + dr * i, p.col + dc * i);
        const cell = cells.get(k);
        cell.dirs.delete(p.dir);
        if (cell.dirs.size === 0 && created.includes(k)) cells.delete(k);
      }
      bbox = bboxStack.pop();
    }
  };
  return g;
}

// Одна попытка: backtracking по «самому ограниченному слову».
// Возвращает { placedCount, unplacedIdx, grid } — лучшее достигнутое состояние.
function tryBuild(items, seed) {
  const rnd = mulberry32(seed);
  const grid = Grid();
  let budget = MAX_NODE_BUDGET;
  let bestState = null;

  // Джиттер: при равной длине — случайный порядок
  const byLen = [...items].sort((a, b) =>
    (b.answer.length - a.answer.length) || (rnd() - 0.5)
  );
  grid.place(byLen[0].index, byLen[0].answer, 0, 0, 'h');
  const pending = new Set(items);
  pending.delete(byLen[0]);

  // Снимок состояния для сравнения/восстановления
  function snapshot() {
    return { placed: grid.placements.length, unplaced: [...pending].map(it => it.index) };
  }
  function remember() {
    const s = snapshot();
    if (!bestState || s.placed > bestState.placed) {
      bestState = { ...s, layout: { rows: grid.box().maxR - grid.box().minR + 1, cols: grid.box().maxC - grid.box().minC + 1 } };
    }
  }
  remember();

  function solve() {
    if (pending.size === 0) { remember(); return true; }
    if (budget-- <= 0) { remember(); return true; } // бюджет исчерпан — фиксируем лучшее

    // Самое ограниченное слово: минимум допустимых кандидатов СРЕДИ СЛОВ
    // С КАНДИДАТАМИ. Слово с нулём кандидатов не тупик — оно может
    // примкнуть позже, когда сетка вырастет (цепочки через другие слова).
    // Тупик — только когда кандидатов нет ни у кого.
    let chosen = null;
    for (const it of pending) {
      const cands = grid.candidates(it.answer);
      if (cands.length === 0) continue;
      if (!chosen || cands.length < chosen.cands.length) chosen = { it, cands };
      if (cands.length === 1) break; // форсированное слово — решаем сразу
    }
    if (!chosen) { remember(); return false; }
    remember();

    // Кандидаты: больше пересечений и компактность вперёд, джиттер для разнообразия
    chosen.cands.sort((a, b) => (b.inter - a.inter) || (a.grow - b.grow) || (rnd() - 0.5));
    const maxTry = Math.min(chosen.cands.length, 6);
    for (let i = 0; i < maxTry; i++) {
      const c = chosen.cands[i];
      const created = grid.place(chosen.it.index, chosen.it.answer, c.r0, c.c0, c.dir);
      pending.delete(chosen.it);
      if (solve()) return true;
      pending.add(chosen.it);
      grid.undo(created);
    }
    return false;
  }

  solve();

  // Восстанавливаем лучшее достигнутое состояние: откатываем лишние размещения
  while (grid.placements.length > bestState.placed) {
    const p = grid.placements[grid.placements.length - 1];
    const it = items.find(x => x.index === p.wordIndex);
    // undo требует список созданных ключей — пересобираем
    const [dr, dc] = DIRS[p.dir];
    const created = [];
    for (let i = 0; i < it.answer.length; i++) {
      const k = key(p.row + dr * i, p.col + dc * i);
      if (grid.cells.get(k).dirs.size === 1) created.push(k);
      created.push(k);
    }
    grid.undo([...new Set(created)]);
    pending.add(it);
  }

  // Нормализация координат и нумерация стартовых клеток
  const { minR, minC, maxR, maxC } = grid.box();
  const placements = grid.placements.map(p => ({ ...p, row: p.row - minR, col: p.col - minC }));
  const rows = maxR - minR + 1, cols = maxC - minC + 1;
  const starts = [...new Set(placements.map(p => key(p.row, p.col)))]
    .map(k => k.split(',').map(Number))
    .sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  const numbers = new Map(starts.map(([r, c], i) => [key(r, c), i + 1]));
  for (const p of placements) p.number = numbers.get(key(p.row, p.col));

  return {
    layout: { rows, cols, placements },
    unplacedIdx: [...pending].map(it => it.index)
  };
}

// Слова-изоляты: ни одной общей буквы с остальными — не поместятся никогда
function pruneIsolated(items) {
  const kept = [], isolated = [];
  for (const it of items) {
    const letters = new Set(it.answer);
    const shares = items.some(o => o !== it && [...letters].some(l => o.answer.includes(l)));
    (shares ? kept : isolated).push(it);
  }
  return { kept, isolated };
}

// Число клеток, входящих сразу в горизонтальное и вертикальное слово
function countIntersections(layout, items) {
  const seen = new Map();
  for (const p of layout.placements) {
    const [dr, dc] = DIRS[p.dir];
    for (let i = 0; i < items[p.wordIndex].answer.length; i++) {
      const k = key(p.row + dr * i, p.col + dc * i);
      seen.set(k, (seen.get(k) || 0) + 1);
    }
  }
  let inter = 0;
  for (const n of seen.values()) if (n > 1) inter++;
  return inter;
}

/**
 * Построить кроссворд из списка слов.
 * @param {Array<{answer:string, clue:string}>} words
 * @param {{seed?: number, attempts?: number}} opts
 * @returns {{layout, words: Array<{answer,clue}>, unplaced: Array<{answer,clue}>, intersections: number}}
 */
export function buildCrossword(words, opts = {}) {
  // Нормализация, отсев короче 2 букв, переиндексация: wordIndex указывает
  // в возвращаемый массив words (и в record.words при сохранении)
  const items = words
    .map(w => ({ answer: normalizeWord(w.answer), clue: String(w.clue ?? '') }))
    .filter(w => w.answer.length >= 2)
    .map((w, index) => ({ ...w, index }));

  if (items.length === 0) {
    return { layout: { rows: 0, cols: 0, placements: [] }, words: [], unplaced: [], intersections: 0 };
  }
  if (items.length === 1) {
    const it = items[0];
    return {
      layout: { rows: 1, cols: it.answer.length, placements: [{ wordIndex: 0, row: 0, col: 0, dir: 'h', number: 1, len: it.answer.length }] },
      words: [{ answer: it.answer, clue: it.clue }],
      unplaced: [], intersections: 0
    };
  }

  const { kept, isolated } = pruneIsolated(items);
  const n = kept.length;
  const attempts = opts.attempts ?? Math.max(6, Math.min(20, Math.ceil(n / 2)));

  let best = null;
  for (let a = 0; a < attempts; a++) {
    const seed = (opts.seed ?? (Math.random() * 2 ** 31) | 0) + a * 2654435761;
    const res = tryBuild(kept, seed);
    const inter = countIntersections(res.layout, items); // wordIndex — индекс в ПОЛНОМ списке
    const area = res.layout.rows * res.layout.cols;
    const score = { placed: res.layout.placements.length, area, inter };
    if (
      !best ||
      score.placed > best.score.placed ||
      (score.placed === best.score.placed && score.inter > best.score.inter) ||
      (score.placed === best.score.placed && score.inter === best.score.inter && score.area < best.score.area)
    ) {
      best = { ...res, score };
    }
    if (best.score.placed === n && best.score.inter >= n - 1) break; // дальше не улучшить
  }

  // len размещения берётся из ответа; клиент получает len, но не буквы
  for (const p of best.layout.placements) p.len = items[p.wordIndex].answer.length;

  const placedIdx = new Set(best.layout.placements.map(p => p.wordIndex));
  const unplaced = [
    ...isolated,
    ...kept.filter(it => !placedIdx.has(it.index))
  ].map(it => ({ answer: it.answer, clue: it.clue }));

  return {
    layout: best.layout,
    // Все слова в исходном порядке; record.words[p.wordIndex] — ответ размещения
    words: items.map(it => ({ answer: it.answer, clue: it.clue })),
    unplaced,
    intersections: best.score.inter
  };
}

/**
 * Публичный «скелет» записи кроссворда: размеры, размещения (номер, клетка,
 * направление, длина) и вопросы. Никаких букв-ответов.
 */
export function toSkeleton(record) {
  return {
    id: record.id,
    title: record.title,
    createdAt: record.createdAt,
    rows: record.layout.rows,
    cols: record.layout.cols,
    words: record.layout.placements.map(p => ({
      index: p.wordIndex,
      number: p.number,
      row: p.row,
      col: p.col,
      dir: p.dir,
      len: p.len,
      clue: record.words[p.wordIndex].clue
    })),
    settings: {
      hintLimit: record.settings.hintLimit,
      showAnswersAfterFinish: !!record.settings.showAnswersAfterFinish
    },
    stats: { total: record.layout.placements.length }
  };
}
