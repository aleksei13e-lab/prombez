// GET/PUT/DELETE /api/crossword/:id/manage — только с токеном преподавателя
// (заголовок X-Manage-Token). В хранилище только хеш токена.
// GET отдаёт полную запись ВМЕСТЕ с ответами — это защищённый эндпоинт.
import { loadRecord, saveRecord, deleteRecord, checkWindowLimit } from './_lib/store.js';
import { buildCrossword, toSkeleton } from './_lib/engine.js';
import { json, error, readJson, sameOrigin, ipHash, tokenHash, safeEqualHex, routeParam } from './_lib/util.js';
import { LIMITS, cleanTitle, cleanClue, isValidWord, isValidSettings } from './_lib/validate.js';

async function authorize(req, record) {
  const token = req.headers.get('x-manage-token') || '';
  if (!token || !record.tokenHash) return false;
  return safeEqualHex(await tokenHash(token), record.tokenHash);
}

export default async (req, context) => {
  if (!sameOrigin(req)) return error(403, 'origin', 'Недопустимый источник');

  const iph = await ipHash(req);
  const gate = await checkWindowLimit(`rlm:${iph}`, 60, 60 * 1000);
  if (!gate.allowed) return error(429, 'rate', 'Слишком много запросов');

  const id = routeParam(req, context, 'id');
  const record = await loadRecord(id);
  // Единый 403 для «нет записи» и «нет права» — не раскрываем существование id
  if (!record || !(await authorize(req, record))) {
    return error(403, 'forbidden', 'Доступ запрещён: неверный токен управления');
  }

  if (req.method === 'GET') {
    // Полные данные для преподавателя: ответы, настройки, непоместившиеся
    return json({
      id: record.id,
      title: record.title,
      createdAt: record.createdAt,
      settings: record.settings,
      words: record.words.map((w, i) => ({ index: i, answer: w.answer, clue: w.clue })),
      layout: record.layout,
      unplaced: record.unplaced || []
    });
  }

  if (req.method === 'PUT') {
    const body = await readJson(req);
    if (!body) return error(400, 'body', 'Некорректное тело запроса');
    if (!isValidSettings(body.settings)) return error(400, 'settings', 'Некорректные настройки');

    const title = cleanTitle(body.title) || record.title;
    const rawWords = Array.isArray(body.words) ? body.words : null;
    let words = record.words;
    let built = null;

    if (rawWords) {
      if (rawWords.length < 2 || rawWords.length > LIMITS.maxWords) {
        return error(400, 'words', `От 2 до ${LIMITS.maxWords} слов`);
      }
      words = [];
      for (const w of rawWords) {
        if (words.length >= LIMITS.maxWords) break;
        const clue = cleanClue(w.clue);
        if (!clue || !isValidWord(w.word)) return error(400, 'word', 'Некорректное слово или вопрос');
        words.push({ answer: String(w.word), clue });
      }
    }

    built = buildCrossword(words);
    if (built.layout.placements.length < 2) {
      return error(422, 'build', 'Слова не связываются в сетку');
    }

    const updated = {
      ...record,
      title,
      words: built.words,
      layout: built.layout,
      unplaced: built.unplaced,
      settings: {
        hintLimit: Number(body.settings.hintLimit),
        checkLimit: Number(body.settings.checkLimit),
        showAnswersAfterFinish: !!body.settings.showAnswersAfterFinish
      },
      lastAccess: Date.now()
    };
    await saveRecord(updated);
    return json({ ok: true, skeleton: toSkeleton(updated), unplaced: built.unplaced.map(u => u.clue) });
  }

  if (req.method === 'DELETE') {
    await deleteRecord(id);
    return json({ ok: true });
  }

  return error(405, 'method', 'GET, PUT или DELETE');
};
