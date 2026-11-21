// Напоминания (push) и «анти-YouTube»: связь телефона с нашим сервером.
// Сервер помнит только: часовой пояс, язык, тон, расписание напоминаний и что сегодня уже записано
// (выпита ли вода, записана ли еда) — чтобы не напоминать зря. Сами записи остаются в телефоне.
import { data, save, todayKey, peekDay } from './store.js';
import { t } from './i18n.js';
import { aiCall, aiReady, AiError, normUrl } from './ai.js';

export const REM_TYPES = ['water', 'breakfast', 'lunch', 'dinner', 'sport', 'sleep', 'weight', 'backup'];
export const REM_EMOJI = { water: '💧', breakfast: '🍳', lunch: '🍲', dinner: '🍽️', sport: '🏃', sleep: '🌙', weight: '⚖️', backup: '💾' };
const REM_URL = { water: './#/today', breakfast: './#/food', lunch: './#/food', dinner: './#/food', sport: './#/sport', sleep: './#/sleep', weight: './#/weight', backup: './#/backup' };

export const DEFAULT_REMINDERS = {
  water: { on: true, from: '10:00', to: '20:00', every: 2 },
  breakfast: { on: true, at: '09:30' },
  lunch: { on: true, at: '13:30' },
  dinner: { on: true, at: '19:30' },
  sport: { on: true, at: '20:00' },
  sleep: { on: true, at: '22:30' },
  weight: { on: true, at: '08:00', day: 1 },   // понедельник
  backup: { on: true, at: '12:00', day: 0 },   // воскресенье
};

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const pushOn = () => !!data.push?.on;
export const reminders = () => {
  const r = data.reminders || {};
  return Object.fromEntries(REM_TYPES.map(k => [k, { ...DEFAULT_REMINDERS[k], ...(r[k] || {}) }]));
};
const tz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; } };
const pad = n => String(n).padStart(2, '0');
const toMin = hm => { const [h, m] = String(hm).split(':').map(Number); return h * 60 + (m || 0); };
const toHm = m => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;

// Расписание для сервера: тексты уже на нужном языке и в нужном тоне
export function buildReminders() {
  const r = reminders(), tone = data.settings.tone, out = [];
  const add = (type, id, at, cond, vars, days = null) => out.push({
    id, at, days, cond, url: REM_URL[type],
    title: `${REM_EMOJI[type]} ${t('rn_' + type + '_t')}`,
    body: t(`rn_${type === 'breakfast' || type === 'lunch' || type === 'dinner' ? 'meal' : type}_${tone}`, vars),
  });
  if (r.water.on) {
    const step = Math.max(1, Number(r.water.every) || 2) * 60;
    for (let m = toMin(r.water.from); m <= toMin(r.water.to); m += step) add('water', 'water-' + toHm(m), toHm(m), 'water');
  }
  for (const m of ['breakfast', 'lunch', 'dinner']) {
    if (r[m].on) add(m, m, r[m].at, 'meal:' + m, { meal: t('meal_' + m).toLowerCase() });
  }
  if (r.sport.on) add('sport', 'sport', r.sport.at, 'sport');
  if (r.sleep.on) add('sleep', 'sleep', r.sleep.at, '');
  if (r.weight.on) add('weight', 'weight', r.weight.at, 'weight', null, [Number(r.weight.day)]);
  if (r.backup.on) add('backup', 'backup', r.backup.at, 'backup', null, [Number(r.backup.day)]);
  return out;
}

// Что уже сделано сегодня — сервер не будет напоминать о сделанном
export function todayStatus() {
  const tk = todayKey(), d = peekDay(tk);
  const lastW = [...data.weights].sort((a, b) => a.date.localeCompare(b.date)).pop();
  return {
    date: tk,
    water_ok: d.water >= data.settings.waterGoal,
    meals: Object.fromEntries(['breakfast', 'lunch', 'dinner', 'snack'].map(m => [m, d.food.some(f => f.meal === m)])),
    sport: d.sport.length > 0 || (d.steps || 0) > 0,
    weighed_at: lastW?.date || '',
    backup_at: data.lastBackup ? String(data.lastBackup).slice(0, 10) : '',
  };
}

