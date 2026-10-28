// Общие клиентские утилиты: API, сессия, LocalStorage.
// Никаких ответов здесь нет и быть не может: клиент работает только со скелетом.

// Стабильная сессия устройства (для счётчиков подсказок/проверок на сервере)
export function sessionId() {
  let s = localStorage.getItem('pbx:session');
  if (!s || !/^[A-Za-z0-9_-]{8,64}$/.test(s)) {
    const buf = new Uint8Array(16);
    crypto.getRandomValues(buf);
    s = Array.from(buf, b => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem('pbx:session', s);
  }
  return s;
}

export async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
    ...options
  });
  let data = null;
  try { data = await res.json(); } catch { /* пустой ответ */ }
  if (!res.ok) {
    const err = new Error(data?.message || 'Ошибка запроса (' + res.status + ')');
    err.code = data?.error;
    err.status = res.status;
    throw err;
  }
  return data;
}

// Прогресс студента: буквы по клеткам, отдельно на каждый кроссворд
export function loadProgress(id) {
  try {
    const p = JSON.parse(localStorage.getItem('pbx:letters:' + id) || 'null');
    return p && typeof p.letters === 'object' ? p : { sessionId: sessionId(), letters: {} };
  } catch {
    return { sessionId: sessionId(), letters: {} };
  }
}

export function saveProgress(id, progress) {
  localStorage.setItem('pbx:letters:' + id, JSON.stringify(progress));
}

export function clearProgress(id) {
  localStorage.removeItem('pbx:letters:' + id);
}

export function setStatus(el, text, kind = '') {
  el.textContent = text || '';
  el.className = 'status' + (kind ? ' ' + kind : '');
}
