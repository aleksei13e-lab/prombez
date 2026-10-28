// POST /api/generate — генерация кроссворда из банка по темам.
// Тело: { themes: [slug...], count: 5..20 }. Ответ: { id, skeleton } — без букв.
import { eligibleWords, publicThemes } from './_data/wordbank.js';
// Человекочитаемые коды тем для названия (ПБ, ПМЛА, ...)
const CODE_BY_SLUG = Object.fromEntries(publicThemes().map(t => [t.slug, t.code]));
import { buildCrossword, toSkeleton } from './_lib/engine.js';
import { saveRecord } from './_lib/store.js';
import { randomId } from './_lib/util.js';
import { LIMITS } from './_lib/validate.js';
import { json, error, readJson, sameOrigin } from './_lib/util.js';

export default async (req) => {
  if (req.method !== 'POST') return error(405, 'method', 'Только POST');
  if (!sameOrigin(req)) return error(403, 'origin', 'Недопустимый источник');

  const body = await readJson(req);
  if (!body) return error(400, 'body', 'Некорректное тело запроса');

  const themes = Array.isArray(body.themes) ? body.themes : [];
  const valid = new Set(publicThemes().map(t => t.slug));
  const slugs = themes.filter(t => valid.has(t));
  if (slugs.length === 0) return error(400, 'themes', 'Выберите хотя бы одну тему');

  const count = Number(body.count);
  if (!Number.isInteger(count) || count < LIMITS.minCount || count > LIMITS.maxCount) {
    return error(400, 'count', `Количество слов — от ${LIMITS.minCount} до ${LIMITS.maxCount}`);
  }

  // Собираем пул подходящих слов и случайно выбираем нужное количество.
  // Выбор и построение — только на сервере.
  const pool = eligibleWords(slugs);
  if (pool.length < count) {
    return error(400, 'pool', 'В выбранных темах недостаточно слов для сетки');
  }
  for (let i = pool.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const picked = pool.slice(0, count);

  const built = buildCrossword(picked);
  const id = randomId(12);
  const record = {
    id,
    title: 'Кроссворд по темам: ' + slugs.map(s => CODE_BY_SLUG[s]).join(', '),
    createdAt: Date.now(),
    lastAccess: Date.now(),
    words: built.words,
    layout: built.layout,
    unplaced: built.unplaced,
    settings: { hintLimit: 3, checkLimit: 0, showAnswersAfterFinish: false },
    kind: 'generated'
  };
  await saveRecord(record);

  return json({ id, skeleton: toSkeleton(record), unplaced: built.unplaced.map(u => u.clue) });
};
