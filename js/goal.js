// Цель по весу: здоровый вес, план (срок и калории) и «на сколько дней ближе / дальше» по записям еды и спорта.
import { data, todayKey, addDays, keyToDate } from './store.js';
import * as H from './health.js';

export const KCAL_PER_KG = 7700; // примерно столько ккал в 1 кг жира
const r1 = v => Math.round(v * 10) / 10;
export const daysBetween = (a, b) => Math.round((keyToDate(b) - keyToDate(a)) / 864e5);
export const active = () => !!data.goalPlan;

// Здоровый вес по росту, возрасту и полу
export function healthyRange() {
  const p = data.profile;
  const h = p.heightCm / 100;
  const [lo, hi] = H.bmiRange(p.age); // после 65 лет врачи советуют чуть больший вес
  const inch = p.heightCm / 2.54;
  const ideal = (p.sex === 'm' ? 50 : 45.5) + 2.3 * Math.max(0, inch - 60); // формула Девайна (учитывает пол)
  const min = lo * h * h, max = hi * h * h;
  const cur = H.currentWeight();
  const suggest = cur > max ? Math.floor(max) : cur < min ? Math.ceil(min) : Math.round(cur);
  return { lo, hi, min: Math.ceil(min), max: Math.floor(max), exMin: min, exMax: max, ideal: r1(ideal), suggest, inRange: cur >= min && cur <= max };
}

// Самый быстрый безопасный темп, кг в неделю
const maxWeekly = (dir, kg) => (dir > 0 ? Math.min(1, Math.max(0.5, kg * 0.01)) : 0.5);

// Расчёт: сколько есть в день, чтобы дойти до targetKg за days дней, и безопасно ли это
export function calcPlan(targetKg, days) {
  const cur = H.currentWeight();
  const dir = cur > targetKg ? 1 : -1; // 1 — худеем, -1 — набираем
  const kg = Math.abs(cur - targetKg);
  const daily = (kg * KCAL_PER_KG) / days;
  const tdee = H.tdee(cur);
  const kcal = Math.round((tdee - dir * daily) / 10) * 10;
  const weekly = (kg / days) * 7;
  const maxW = maxWeekly(dir, cur);
  const floor = H.minKcal();
  const maxDaily = Math.min((maxW * KCAL_PER_KG) / 7, dir > 0 ? tdee - floor : Infinity);
  const tooFast = weekly > maxW + 1e-6;
  const safe = !tooFast && (dir < 0 || kcal >= floor);
  const res = { cur, targetKg, dir, kg, days, daily, kcal, weekly, safe, maxW, floor, tdee: Math.round(tdee / 10) * 10 };
  // Цель за пределами здорового веса — такой план не строим
  const hr = healthyRange();
  if (dir > 0 && targetKg < hr.exMin - 0.1) res.unhealthy = 'low';
  if (dir < 0 && targetKg > hr.exMax + 0.1) res.unhealthy = 'high';
  if (res.unhealthy) { res.safe = false; res.hr = hr; return res; }
  if (!safe) {
    res.why = tooFast ? 'pace' : 'kcal'; // слишком быстро или пришлось бы есть меньше минимума
    if (maxDaily < 100) {
      // Организм тратит почти столько же, сколько безопасный минимум калорий: одной едой не похудеть
      res.noRoom = true;
    } else {
      res.safeDays = Math.ceil((kg * KCAL_PER_KG) / maxDaily);
      // Куда можно безопасно дойти за этот же срок (округляем в сторону нынешнего веса, чтобы темп остался безопасным)
      const step = (cur - (dir * maxDaily * days) / KCAL_PER_KG) * 2;
      res.stepKg = (dir > 0 ? Math.ceil(step - 1e-6) : Math.floor(step + 1e-6)) / 2;
    }
  }
  return res;
}

export function startPlan(targetKg, days) {
  const c = calcPlan(targetKg, days);
  const start = todayKey();
  data.goalPlan = { start, startKg: c.cur, targetKg, days, end: addDays(start, days), dir: c.dir, daily: Math.round(c.daily) };
  return data.goalPlan;
}

// Вес на дату (последнее взвешивание до неё)
export function weightOn(key) {
  let w = null;
  for (const x of data.weights) { if (x.date <= key) w = x.kg; else break; }
  return w ?? data.goalPlan?.startKg ?? H.currentWeight();
}

// Сколько должен весить по плану в этот день
export function planWeight(key) {
  const g = data.goalPlan;
  const t = Math.max(0, daysBetween(g.start, key));
  const w = g.startKg - (g.dir * g.daily * t) / KCAL_PER_KG;
  return g.dir > 0 ? Math.max(g.targetKg, w) : Math.min(g.targetKg, w);
}

// Сдвиг цели за один день, в днях: минус — ближе, плюс — дальше
export function dayShift(key) {
  const g = data.goalPlan, d = data.days[key];
  if (!g || !d || key < g.start || key > todayKey()) return null;
  const plan = H.planKcal(weightOn(key));
  const eaten = H.dayEaten(d);
  let food = d.food.length ? (g.dir * (eaten - plan)) / g.daily : 0;
  if (key === todayKey()) food = g.dir > 0 ? Math.max(0, food) : 0; // день не закончился — считаем только перебор
  else if (eaten < plan * 0.5) food = 0; // записано меньше половины нормы — день, похоже, записан не весь: считаем «по плану»
  food = Math.max(-0.5, Math.min(3, food)); // если съели совсем мало (или забыли записать) — не больше полдня выгоды
  const sport = (-g.dir * H.dayBurned(d)) / g.daily;
  const total = food + sport;
  return Math.abs(total) < 0.005 ? null : { food, sport, total };
}

export function totalShift() {
  const g = data.goalPlan;
  if (!g) return 0;
  const tk = todayKey();
  let s = 0;
  for (const key of Object.keys(data.days)) {
    if (key < g.start || key > tk) continue;
    s += dayShift(key)?.total || 0;
  }
  return s;
}

// Всё для экрана цели
export function status() {
  const g = data.goalPlan, tk = todayKey();
  const cur = H.currentWeight();
  const shift = totalShift();
  const reached = H.goalReached(cur);
  let eta = addDays(g.end, Math.round(shift));
  if (eta <= tk) eta = addDays(tk, 1);
  const total = Math.abs(g.startKg - g.targetKg);
  const done = g.dir * (g.startKg - cur);
  const weighed = data.weights.some(w => w.date > g.start);
  return {
    reached, shift, eta, daysLeft: daysBetween(tk, eta), frac: total ? Math.max(0, Math.min(1, done / total)) : 1,
    done, cur, planW: planWeight(tk), weighed, weekly: (g.daily * 7) / KCAL_PER_KG, today: dayShift(tk),
  };
}
