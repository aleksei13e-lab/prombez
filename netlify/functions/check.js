// POST /api/check — проверка введённых студентом букв.
// Результат ТОЛЬКО по полностью заполненным словам (верно/неверно) и общий
// счёт. Побуквенной подсветки нет — слово иначе подбирается по одной букве.
import { loadRecord, checkWindowLimit, checkMinInterval, sessionCounter } from './_lib/store.js';
import { json, error, readJson, sameOrigin, ipHash } from './_lib/util.js';
import { sanitizeLetters, isValidSessionId } from './_lib/validate.js';

export default async (req) => {
  if (req.method !== 'POST') return error(405, 'method', 'Только POST');
  if (!sameOrigin(req)) return error(403, 'origin', 'Недопустимый источник');

  const body = await readJson(req);
  if (!body) return error(400, 'body', 'Некорректное тело запроса');

  // Защита от подбора: не чаще раза в 3 секунды и не более 30 в час
  // на пару (IP-хеш, кроссворд). IP хранится только как соль-хеш.
  const iph = await ipHash(req);
  const base = `${iph}:${body.id}`;
  if (!(await checkMinInterval('rl3:' + base, 3000))) {
    return error(429, 'rate', 'Слишком часто. Подождите 3 секунды перед следующей проверкой');
  }
  const hour = await checkWindowLimit('rlh:' + base, 30, 3600 * 1000);
  if (!hour.allowed) {
    return error(429, 'rate', 'Превышен лимит проверок (30 в час). Попробуйте позже');
  }

  const record = await loadRecord(body.id);
  if (!record) return error(404, 'not_found', 'Кроссворд не найден или удалён');

  if (!isValidSessionId(body.sessionId)) return error(400, 'session', 'Некорректная сессия');

  // Лимит проверок преподавателя (на сессию; 0 — без лимита)
  if (record.settings.checkLimit > 0) {
    const quota = await sessionCounter(`chk:${record.id}:${body.sessionId}`, record.settings.checkLimit);
    if (!quota.allowed) {
      return error(429, 'limit', 'Исчерпан лимит проверок для этой сессии');
    }
  }

  const letters = sanitizeLetters(body.letters, record.layout.rows, record.layout.cols);
  if (letters === null) return error(400, 'letters', 'Некорректные буквы');

  const DIRS = { h: [0, 1], v: [1, 0] };
  const results = [];
  let correct = 0;
  for (const p of record.layout.placements) {
    const answer = record.words[p.wordIndex].answer;
    const [dr, dc] = DIRS[p.dir];
    let filled = true;
    let attempt = '';
    for (let i = 0; i < p.len; i++) {
      const ch = letters[`${p.row + dr * i},${p.col + dc * i}`] || '';
      if (!ch) filled = false;
      attempt += ch;
    }
    // Вердикт только для полностью заполненных слов
    const isCorrect = filled && attempt === answer;
    if (isCorrect) correct++;
    results.push({ index: p.wordIndex, number: p.number, complete: filled, correct: filled ? isCorrect : null });
  }

  const total = record.layout.placements.length;
  const finished = correct === total;

  const payload = { results, correct, total, finished };
  // Ответы показываем только если преподаватель включил и кроссворд решён
  if (finished && record.settings.showAnswersAfterFinish) {
    payload.answers = record.layout.placements.map(p => ({
      index: p.wordIndex,
      number: p.number,
      row: p.row, col: p.col, dir: p.dir, len: p.len,
      answer: record.words[p.wordIndex].answer
    }));
  }
  return json(payload);
};
