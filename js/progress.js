// Очки, уровни, серии дней и награды.
import { data, peekDay, todayKey, addDays } from './store.js';
import { daySportMin } from './health.js';

export const POINTS_PER_LEVEL = 250;

export function dayPoints(day) {
  const s = data.settings;
  let p = 0;
  p += Math.min(day.water, 12);
  if (day.water >= s.waterGoal) p += 10;
  p += Math.min(day.food.length * 2, 10);
  p += Math.min(Math.floor(daySportMin(day) / 5), 20);
  if (day.steps >= s.stepsGoal) p += 10;
  else if (day.steps > 0) p += 2;
  if (day.sleep) p += 5;
  if (day.diary) p += 5;
  p += Object.values(day.habits).filter(Boolean).length * 3;
  return p;
}

export function totalPoints() {
  let p = data.weights.length * 3;
  for (const day of Object.values(data.days)) p += dayPoints(day);
  return p;
}

export function level(points = totalPoints()) {
  return {
    level: Math.floor(points / POINTS_PER_LEVEL) + 1,
    inLevel: points % POINTS_PER_LEVEL,
    progress: (points % POINTS_PER_LEVEL) / POINTS_PER_LEVEL,
  };
}

// Серия дней подряд. Если сегодня ещё не выполнено — считаем от вчера,
// чтобы серия не «сгорала» с утра.
export function streak(pred) {
  let key = todayKey();
  if (!pred(peekDay(key))) key = addDays(key, -1);
  let n = 0;
  while (pred(peekDay(key)) && n < 3650) {
    n++;
    key = addDays(key, -1);
  }
  return n;
}

export const waterStreak = () => streak(d => d.water >= data.settings.waterGoal);
export const habitStreak = id => streak(d => !!d.habits[id]);
export const activeStreak = () => streak(d => dayPoints(d) > 0);

function stats() {
  const days = Object.values(data.days);
  return {
    waterGoalDays: days.filter(d => d.water >= data.settings.waterGoal).length,
    waterStreak: waterStreak(),
    workouts: days.reduce((s, d) => s + d.sport.length, 0),
    maxSteps: days.reduce((m, d) => Math.max(m, d.steps || 0), 0),
    sleepDays: days.filter(d => d.sleep).length,
    diaryDays: days.filter(d => d.diary).length,
    weights: data.weights.length,
    foodEntries: days.reduce((s, d) => s + d.food.length, 0),
    bestHabitStreak: data.habits.filter(h => h.active).reduce((m, h) => Math.max(m, habitStreak(h.id)), 0),
    activeStreak: activeStreak(),
    level: level().level,
    backup: !!data.lastBackup,
    plansMade: data.plansMade || 0,
    ownRecipes: data.recipes.length,
  };
}

export const BADGES = [
  { id: 'water1', emoji: '💧', name: { ru: 'Водохлёб', en: 'Hydrated' }, desc: { ru: 'Выпить норму воды за день', en: 'Hit your water goal for a day' }, ok: s => s.waterGoalDays >= 1 },
  { id: 'water7', emoji: '🌊', name: { ru: 'Неделя воды', en: 'Water week' }, desc: { ru: 'Норма воды 7 дней подряд', en: 'Water goal 7 days in a row' }, ok: s => s.waterStreak >= 7 },
  { id: 'sport1', emoji: '🏃', name: { ru: 'Первая тренировка', en: 'First workout' }, desc: { ru: 'Записать первую тренировку', en: 'Log your first workout' }, ok: s => s.workouts >= 1 },
  { id: 'sport20', emoji: '💪', name: { ru: 'Спортсмен', en: 'Athlete' }, desc: { ru: '20 тренировок', en: '20 workouts' }, ok: s => s.workouts >= 20 },
  { id: 'steps10k', emoji: '👣', name: { ru: '10 000 шагов', en: '10,000 steps' }, desc: { ru: 'Пройти 10 000 шагов за день', en: 'Walk 10,000 steps in a day' }, ok: s => s.maxSteps >= 10000 },
  { id: 'sleep7', emoji: '😴', name: { ru: 'Соня', en: 'Sleepyhead' }, desc: { ru: 'Записать сон 7 раз', en: 'Log your sleep 7 times' }, ok: s => s.sleepDays >= 7 },
  { id: 'diary10', emoji: '📔', name: { ru: 'Летописец', en: 'Chronicler' }, desc: { ru: '10 записей в дневнике', en: '10 diary entries' }, ok: s => s.diaryDays >= 10 },
  { id: 'weight5', emoji: '⚖️', name: { ru: 'На весах', en: 'On the scale' }, desc: { ru: 'Взвеситься 5 раз', en: 'Weigh in 5 times' }, ok: s => s.weights >= 5 },
  { id: 'food50', emoji: '🍽️', name: { ru: 'Учёт еды', en: 'Food tracker' }, desc: { ru: '50 записей еды', en: '50 food entries' }, ok: s => s.foodEntries >= 50 },
  { id: 'habit7', emoji: '✅', name: { ru: 'Привычка', en: 'Habit formed' }, desc: { ru: 'Любая привычка 7 дней подряд', en: 'Any habit 7 days in a row' }, ok: s => s.bestHabitStreak >= 7 },
  { id: 'active30', emoji: '🔥', name: { ru: 'Месяц в строю', en: 'Month strong' }, desc: { ru: '30 дней подряд с записями', en: '30 days in a row with entries' }, ok: s => s.activeStreak >= 30 },
  { id: 'level5', emoji: '⭐', name: { ru: 'Уровень 5', en: 'Level 5' }, desc: { ru: 'Дойти до 5 уровня', en: 'Reach level 5' }, ok: s => s.level >= 5 },
  { id: 'menu1', emoji: '📅', name: { ru: 'Планировщик', en: 'Planner' }, desc: { ru: 'Составить меню на неделю', en: 'Make a weekly meal plan' }, ok: s => s.plansMade >= 1 },
  { id: 'chef', emoji: '👨‍🍳', name: { ru: 'Шеф-повар', en: 'Chef' }, desc: { ru: 'Добавить свой рецепт', en: 'Add your own recipe' }, ok: s => s.ownRecipes >= 1 },
  { id: 'backup', emoji: '💾', name: { ru: 'Предусмотрительный', en: 'Prepared' }, desc: { ru: 'Сделать резервную копию', en: 'Make a backup' }, ok: s => s.backup },
];

// Проверяет награды и возвращает только что полученные
export function checkBadges() {
  const s = stats();
  const fresh = [];
  for (const b of BADGES) {
    if (!data.badges[b.id] && b.ok(s)) {
      data.badges[b.id] = todayKey();
      fresh.push(b);
    }
  }
  return fresh;
}
