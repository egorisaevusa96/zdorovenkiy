// Хранилище: все записи лежат в памяти телефона (localStorage).
import { PRESET_HABITS } from './content.js';

const KEY = 'zdorovenkiy.v1';

export const DEFAULT_SETTINGS = {
  lang: 'ru',          // 'ru' | 'en'
  units: 'metric',     // 'metric' | 'us'
  tone: 'fun',         // 'kind' | 'fun' | 'strict'
  waterGoal: 8,        // стаканов в день
  stepsGoal: 8000,
  kcalGoal: null,      // null = считать автоматически
  installHintHidden: false,
  aiUrl: '',           // адрес сервера ИИ (Cloudflare Worker)
  aiCode: '',          // семейный пароль для сервера ИИ
};

function fresh() {
  return {
    version: 1,
    settings: { ...DEFAULT_SETTINGS },
    profile: null,
    days: {},
    weights: [],       // [{ date: 'YYYY-MM-DD', kg }]
    habits: PRESET_HABITS.map(h => ({ id: h.id, emoji: h.emoji, name: h.name, active: h.on })),
    badges: {},        // { badgeId: 'YYYY-MM-DD' }
    recipes: [],       // свои рецепты
    plan: null,        // меню на неделю
    planPrefs: { servings: 2, meals: ['breakfast', 'lunch', 'dinner'], prep: { mode: 0, meals: ['lunch', 'dinner'] } },
    plansMade: 0,
    shop: { planId: null, checked: {} },
    coach: { msgs: [], lastReview: null }, // переписка с ИИ-тренером
    aiPhotos: 0,
    aiJob: null,       // меню от ИИ, которое сейчас делает сервер: { id, at, servings, meals, prep }
    device: null,      // этот телефон на сервере: { id, token }
    push: { on: false }, // напоминания включены?
    reminders: {},     // настройки напоминаний (пусто = по умолчанию)
    antiyt: { limit: 60 }, // лимит «анти-YouTube», минут в день
    lastBackup: null,
    createdAt: new Date().toISOString(),
  };
}

function migrate(d) {
  const f = fresh();
  return {
    ...f,
    ...d,
    settings: { ...f.settings, ...(d.settings || {}) },
    days: d.days || {},
    weights: Array.isArray(d.weights) ? d.weights : [],
    habits: Array.isArray(d.habits) ? d.habits : f.habits,
    badges: d.badges || {},
    recipes: Array.isArray(d.recipes) ? d.recipes : [],
    planPrefs: { ...f.planPrefs, ...(d.planPrefs || {}) },
    shop: d.shop && d.shop.checked ? d.shop : f.shop,
  };
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return migrate(JSON.parse(raw));
  } catch (e) {
    console.warn('Не удалось прочитать данные', e);
  }
  return fresh();
}

export let data = load();

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch (e) {
    console.error('Не удалось сохранить', e);
    return false;
  }
}

export function replaceData(newData) {
  data = migrate(newData);
  save();
}

// Копия данных для файла резервной копии: без семейного пароля и без «пропуска» этого телефона на сервер.
// Так файл можно хранить в iCloud и не бояться, что по нему кто-то получит доступ к ИИ.
export function exportData() {
  const copy = JSON.parse(JSON.stringify(data));
  copy.settings.aiCode = '';
  copy.device = null;
  copy.push = { on: false };
  copy.aiJob = null;
  return copy;
}

export function wipeData() {
  data = fresh();
  save();
}

// ---- Даты ----
const pad = n => String(n).padStart(2, '0');

export function dateKey(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function keyToDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export const todayKey = () => dateKey();

export function addDays(key, n) {
  const d = keyToDate(key);
  d.setDate(d.getDate() + n);
  return dateKey(d);
}

// ---- Дни ----
export function emptyDay() {
  return { water: 0, food: [], sport: [], steps: 0, sleep: null, diary: null, habits: {} };
}

// Только посмотреть (не создаёт пустой день)
export function peekDay(key) {
  return data.days[key] || emptyDay();
}

// Получить день для записи (создаёт, если нет)
export function getDay(key) {
  if (!data.days[key]) data.days[key] = emptyDay();
  return data.days[key];
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
