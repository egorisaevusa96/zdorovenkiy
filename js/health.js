// Расчёты: калории, индекс массы тела, сон, спорт.
import { data } from './store.js';
import { SPORT_TYPES } from './content.js';

export const ACTIVITY_LEVELS = [
  { v: 1.2, key: 'act_low' },
  { v: 1.375, key: 'act_light' },
  { v: 1.55, key: 'act_mid' },
  { v: 1.725, key: 'act_high' },
];

// Последний записанный вес (или вес из профиля)
export function currentWeight() {
  const w = [...data.weights].sort((a, b) => a.date.localeCompare(b.date));
  if (w.length) return w[w.length - 1].kg;
  return data.profile?.weightKg || 70;
}

// Сколько тратит организм за день: формула Миффлина — Сан Жеора × активность
export function tdee(kg = currentWeight()) {
  const p = data.profile;
  if (!p) return 2000;
  return (10 * kg + 6.25 * p.heightCm - 5 * p.age + (p.sex === 'm' ? 5 : -161)) * (p.activity || 1.375);
}
export const minKcal = () => (data.profile?.sex === 'm' ? 1500 : 1200);

// Норма калорий с поправкой на цель из профиля
export function autoKcalGoal() {
  const p = data.profile;
  if (!p) return 2000;
  let k = tdee();
  if (p.goal === 'lose') k -= 500;
  if (p.goal === 'gain') k += 300;
  return Math.round(Math.max(minKcal(), k) / 10) * 10;
}

// Цель по весу (js/goal.js): каждый день на «daily» ккал меньше (или больше), чем тратит организм
export const goalReached = (kg = currentWeight()) => !!data.goalPlan && data.goalPlan.dir * (kg - data.goalPlan.targetKg) <= 0.1;
export function planKcal(kg = currentWeight()) {
  const g = data.goalPlan;
  return Math.round(Math.max(minKcal(), tdee(kg) - g.dir * g.daily) / 10) * 10;
}
const goalKcal = () => (data.goalPlan && data.profile && !goalReached() ? planKcal() : null);

export const kcalGoal = () => goalKcal() || data.settings.kcalGoal || autoKcalGoal();

export function bmi(kg = currentWeight(), cm = data.profile?.heightCm) {
  if (!cm) return null;
  return Math.round((kg / (cm / 100) ** 2) * 10) / 10;
}

export function bmiCategory(b) {
  if (b == null) return '';
  if (b < 18.5) return 'bmi_low';
  if (b < 25) return 'bmi_ok';
  if (b < 30) return 'bmi_over';
  return 'bmi_obese';
}

export const sportType = id => SPORT_TYPES.find(s => s.id === id) || SPORT_TYPES[SPORT_TYPES.length - 1];

export function sportKcal(typeId, minutes) {
  return Math.round(sportType(typeId).met * currentWeight() * (minutes / 60));
}

// Длительность сна в минутах (через полночь тоже работает)
export function sleepMinutes(bed, wake) {
  if (!bed || !wake) return 0;
  const toMin = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  return (toMin(wake) - toMin(bed) + 1440) % 1440;
}

export const dayEaten = day => day.food.reduce((s, f) => s + (Number(f.kcal) || 0), 0);
export const dayBurned = day => day.sport.reduce((s, x) => s + (Number(x.kcal) || 0), 0);
export const daySportMin = day => day.sport.reduce((s, x) => s + (Number(x.min) || 0), 0);
