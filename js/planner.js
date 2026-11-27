// Меню на неделю, ограничения в питании и список покупок.
import { data, todayKey, addDays, uid } from './store.js';
import { RECIPES, ING, SECTIONS } from './recipes.js';
import { kcalGoal } from './health.js';
import { nm } from './i18n.js';
import { fmtAmount } from './units.js';

export const MEALS = ['breakfast', 'lunch', 'dinner', 'snack'];
const MEAL_SHARE = { breakfast: 0.25, lunch: 0.35, dinner: 0.3, snack: 0.1 };

// ---------- Рецепты (встроенные + свои) ----------
function normCustom(r) {
  const sv = Math.max(1, r.servings || 1);
  return {
    id: r.id, custom: true, cuisine: 'own', emoji: r.emoji || '🍲', name: r.name, meals: r.meals || [],
    time: r.time || 0, kcal: r.kcal || 0, servings: sv,
    ings: (r.ings || []).map(i => ({ custom: true, name: i.name, q: i.q ? i.q / sv : 0, u: i.u })),
    steps: (r.steps || []).map(s => ({ ru: s, en: s })),
  };
}
export const allRecipes = () => [...RECIPES, ...data.recipes.map(normCustom)];

// Рецепты из меню от ИИ: живут внутри самого меню (количества — на 1 порцию)
function normAi(r) {
  return {
    id: r.id, ai: true, cuisine: 'ai', emoji: r.emoji || '🍲', name: r.name, meals: r.meals || [],
    time: r.time || 0, kcal: r.kcal || 0, servings: 1, fridge: r.fridge || 0, freeze: !!r.freeze,
    ings: (r.ings || []).map(i => {
      const taste = i.u === 'taste' || !i.q;
      return { custom: true, name: i.name, q: taste ? 0 : i.q, u: taste ? 'taste' : i.u, sec: SECTIONS.includes(i.sec) ? i.sec : 'other' };
    }),
    steps: (r.steps || []).map(s => ({ ru: s, en: s })),
  };
}
export const planRecipes = () => (data.plan?.recipes || []).map(normAi);
export const recipeById = id => allRecipes().find(r => r.id === id) || planRecipes().find(r => r.id === id) || null;

// Ответ ИИ → наше меню на 7 дней
export function planFromAi(res, { servings, meals, prep }) {
  const id = uid();
  const start = todayKey();
  const map = {};
  const recipes = res.recipes.map(r => {
    const nid = `ai-${id}-${r.id}`;
    map[r.id] = nid;
    return {
      id: nid, emoji: String(r.emoji || '🍲').slice(0, 4), name: String(r.name || '').slice(0, 80),
      meals: (r.meals || []).filter(m => MEALS.includes(m)),
      time: Math.max(0, Math.round(r.time) || 0), kcal: Math.max(0, Math.round(r.kcal) || 0),
      fridge: Math.min(5, Math.max(0, Math.round(r.fridge) || 0)), freeze: !!r.freeze,
      ings: (r.ings || []).slice(0, 30), steps: (r.steps || []).slice(0, 12),
    };
  });
  const days = res.days.slice(0, 7).map((d, i) => ({
    date: addDays(start, i),
    items: Object.fromEntries(meals.map(m => [m, map[d[m]] || null])),
    eaten: {},
  }));
  // Если ИИ забыл указать, к какому приёму подходит блюдо — берём из меню
  for (const r of recipes) {
    if (r.meals.length) continue;
    r.meals = meals.filter(m => days.some(d => d.items[m] === r.id));
  }
  const plan = { id, start, servings, meals, days, createdAt: new Date().toISOString(), ai: true, note: res.note || '', recipes };
  const pr = prepSetup(prep, meals);
  if (pr) {
    plan.prep = pr;
    // ИИ мог чуть отступить от схемы — ставим блюдо первого дня группы на все её дни
    for (const m of pr.meals) {
      for (const g of pr.groups[m]) {
        const id0 = g.days.map(i => days[i].items[m]).find(Boolean) || null;
        g.days.forEach(i => { days[i].items[m] = id0; });
      }
    }
  }
  return plan;
}

