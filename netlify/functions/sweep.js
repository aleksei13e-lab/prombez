// Запланированная функция (@daily): удаляет кроссворды, к которым не было
// обращений 180 дней. Вызывается по расписанию Netlify Scheduled Functions.
import { crosswordsStore } from './_lib/store.js';

const RETENTION_MS = 180 * 24 * 3600 * 1000;

export default async () => {
  const store = crosswordsStore();
  const deleted = [];
  const now = Date.now();
  for await (const page of store.list({ prefix: 'cw:', paginate: true })) {
    for (const entry of page.blobs) {
      const rec = await store.get(entry.key, { type: 'json' });
      if (!rec) continue;
      const last = Math.max(rec.lastAccess || 0, rec.createdAt || 0);
      if (now - last > RETENTION_MS) {
        await store.delete(entry.key);
        deleted.push(entry.key.slice(3));
      }
    }
  }
  // В логи идёт только список id — никаких ответов и токенов
  console.log(JSON.stringify({ swept: deleted.length, ids: deleted }));
  return new Response(JSON.stringify({ swept: deleted.length }), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
};

export const config = {
  schedule: '@daily'
};
