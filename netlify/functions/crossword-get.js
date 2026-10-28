// GET /api/crossword/:id — публичный скелет и вопросы. Букв-ответов нет.
import { loadRecord } from './_lib/store.js';
import { toSkeleton } from './_lib/engine.js';
import { json, error, sameOrigin, routeParam } from './_lib/util.js';

export default async (req, context) => {
  if (req.method !== 'GET') return error(405, 'method', 'Только GET');
  if (!sameOrigin(req)) return error(403, 'origin', 'Недопустимый источник');

  const id = routeParam(req, context, 'id');
  const record = await loadRecord(id);
  if (!record) return error(404, 'not_found', 'Кроссворд не найден или удалён');

  return json(toSkeleton(record));
};