// ---- Телефон на сервере ----
const devInfo = () => ({ name: data.profile?.name || '', tz: tz(), lang: data.settings.lang, tone: data.settings.tone });

export async function ensureDevice() {
  if (data.device?.id && data.device?.token) return data.device;
  const res = await aiCall('dev/register', { id: data.device?.id, ...devInfo() });
  data.device = { id: res.id, token: res.token };
  save();
  return data.device;
}

export async function devCall(path, body = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const dev = await ensureDevice();
    try {
      return await aiCall(path, { id: dev.id, token: dev.token, ...body });
    } catch (e) {
      // Сервер забыл телефон (например, после переустановки) — регистрируемся заново
      if (e.code === 'bad_device' && attempt === 0) { data.device = null; save(); continue; }
      throw e;
    }
  }
}

const fullUpdate = extra => devCall('dev/update', { ...devInfo(), reminders: buildReminders(), status: todayStatus(), limit: antiLimit(), ...extra });

// ---- Включить / выключить ----
function keyBytes(b64) {
  const s = b64.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(s + '='.repeat((4 - (s.length % 4)) % 4)), c => c.charCodeAt(0));
}

export async function enablePush() {
  if (!pushSupported()) throw new AiError('no_push');
  if (!aiReady()) throw new AiError('not_set');
  // Разрешение спрашиваем первым делом — iPhone разрешает это только сразу после нажатия кнопки
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new AiError('denied');
  let key;
  try {
    key = (await fetch(`${normUrl(data.settings.aiUrl)}/push/key`).then(r => r.json())).key;
  } catch { throw new AiError('network'); }
  if (!key) throw new AiError('server');
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (sub) {
    // Подписка от другого ключа сервера — пересоздаём
    const old = sub.options?.applicationServerKey;
    if (old && btoa(String.fromCharCode(...new Uint8Array(old))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') !== key) {
      await sub.unsubscribe();
      sub = null;
    }
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
  await fullUpdate({ sub: sub.toJSON() });
  data.push = { on: true, since: new Date().toISOString() };
  save();
}

export async function disablePush() {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) await sub.unsubscribe();
  } catch { /* не страшно */ }
  data.push = { on: false };
  save();
  if (data.device?.id) await devCall('dev/update', { sub: null });
}

export const testPush = () => devCall('dev/test', { message: { title: `🔔 ${t('app_name')}`, body: t('rem_test_body') } });

// Поменялись расписание, тон, язык или имя — сообщить серверу (если телефон там уже есть)
export async function syncSettings() {
  if (!data.device?.token || !aiReady()) return;
  await devCall('dev/update', { ...devInfo(), ...(pushOn() ? { reminders: buildReminders(), status: todayStatus() } : {}) });
}

// Что-то записали — через пару секунд сообщить серверу (одним запросом, а не на каждое нажатие)
let statusTimer = null;
export function statusChanged() {
  if (!pushOn() || !aiReady()) return;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(flushStatus, 4000);
}
export function flushStatus() {
  if (!statusTimer || !pushOn()) return;
  clearTimeout(statusTimer);
  statusTimer = null;
  devCall('dev/update', { status: todayStatus(), tz: tz() }).catch(() => { /* в следующий раз */ });
}

// ---- Анти-YouTube ----
export const antiLimit = () => Math.min(600, Math.max(5, Number(data.antiyt?.limit) || 60));
export const hookUrl = ev => (data.device?.token && aiReady() ? `${normUrl(data.settings.aiUrl)}/h/${data.device.token}/${ev}` : '');
export const ytStats = () => devCall('dev/stats');
export const saveLimit = limit => { data.antiyt = { ...(data.antiyt || {}), limit }; save(); return devCall('dev/update', { limit: antiLimit() }); };
