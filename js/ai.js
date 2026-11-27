// Связь с ИИ: сайт → наш сервер (Cloudflare Worker) → Claude.
// Ключ Claude хранится только на сервере, в телефоне — лишь адрес сервера и семейный пароль.
import { data, todayKey, addDays, peekDay } from './store.js';
import { nm } from './i18n.js';
import * as H from './health.js';
import * as P from './progress.js';

export const aiReady = () => !!(data.settings.aiUrl && data.settings.aiCode);

// Сколько ждём ответа (меню — долго, ИИ пишет целую неделю рецептов)
const TIMEOUT = { ping: 20, photo: 90, coach: 90, menu: 300, 'menu-start': 30, 'menu-status': 20 };

export class AiError extends Error {
  constructor(code) { super(code); this.code = code; }
}

export function normUrl(u) {
  let s = String(u || '').trim().replace(/\/+$/, '');
  if (s && !/^https?:\/\//i.test(s)) s = 'https://' + s;
  return s;
}

export async function aiCall(path, body = {}, opts = {}) {
  const url = opts.url ?? data.settings.aiUrl;
  const code = opts.code ?? data.settings.aiCode;
  if (!url || !code) throw new AiError('not_set');
  if (!navigator.onLine) throw new AiError('offline');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), (TIMEOUT[path] || 90) * 1000);
  let res;
  try {
    res = await fetch(`${normUrl(url)}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Family-Code': code },
      body: JSON.stringify({ lang: data.settings.lang, ...body }),
      signal: ctrl.signal,
      ...(opts.keepalive ? { keepalive: true } : {}), // запрос дойдёт, даже если программу тут же закрыли
    });
  } catch (e) {
    throw new AiError(e?.name === 'AbortError' ? 'timeout' : 'network');
  } finally {
    clearTimeout(timer);
  }
  let out = null;
  try { out = await res.json(); } catch { /* не JSON */ }
  if (!res.ok || !out || out.error) throw new AiError(out?.error || (res.status === 404 ? 'not_found' : 'server'));
  return out;
}

// Меню от ИИ: сервер делает его в фоне, а мы раз в 4 секунды спрашиваем «готово?».
// Если связь моргнула или телефон уснул — просто спрашиваем дальше, меню не теряется.
const sleep = ms => new Promise(r => setTimeout(r, ms));
export async function aiMenu(body, onJob) {
  const { job } = await aiCall('menu-start', body);
  if (onJob) onJob(job); // запоминаем номер задания: если iPhone выгрузит программу, заберём меню при следующем запуске
  return pollMenu(job);
}
export async function pollMenu(job, first = 4000) {
  const until = Date.now() + 10 * 60_000;
  let fails = 0;
  for (let n = 0; ; n++) {
    await sleep(n ? 4000 : first);
    let st = null;
    try {
      st = await aiCall('menu-status', { job });
      fails = 0;
    } catch (e) {
      if (!['network', 'timeout', 'offline', 'server'].includes(e.code) || ++fails > 40) throw e;
    }
    if (st?.status === 'done') return st.result;
    if (st?.status === 'error') throw new AiError(st.code || 'server');
    if (st?.status === 'missing') throw new AiError('server');
    if (Date.now() > until) throw new AiError('timeout');
  }
}

// Фото → JPEG поменьше (длинная сторона до 1024 px), чтобы быстро отправить
export async function shrinkImage(file, max = 1024) {
  let src;
  try {
    src = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    src = await new Promise((ok, fail) => {
      const img = new Image();
      img.onload = () => ok(img);
      img.onerror = fail;
      img.src = URL.createObjectURL(file);
    });
  }
  const w0 = src.width || src.naturalWidth, h0 = src.height || src.naturalHeight;
  const k = Math.min(1, max / Math.max(w0, h0));
  const w = Math.round(w0 * k), h = Math.round(h0 * k);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d').drawImage(src, 0, 0, w, h);
  const dataUrl = c.toDataURL('image/jpeg', 0.82);
  return { dataUrl, base64: dataUrl.split(',')[1] };
}

// Короткая сводка за 7 дней для ИИ-тренера
export function weekStats() {
  const p = data.profile;
  const tk = todayKey();
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const key = addDays(tk, -i);
    const d = peekDay(key);
    const habitsOn = data.habits.filter(h => h.active);
    const row = {
      date: key,
      kcal: H.dayEaten(d),
      foods: d.food.map(f => `${f.name} ${f.kcal}`).slice(0, 12),
      water_glasses: d.water,
      steps: d.steps || 0,
      sport: d.sport.map(s => `${nm(s.title || H.sportType(s.type).name)} ${s.min}min`),
      habits_done: `${habitsOn.filter(h => d.habits[h.id]).length}/${habitsOn.length}`,
    };
    if (d.sleep?.bed) row.sleep = { hours: Math.round(H.sleepMinutes(d.sleep.bed, d.sleep.wake) / 6) / 10, bed: d.sleep.bed, quality_1to5: d.sleep.quality };
    if (d.diary) row.diary = { mood_1to5: d.diary.mood, energy_1to5: d.diary.energy, stress_1to5: d.diary.stress, note: String(d.diary.note || '').slice(0, 200) };
    days.push(row);
  }
  const weights = data.weights.filter(w => w.date >= addDays(tk, -30)).map(w => ({ date: w.date, kg: w.kg }));
  return {
    today: tk,
    name: p.name,
    sex: p.sex === 'f' ? 'female' : 'male',
    age: p.age,
    height_cm: p.heightCm,
    weight_kg: H.currentWeight(),
    target_kg: p.targetKg,
    goal: p.goal,
    units_shown_to_user: data.settings.units === 'us' ? 'lb, oz, fl oz' : 'kg, g, ml',
    daily_goals: { kcal: H.kcalGoal(), water_glasses: data.settings.waterGoal, steps: data.settings.stepsGoal },
    avoid_foods: [p.allergies, p.dislikes, p.diet].filter(Boolean).join('; '),
    streak_days: P.activeStreak(),
    level: P.level().level,
    weights_last_30_days: weights,
    days,
  };
}
