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

// Норма калорий: формула Миффлина — Сан Жеора × активность, с поправкой на цель
export function autoKcalGoal() {
  const p = data.profile;
  if (!p) return 2000;
  const w = currentWeight();
  const base = 10 * w + 6.25 * p.heightCm - 5 * p.age + (p.sex === 'm' ? 5 : -161);
  let tdee = base * (p.activity || 1.375);
  if (p.goal === 'lose') tdee -= 500;
  if (p.goal === 'gain') tdee += 300;
  const min = p.sex === 'm' ? 1500 : 1200;
  return Math.round(Math.max(min, tdee) / 10) * 10;
}

export const kcalGoal = () => data.settings.kcalGoal || autoKcalGoal();

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