// ---------- Аллергии и «не ем» из профиля ----------
// Слова-категории: «молочное» убирает всё молочное. Русские слова — начало слова, английские — слово целиком.
const TAG_WORDS = {
  fish: ['рыб', 'fish', 'лосос', 'salmon', 'тунец', 'тунц', 'tuna', 'треск', 'cod'],
  seafood: ['морепрод', 'креветк', 'shrimp', 'seafood', 'краб', 'shellfish'],
  nuts: ['орех', 'nut', 'арахис', 'peanut', 'миндал', 'almond'],
  dairy: ['молок', 'молоч', 'dairy', 'milk', 'лактоз', 'lactose', 'сыр', 'cheese', 'творог', 'сметан'],
  gluten: ['глютен', 'gluten', 'пшениц', 'wheat', 'мук', 'flour'],
  egg: ['яйц', 'яиц', 'egg'],
  meat: ['мяс', 'meat'],
  pork: ['свинин', 'pork'],
  beef: ['говяд', 'говяж', 'телят', 'beef', 'veal'],
  poultry: ['птиц', 'poultry'],
  mushrooms: ['гриб', 'mushroom'],
  honey: ['мед', 'honey'],
  sugar: ['сахар', 'sugar', 'сладкое', 'сладкого', 'сладост', 'sweets'],
  soy: ['соя', 'сои', 'сою', 'соев', 'soy', 'soya', 'тофу', 'tofu'],
  citrus: ['цитрус', 'citrus'],
  legumes: ['бобов', 'legume', 'pulses'],
  tomato: ['помидор', 'томат', 'tomato'],
};
const STOP = new Set(['без', 'нет', 'или', 'ем', 'люблю', 'не', 'and', 'not', 'free', 'without', 'don’t', "don't", 'eat', 'dislike', 'like',
  'аллергия', 'аллергии', 'allergy', 'allergic', 'the', 'очень', 'много', 'мало', 'диета', 'diet', 'питание', 'кроме', 'есть', 'ничего',
  'none', 'все', 'для', 'при', 'any', 'low', 'high', 'нельзя', 'можно', 'только']);

