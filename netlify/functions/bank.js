// GET /api/bank/:theme — вопросы банка для панели преподавателя.
// Отдаём ТОЛЬКО вопросы (clueId, текст, длина). Слова подставляются
// на сервере при публикации (POST /api/crossword с clueId) и в браузер
// не попадают вообще.
import { cluesOfTheme } from './_data/wordbank.js';
import { json, error, sameOrigin, routeParam } from './_lib/util.js';

export default async (req, context) => {
  if (req.method !== 'GET') return error(405, 'method', 'Только GET');
  if (!sameOrigin(req)) return error(403, 'origin', 'Недопустимый источник');

  const data = cluesOfTheme(routeParam(req, context, 'theme'));
  if (!data) return error(404, 'not_found', 'Тема не найдена');
  return json(data);
};
