// Хранилище: Netlify Blobs. Кроссворды и счётчики живут здесь,
// на клиент не отдаются никогда (кроме публичного скелета по id).
//
// Локальная разработка: netlify dev без привязанного сайта не эмулирует Blobs,
// поэтому при PB_LOCAL_STORE=1 используется файловый адаптер (папка
// .local-store/ в корне проекта, в git не попадает). На Netlify всегда Blobs.
import { getStore } from '@netlify/blobs';
import fs from 'node:fs';
import path from 'node:path';

// RENDER=true выставляет сам Render: там вместо Netlify Blobs работает файловый адаптер
const LOCAL = process.env.PB_LOCAL_STORE === '1' || process.env.RENDER === 'true';
const LOCAL_DIR = path.resolve(process.env.PB_LOCAL_DIR || '.local-store');

// Файловый адаптер с тем же интерфейсом (get/setJSON/delete/list)
function fileStore(bucket) {
  const dir = path.join(LOCAL_DIR, bucket);
  fs.mkdirSync(dir, { recursive: true });
  const fileOf = key => path.join(dir, Buffer.from(key).toString('base64url') + '.json');
  return {
    async get(key, opts = {}) {
      try {
        const text = fs.readFileSync(fileOf(key), 'utf8');
        return opts.type === 'json' ? JSON.parse(text) : text;
      } catch { return null; }
    },
    async setJSON(key, value) {
      fs.writeFileSync(fileOf(key), JSON.stringify(value), 'utf8');
    },
    async delete(key) {
      try { fs.unlinkSync(fileOf(key)); } catch { /* нет файла — ок */ }
    },
    // Тот же формат, что у Netlify Blobs при paginate: true — страницы { blobs: [{ key }] }
    async *list({ prefix = '' } = {}) {
      const blobs = [];
      for (const name of fs.readdirSync(dir)) {
        const key = Buffer.from(name.replace(/\.json$/, ''), 'base64url').toString();
        if (key.startsWith(prefix)) blobs.push({ key });
      }
      yield { blobs };
    }
  };
}

// Записи кроссвордов: ключ cw:<id>
export function crosswordsStore() {
  return LOCAL ? fileStore('crosswords') : getStore({ name: 'crosswords', consistency: 'strong' });
}

// Служебные счётчики (rate limit, подсказки, сессии): ключи rl:/hint:/last:
export function metaStore() {
  return LOCAL ? fileStore('meta') : getStore({ name: 'meta', consistency: 'strong' });
}

export async function saveRecord(record) {
  await crosswordsStore().setJSON('cw:' + record.id, record);
}

export async function loadRecord(id) {
  if (!/^[A-Za-z0-9_-]{12,64}$/.test(String(id || ''))) return null;
  const rec = await crosswordsStore().get('cw:' + id, { type: 'json' });
  if (rec) {
    // Обновляем отметку обращения (для автоудаления через 180 дней)
    rec.lastAccess = Date.now();
    await crosswordsStore().setJSON('cw:' + id, rec);
  }
  return rec;
}

export async function deleteRecord(id) {
  await crosswordsStore().delete('cw:' + id);
}

// --- Rate limit ---
// Окно-счётчик: не более limit попаданий в окно windowMs. Ключ включает
// номер окна, поэтому старые записи не читаются и не требуют очистки.
export async function checkWindowLimit(key, limit, windowMs) {
  const store = metaStore();
  const win = Math.floor(Date.now() / windowMs);
  const k = `${key}:${win}`;
  const cur = (await store.get(k, { type: 'json' })) || 0;
  if (cur >= limit) return { allowed: false, remaining: 0 };
  await store.setJSON(k, cur + 1);
  return { allowed: true, remaining: limit - cur - 1 };
}

// Минимальный интервал между обращениями (мс). Временно храним метку времени.
export async function checkMinInterval(key, ms) {
  const store = metaStore();
  const k = 'last:' + key;
  const last = (await store.get(k, { type: 'json' })) || 0;
  const now = Date.now();
  if (now - last < ms) return false;
  await store.setJSON(k, now);
  return true;
}

// Счётчик подсказок/проверок сессии. sessionId генерирует клиент.
export async function sessionCounter(key, limit) {
  const store = metaStore();
  const cur = (await store.get(key, { type: 'json' })) || 0;
  if (limit > 0 && cur >= limit) return { allowed: false, used: cur };
  await store.setJSON(key, cur + 1);
  return { allowed: true, used: cur + 1 };
}
