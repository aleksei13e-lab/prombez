// Валидация пользовательского ввода. Всё, что приходит от клиента,
// проходит через эти проверки; длина и состав — жёсткие лимиты.
import { normalizeWord } from './engine.js';

export const LIMITS = {
  maxWords: 30,          // максимум слов в кроссворде
  maxWordLen: 40,        // максимум букв в слове (свои слова преподавателя)
  minWordLen: 2,
  maxClueLen: 500,       // максимум символов в вопросе
  maxTitleLen: 120,
  maxHints: 5,
  maxCheckLimit: 100,    // лимит проверок на сессию (0 — без лимита)
  minCount: 5,           // границы генератора
  maxCount: 20
};

export function cleanTitle(t) {
  return String(t ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, LIMITS.maxTitleLen);
}

export function cleanClue(c) {
  // Контрольные символы и угловые скобки убираем: клиент рендерит вопросы
  // через textContent, но и в хранилище сырой HTML не нужен
  return String(c ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, LIMITS.maxClueLen);
}

// Слово преподавателя: нормализуем и проверяем состав (кириллица+цифры)
export function isValidWord(w) {
  const n = normalizeWord(w);
  return n.length >= LIMITS.minWordLen && n.length <= LIMITS.maxWordLen && /^[А-Я0-9]+$/.test(n);
}

export function isValidSessionId(s) {
  return typeof s === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(s);
}

// Буквы студента: объект "r,c" -> одиночная кириллическая буква или цифра
export function sanitizeLetters(letters, rows, cols) {
  if (!letters || typeof letters !== 'object' || Array.isArray(letters)) return null;
  const out = {};
  let count = 0;
  for (const [k, v] of Object.entries(letters)) {
    if (++count > rows * cols) return null;
    const m = /^(\d{1,2}),(\d{1,2})$/.exec(String(k));
    if (!m) return null;
    const r = +m[1], c = +m[2];
    if (r >= rows || c >= cols) return null;
    if (v === '') continue;
    if (typeof v !== 'string' || !/^[А-ЯЁ0-9]$/.test(v)) return null;
    out[`${r},${c}`] = v.toUpperCase().replace('Ё', 'Е');
  }
  return out;
}

export function isValidSettings(s) {
  if (!s || typeof s !== 'object') return false;
  const hints = Number(s.hintLimit);
  const checks = Number(s.checkLimit);
  if (!Number.isInteger(hints) || hints < 0 || hints > LIMITS.maxHints) return false;
  if (!Number.isInteger(checks) || checks < 0 || checks > LIMITS.maxCheckLimit) return false;
  return true;
}
