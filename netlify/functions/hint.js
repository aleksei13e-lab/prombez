// POST /api/hint — открыть одну букву. Лимит задаёт преподаватель
// (settings.hintLimit, по умолчанию 3 на сессию; 0 — подсказки выключены).
// Сервер сам выбирает пустую клетку и возвращает её букву — по одной.
import { loadRecord, checkWindowLimit, sessionCounter } from './_lib/store.js';
import { json, error, readJson, sameOrigin, ipHash } from './_lib/util.js';
import { sanitizeLetters, isValidSessionId } from './_lib/validate.js';

export default async (req) => {
  if (req.method !== 'POST') return error(405, 'method', 'Только POST');
  if (!sameOrigin(req)) return error(403, 'origin', 'Недопустимый источник');

  const body = await readJson(req);
  if (!body) return error(400, 'body', 'Некорректное тело запроса');

  // Подсказки тоже ограничиваем по частоте: 20 в час на пару (IP-хеш, кроссворд)
  const iph = await ipHash(req);
  const hour = await checkWindowLimit(`rlh:${iph}:${body.id}`, 30, 3600 * 1000);
  if (!hour.allowed) return error(429, 'rate', 'Слишком много запросов, попробуйте позже');

  const record = await loadRecord(body.id);
  if (!record) return error(404, 'not_found', 'Кроссворд не найден или удалён');

  if (!isValidSessionId(body.sessionId)) return error(400, 'session', 'Некорректная сессия');

  if (record.settings.hintLimit === 0) return error(403, 'hints', 'Подсказки отключены преподавателем');

  const letters = sanitizeLetters(body.letters, record.layout.rows, record.layout.cols);
  if (letters === null) return error(400, 'letters', 'Некорректные буквы');

  const quota = await sessionCounter(`hint:${record.id}:${body.sessionId}`, record.settings.hintLimit);
  if (!quota.allowed) {
    return error(429, 'limit', `Лимит подсказок исчерпан (${record.settings.hintLimit})`);
  }

  // Активные клетки и буква в каждой — вычисляются из раскладки на сервере
  const DIRS = { h: [0, 1], v: [1, 0] };
  const cellLetter = new Map();
  for (const p of record.layout.placements) {
    const [dr, dc] = DIRS[p.dir];
    const answer = record.words[p.wordIndex].answer;
    for (let i = 0; i < p.len; i++) cellLetter.set(`${p.row + dr * i},${p.col + dc * i}`, answer[i]);
  }
  const empty = [...cellLetter.keys()].filter(k => !letters[k]);
  if (empty.length === 0) return json({ done: true, remaining: 0 });

  // Случайная пустая клетка — её букву и открываем
  const pick = empty[crypto.getRandomValues(new Uint32Array(1))[0] % empty.length];
  const [r, c] = pick.split(',').map(Number);
  return json({ row: r, col: c, letter: cellLetter.get(pick), remaining: record.settings.hintLimit - quota.used });
};