const yo = s => String(s || '').toLowerCase().replace(/ё/g, 'е');
const splitWords = text => yo(text).split(/[^a-zа-я0-9’']+/).filter(Boolean);
function words(text) {
  return splitWords(text).filter(w => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w));
}
const isLatin = w => /^[a-z’']+$/.test(w);
// «tomatoes» → «tomato», «nuts» → «nut»
const enBase = w => (w.length > 4 && w.endsWith('es') ? w.slice(0, -2) : w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w);
// Подходит ли слово человека к слову-категории
function hitsTag(w, tw) {
  if (isLatin(tw)) return w === tw || enBase(w) === tw || enBase(w) === enBase(tw);
  return w.startsWith(tw) && w.length - tw.length <= 4;
}
const tagsOfWord = w => Object.entries(TAG_WORDS).filter(([, list]) => list.some(tw => hitsTag(w, yo(tw)))).map(([tag]) => tag);
// Основа слова: «курица» → «кури», «кинза» → «кинз», «рис» → «рис»
const ruStem = w => (w.length <= 3 ? w : w.length <= 5 ? w.slice(0, -1) : w.slice(0, -2));
// Слово человека совпало со словом из названия продукта?
function wordHits(w, nameWords) {
  if (isLatin(w)) { const b = enBase(w); return nameWords.some(n => isLatin(n) && enBase(n) === b); }
  const st = ruStem(w);
  return nameWords.some(n => !isLatin(n) && n.startsWith(st));
}
const VEG = /^(вегетар|vegetar)/, VEGAN = /^(веган|vegan)/;

export function restrictions() {
  const p = data.profile || {};
  const ws = [...new Set(words([p.allergies, p.dislikes, p.diet].join(' ')))];
  const tags = new Set();
  const tagged = new Set(); // слова, которые поняли как категорию
  for (const w of ws) {
    const tg = tagsOfWord(w);
    if (tg.length) tagged.add(w);
    tg.forEach(x => tags.add(x));
    if (VEG.test(w)) { tagged.add(w); ['meat', 'pork', 'beef', 'poultry', 'fish', 'seafood'].forEach(x => tags.add(x)); }
    if (VEGAN.test(w)) { tagged.add(w); ['meat', 'pork', 'beef', 'poultry', 'fish', 'seafood', 'dairy', 'egg', 'honey'].forEach(x => tags.add(x)); }
  }
  // вегетарианцы и веганы — не исключаем по самому слову
  const plain = ws.filter(w => !VEG.test(w) && !VEGAN.test(w));
  return { tags, words: plain, tagged };
}

// Названия и метки одного продукта рецепта
function ingInfo(i) {
  if (!i.custom) {
    const d = ING[i.k];
    return { name: nm(d?.name), nameWords: splitWords(`${d?.name.ru} ${d?.name.en}`), tags: d?.tags || [] };
  }
  const nameWords = splitWords(i.name);
  return { name: i.name, nameWords, tags: [...new Set(nameWords.flatMap(tagsOfWord))] };
}

// Какие продукты рецепта не подходят (список названий)
export function conflicts(r, rs = restrictions()) {
  if (!rs.tags.size && !rs.words.length) return [];
  const out = new Set();
  for (const i of r.ings) {
    const info = ingInfo(i);
    const byTag = info.tags.some(tg => rs.tags.has(tg));
    const byWord = rs.words.some(w => wordHits(w, info.nameWords));
    if (byTag || byWord) out.add(info.name);
  }
  return [...out];
}

// Отчёт для экрана меню: какие продукты убраны и какие слова программа не поняла
export function restrictionReport() {
  const rs = restrictions();
  const excluded = new Set(), used = new Set(rs.tagged);
  if (rs.tags.size || rs.words.length) {
    for (const r of [...allRecipes(), ...planRecipes()]) {
      for (const i of r.ings) {
        const info = ingInfo(i);
        const hit = rs.words.filter(w => wordHits(w, info.nameWords));
        hit.forEach(w => used.add(w));
        if (hit.length || info.tags.some(tg => rs.tags.has(tg))) excluded.add(info.name);
      }
    }
  }
  return {
    any: rs.tags.size > 0 || rs.words.length > 0,
    excluded: [...excluded].sort((x, y) => x.localeCompare(y)),
    unknown: rs.words.filter(w => !used.has(w)),
  };
}

// ---------- Готовка впрок ----------
// Сколько дней блюдо живёт в холодильнике и можно ли его заморозить. Нет в списке — впрок не готовим.
const STORE = {
  oatmeal: [3, false], syrniki: [3, true], millet: [3, false], casserole: [3, true], overnight_oats: [3, false],
  borscht: [4, true], shchi: [4, true], noodle_soup: [3, false], buckwheat_soup: [3, true], rassolnik: [4, true],
  ukha: [2, false], lentil_soup: [4, true], buckwheat_chicken: [4, true], meatballs: [4, true], cutlets: [4, true],
  lazy_golubtsy: [4, true], baked_cod: [2, false], plov: [4, true], beef_stew: [4, true], stuffed_zucchini: [3, true],
  stewed_cabbage: [4, true], navy_pasta: [3, false], vinegret: [3, false], baked_apple: [2, false], hummus: [4, false],
  tabbouleh: [3, false], burrito_bowl: [4, true], bolognese: [4, true], stir_fry: [3, false], salmon_quinoa: [3, false],
  curry: [4, true], chickpea_stew: [4, true], sweet_potato: [4, true],
};
export function storeInfo(r) {
  if (!r) return null;
  if (r.ai) return r.fridge ? { fridge: r.fridge, freeze: r.freeze } : { fridge: 3, freeze: false };
  if (r.custom) return { fridge: 3, freeze: false };
  const v = STORE[r.id];
  return v ? { fridge: v[0], freeze: v[1] } : null;
}
// Группы дней: готовим раз в N дней (N = 2…7). Одинокий последний день прибавляем к прошлой готовке.
// Если одна готовка на 5+ дней — два блюда через день, чтобы не надоело.
export function prepBlocks(n) {
  const chunks = [];
  for (let s = 0; s < 7; s += n) chunks.push(Array.from({ length: Math.min(n, 7 - s) }, (_, i) => s + i));
  if (chunks.length > 1 && chunks[chunks.length - 1].length === 1) chunks[chunks.length - 2].push(...chunks.pop());
  return chunks.flatMap(c => c.length >= 5
    ? [{ cook: c[0], days: c.filter((_, i) => i % 2 === 0) }, { cook: c[0], days: c.filter((_, i) => i % 2 === 1) }]
    : [{ cook: c[0], days: c }]);
}
export function prepSetup(prep, meals) {
  const mode = Math.min(7, Math.round(Number(prep?.mode) || 0));
  const pm = (prep?.meals || []).filter(m => meals.includes(m));
  if (mode < 2 || !pm.length) return null;
  return { mode, meals: pm, groups: Object.fromEntries(pm.map(m => [m, prepBlocks(mode)])) };
}
export const groupOf = (plan, di, m) => plan?.prep?.groups?.[m]?.find(g => g.days.includes(di)) || null;
// Хватит ли срока хранения на всю группу (с морозилкой или без)
function keeps(r, g) {
  const st = storeInfo(r);
  if (!st) return false;
  const span = Math.max(...g.days) - g.cook;
  return st.freeze || span < st.fridge;
}
// Порции группы: сколько в холодильник, сколько в морозилку
export function groupStorage(plan, m, g) {
  const r = recipeById(plan.days[g.days[0]].items[m]);
  const st = storeInfo(r) || { fridge: 3, freeze: false };
  let fridge = 0, freezer = 0;
  for (const i of g.days) (i - g.cook < st.fridge ? fridge++ : freezer++);
  return { r, fridge: fridge * plan.servings, freezer: freezer * plan.servings, days: st.fridge, por: porOf(plan.days[g.days[0]], m) };
}

// ---------- Подбор меню ----------
function shuffle(a) {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
  return b;
}

function pick(pool, meal, target, used, dayUsed, exclude) {
  let cands = pool.filter(r => r.meals.includes(meal) && !dayUsed.has(r.id) && r.id !== exclude);
  if (!cands.length) return null;
  const minUse = Math.min(...cands.map(r => used.get(r.id) || 0));
  cands = cands.filter(r => (used.get(r.id) || 0) === minUse);
  // Русской домашней кухни — побольше (примерно 2 из 3)
  const home = cands.filter(r => r.cuisine !== 'world');
  const world = cands.filter(r => r.cuisine === 'world');
  const group = Math.random() < 0.65 ? (home.length ? home : world) : (world.length ? world : home);
  const sample = shuffle(group).slice(0, 4);
  sample.sort((a, b) => Math.abs(a.kcal - target) - Math.abs(b.kcal - target));
  return sample[0];
}

const suitable = () => { const rs = restrictions(); return allRecipes().filter(r => !conflicts(r, rs).length); };

export function generatePlan({ servings, meals, prep }) {
  const pool = suitable();
  const goal = kcalGoal();
  const used = new Map();
  const start = todayKey();
  const days = Array.from({ length: 7 }, (_, i) => ({ date: addDays(start, i), items: {}, eaten: {} }));
  const pr = prepSetup(prep, meals);
  const fresh = [], partial = [];
  // Сначала — блюда впрок: одно блюдо на всю группу дней
  if (pr) {
    const taken = new Set();
    for (const m of pr.meals) {
      for (const g of pr.groups[m]) {
        let ok = pool.filter(r => !taken.has(r.id) && keeps(r, g));
        if (!ok.length) ok = pool.filter(r => keeps(r, g)); // мало подходящих блюд — можно повторить
        const r = pick(ok, m, goal * MEAL_SHARE[m], used, new Set());
        if (!r) continue;
        taken.add(r.id);
        used.set(r.id, (used.get(r.id) || 0) + g.days.length);
        g.days.forEach(i => { days[i].items[m] = r.id; });
      }
      // Группы, для которых не нашлось блюда с нужным сроком хранения, — эти дни готовим свежими
      const filled = pr.groups[m].filter(g => days[g.days[0]].items[m]);
      if (!filled.length) fresh.push(m);
      else if (filled.length < pr.groups[m].length) partial.push(m);
      pr.groups[m] = filled;
    }
    // Если для приёма пищи нет подходящих блюд — его готовим каждый день свежим
    for (const m of fresh) { delete pr.groups[m]; pr.meals = pr.meals.filter(x => x !== m); }
  }
  for (const day of days) {
    const dayUsed = new Set(Object.values(day.items).filter(Boolean));
    for (const m of meals) {
      if (day.items[m]) continue; // уже стоит блюдо из заготовки
      const r = pick(pool, m, goal * MEAL_SHARE[m], used, dayUsed);
      day.items[m] = r ? r.id : null;
      if (r) { used.set(r.id, (used.get(r.id) || 0) + 1); dayUsed.add(r.id); }
    }
  }
  const plan = { id: uid(), start, servings, meals, days, createdAt: new Date().toISOString() };
  if (pr && pr.meals.length) plan.prep = pr;
  if (fresh.length) plan.prepFresh = fresh;
  if (partial.length) plan.prepPartial = partial;
  setPortions(plan, goal);
  return plan;
}

// ---------- Размер порции под норму калорий ----------
// В книге порции небольшие (300–500 ккал). Чтобы день сходился с нормой, считаем, сколько порций рецепта
// нужно одному человеку на этот приём пищи: 1, 1¼, 1½ … Блюда от ИИ уже посчитаны под норму — у них всегда 1.
export function portionFor(r, meal, goal = kcalGoal()) {
  if (!r || r.ai || !r.kcal || !MEAL_SHARE[meal]) return 1;
  const f = Math.round(((goal * MEAL_SHARE[meal]) / r.kcal) * 4) / 4;
  return Math.min(2.5, Math.max(0.5, f));
}
export const porOf = (day, m) => Number(day?.por?.[m]) || 1;
export function setPortions(plan, goal = kcalGoal()) {
  plan.porGoal = goal; // под какую норму калорий подобраны порции
  for (const day of plan.days) {
    day.por = {};
    for (const m of plan.meals) {
      const f = portionFor(recipeById2(plan, day.items[m]), m, goal);
      if (f !== 1) day.por[m] = f;
    }
  }
}
// Рецепт по номеру, в том числе из меню, которое ещё не сохранено
function recipeById2(plan, id) {
  if (!id) return null;
  return allRecipes().find(r => r.id === id) || (plan.recipes || []).map(normAi).find(r => r.id === id) || null;
}
// Поставить блюдо в день меню и пересчитать его порцию
export function setItem(plan, di, m, id) {
  const day = plan.days[di];
  day.items[m] = id || null;
  day.por = day.por || {};
  const f = portionFor(recipeById2(plan, id), m);
  if (f !== 1) day.por[m] = f; else delete day.por[m];
}

// Замена блюда в заготовке — только из тех, что хранятся нужный срок
export function prepCandidates(plan, di, m) {
  const g = groupOf(plan, di, m);
  const list = suitableFor(m);
  return g ? list.filter(r => keeps(r, g)) : list;
}

// Случайная замена одного блюда
export function replacement(plan, dayIdx, meal) {
  const used = new Map();
  plan.days.forEach(d => Object.values(d.items).forEach(id => id && used.set(id, (used.get(id) || 0) + 1)));
  const day = plan.days[dayIdx];
  const dayUsed = new Set(Object.entries(day.items).filter(([m, id]) => m !== meal && id).map(([, id]) => id));
  const g = groupOf(plan, dayIdx, meal);
  const pool = g ? suitable().filter(r => keeps(r, g)) : suitable();
  const r = pick(pool, meal, kcalGoal() * MEAL_SHARE[meal], used, dayUsed, day.items[meal]);
  return r ? r.id : day.items[meal];
}

export const suitableFor = meal => {
  const rs = restrictions();
  const ai = planRecipes().filter(r => !conflicts(r, rs).length);
  return [...ai, ...suitable()].filter(r => r.meals.includes(meal));
};

// ---------- Список покупок ----------
export function shoppingList(plan) {
  const map = new Map();
  for (const day of plan.days) {
    for (const m of plan.meals) {
      const r = day.items[m] && recipeById(day.items[m]);
      if (!r) continue;
      for (const i of r.ings) {
        let key, entry;
        if (i.custom) {
          key = `c:${yo(i.name).trim()}:${i.q ? i.u : 'taste'}`;
          entry = map.get(key) || { key, name: i.name, sec: i.sec || 'other', u: i.q ? i.u : 'taste', q: 0 };
        } else {
          const d = ING[i.k];
          if (!d) continue;
          key = i.k;
          entry = map.get(key) || { key, name: nm(d.name), sec: d.sec, u: d.u, q: 0 };
        }
        entry.q += (i.q || 0) * plan.servings * porOf(day, m);
        map.set(key, entry);
      }
    }
  }
  const groups = [];
  for (const sec of SECTIONS) {
    const items = [...map.values()].filter(x => x.sec === sec)
      .map(x => ({ ...x, qty: fmtAmount(x.q, x.u, true) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (items.length) groups.push({ sec, items });
  }
  return groups;
}

// ---------- Свой рецепт: разбор строки «Курица 500 г» ----------
const UNITS = [
  [/^(кг|kg)$/, 'g', 1000], [/^(г|гр|g|gr|grams?)$/, 'g', 1], [/^(л|l)$/, 'ml', 1000], [/^(мл|ml)$/, 'ml', 1],
  [/^(шт|pcs|pc)$/, 'pcs', 1], [/^(ст\.?л|tbsp|ст\.ложк\S*)$/, 'tbsp', 1], [/^(ч\.?л|tsp)$/, 'tsp', 1],
  [/^oz$/, 'g', 28.35], [/^lbs?$/, 'g', 453.6], [/^cups?$/, 'ml', 240], [/^стакан\S*$/, 'ml', 250],
  [/^(зубч\S*|cloves?)$/, 'clove', 1],
];
function unitOf(s) {
  const u = String(s || '').toLowerCase().replace(/\.$/, '');
  for (const [re, base, k] of UNITS) if (re.test(u)) return { u: base, k };
  return null;
}
// Число из строки: «1,5», «1/2», «3-4» (из «от и до» берём большее — чтобы хватило)
const NUM = String.raw`\d+(?:[.,]\d+)?(?:\s*\/\s*\d+)?(?:\s*[-–]\s*\d+(?:[.,]\d+)?)?`;
function numOf(str) {
  const one = x => { const [p, q] = x.split('/').map(v => parseFloat(v.replace(',', '.'))); return q ? p / q : p; };
  const parts = str.split(/[-–]/).map(x => x.trim()).filter(Boolean).map(one).filter(v => Number.isFinite(v));
  return parts.length ? Math.max(...parts) : 0;
}
export function parseIngLine(raw) {
  const line = raw.trim().replace(/ст\.\s*л\.?/gi, 'ст.л').replace(/ч\.\s*л\.?/gi, 'ч.л');
  if (!line) return null;
  // «Курица 500 г»
  let m = line.match(new RegExp(`^(.+?)[\\s:—–-]+(${NUM})\\s*([a-zа-яё.]+)?$`, 'i'));
  if (m) {
    const q = numOf(m[2]);
    if (!m[3]) return { name: m[1].trim(), q, u: 'pcs' };
    const un = unitOf(m[3]);
    if (un) return { name: m[1].trim(), q: q * un.k, u: un.u };
  }
  // «2 яйца», «500 г курицы», «1/2 лимона»
  m = line.match(new RegExp(`^(${NUM})\\s*(\\S+)\\s*(.*)$`));
  if (m) {
    const q = numOf(m[1]);
    const un = unitOf(m[2]);
    if (un && m[3]) return { name: m[3].trim(), q: q * un.k, u: un.u };
    return { name: `${m[2]} ${m[3]}`.trim(), q, u: 'pcs' };
  }
  return { name: line, q: 0, u: 'taste' };
}
