// POST /api/crossword — публикация кроссворда преподавателем.
// Слова либо введены вручную ({word, clue}), либо взяты из банка по clueId
// ({clueId}) — во втором случае слово подставляется НА СЕРВЕРЕ и в браузер
// преподавателя не попадает. Ответ: { id, token, playUrl, manageUrl }.
// Токен управления показывается ОДИН раз; в хранилище — только его хеш.
import { byClueId } from './_data/wordbank.js';
import { buildCrossword, toSkeleton } from './_lib/engine.js';
import { saveRecord } from './_lib/store.js';
import { randomId, randomToken, tokenHash, json, error, readJson, sameOrigin } from './_lib/util.js';
import { LIMITS, cleanTitle, cleanClue, isValidWord, isValidSettings } from './_lib/validate.js';

export default async (req) => {
  if (req.method !== 'POST') return error(405, 'method', 'Только POST');
  if (!sameOrigin(req)) return error(403, 'origin', 'Недопустимый источник');

  const body = await readJson(req);
  if (!body) return error(400, 'body', 'Некорректное тело запроса');

  const title = cleanTitle(body.title) || 'Кроссворд преподавателя';
  const rawWords = Array.isArray(body.words) ? body.words : [];
  if (rawWords.length < 2) return error(400, 'words', 'Нужно минимум 2 слова');
  if (rawWords.length > LIMITS.maxWords) return error(400, 'words', `Максимум ${LIMITS.maxWords} слов`);
  if (!isValidSettings(body.settings)) return error(400, 'settings', 'Некорректные настройки');

  const words = [];
  for (const w of rawWords) {
    if (words.length >= LIMITS.maxWords) break;
    const clue = cleanClue(w.clue);
    if (!clue) return error(400, 'clue', 'У каждого слова должен быть вопрос');
    if (typeof w.clueId === 'string' && w.clueId) {
      // Слово из банка: берём с сервера, клиент его не присылал
      const bank = byClueId(w.clueId);
      if (!bank) return error(400, 'clueId', 'Неизвестное слово банка');
      words.push({ answer: bank.answer, clue });
    } else {
      if (!isValidWord(w.word)) {
        return error(400, 'word', 'Слово: только русские буквы и цифры, 2–40 знаков');
      }
      words.push({ answer: String(w.word), clue });
    }
  }

  const built = buildCrossword(words);
  if (built.layout.placements.length < 2) {
    return error(422, 'build', 'Не удалось связать слова в сетку: добавьте слова с общими буквами');
  }

  const id = randomId(12);
  const token = randomToken();
  const record = {
    id,
    title,
    createdAt: Date.now(),
    lastAccess: Date.now(),
    words: built.words,
    layout: built.layout,
    unplaced: built.unplaced,
    settings: {
      hintLimit: Number(body.settings.hintLimit),
      checkLimit: Number(body.settings.checkLimit),
      showAnswersAfterFinish: !!body.settings.showAnswersAfterFinish
    },
    tokenHash: await tokenHash(token),
    kind: 'custom'
  };
  await saveRecord(record);

  return json({
    id,
    token, // показывается один раз
    playUrl: '/play/' + id,
    manageUrl: '/teacher#' + id + '|' + token,
    skeleton: toSkeleton(record),
    unplaced: built.unplaced.map(u => u.clue)
  });
};
