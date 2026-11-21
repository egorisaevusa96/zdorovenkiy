// «Здаровенький ИИ» — маленький сервер на Cloudflare Workers.
// Он прячет ключ Claude API: сайт присылает сюда запрос + семейный пароль,
// сервер спрашивает Claude и отдаёт ответ обратно.
//
// Адреса (все POST, JSON):
//   /ping   — проверка связи и пароля
//   /photo  — фото еды → название и калории
//   /menu   — меню на неделю с рецептами
//   /coach  — ИИ-тренер: разбор недели или ответ на вопрос
import Anthropic from '@anthropic-ai/sdk';

const SECTIONS = ['veg', 'fruit', 'meat', 'fish', 'dairy', 'eggs', 'grain', 'bakery', 'canned', 'frozen', 'nuts', 'other', 'spice'];
const MEALS = ['breakfast', 'lunch', 'dinner', 'snack'];
const UNITS = ['g', 'ml', 'pcs', 'tbsp', 'tsp', 'clove', 'taste'];
const MAX_BODY = 3_000_000; // ~3 МБ — фото уже уменьшено на телефоне

// ---------- Ответы и CORS ----------
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Family-Code',
  'Access-Control-Max-Age': '86400',
};
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS } });

class UserError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}

// Сравнение пароля без утечки по времени
function sameCode(a, b) {
  const x = new TextEncoder().encode(String(a || ''));
  const y = new TextEncoder().encode(String(b || ''));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

const str = (v, max = 300) => String(v ?? '').trim().slice(0, max);
const int = (v, lo, hi, def) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def; };
const langOf = v => (v === 'en' ? 'en' : 'ru');
const LANG_NAME = { ru: 'Russian', en: 'English' };

// ---------- Вызов Claude ----------
// Потоковый запрос (не упирается в тайм-ауты) + запасная модель,
// если основная откажется отвечать по правилам безопасности.
async function askClaude(env, { system, messages, effort, maxTokens, schema }) {
  if (!env.ANTHROPIC_API_KEY) throw new UserError('no_key', 500);
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const params = {
    model: env.MODEL || 'claude-opus-5-5',
    max_tokens: maxTokens,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system,
    messages,
    output_config: { effort, ...(schema ? { format: { type: 'json_schema', schema } } : {}) },
  };
  const msg = await client.beta.messages.stream(params).finalMessage();
  if (msg.stop_reason === 'refusal') throw new UserError('refusal', 422);
  if (msg.stop_reason === 'max_tokens') throw new UserError('too_long', 502);
  const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
  if (!schema) return text;
  try {
    return JSON.parse(text);
  } catch {
    throw new UserError('bad_answer', 502);
  }
}

// ---------- Тон тренера ----------
const TONES = {
  kind: 'You are a warm, gentle and encouraging coach. Praise every small win, suggest improvements softly.',
  fun: 'You are a coach with a great sense of humour. Joke and tease playfully (never mean), but keep the advice useful and concrete.',
  strict: 'You are a strict drill sergeant. Short, demanding, military style, lots of energy. Never insulting, never humiliating, never about body shame — strict about habits, not about the person.',
};

const SAFETY = `Safety rules (always follow):
- You are not a doctor. For symptoms, pain, medication, pregnancy, chronic illness or signs of an eating disorder, kindly recommend seeing a doctor.
- Never recommend eating below 1200 kcal/day for women or 1500 kcal/day for men, extreme fasting, or losing more than ~1 kg (2 lb) per week.
- Base your words on the data you are given; do not invent numbers.`;

// ---------- /photo ----------
const PHOTO_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['is_food', 'name', 'kcal', 'items', 'confidence', 'comment'],
  properties: {
    is_food: { type: 'boolean' },
    name: { type: 'string' },
    kcal: { type: 'integer' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'grams', 'kcal'],
        properties: { name: { type: 'string' }, grams: { type: 'integer' }, kcal: { type: 'integer' } },
      },
    },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    comment: { type: 'string' },
  },
};

async function photo(env, body) {
  const lang = langOf(body.lang);
  const type = ['image/jpeg', 'image/png', 'image/webp'].includes(body.mediaType) ? body.mediaType : 'image/jpeg';
  const image = String(body.image || '').replace(/^data:[^,]+,/, '');
  if (!image || image.length > 2_800_000 || !/^[A-Za-z0-9+/=]+$/.test(image)) throw new UserError('bad_image');
  const note = str(body.note, 200);
  const system = `You estimate calories from food photos for a family health app used in the USA.
Look at the photo, recognise every dish and drink, estimate the portion weight in grams and the calories of the whole visible portion (for one person, unless the user's note says otherwise).
Count hidden calories realistically (oil, butter, sauces, sugar in drinks). If unsure, pick the most likely option and say so briefly in "comment".
If the photo shows no food or drink, set is_food=false, kcal=0 and items=[].
Write "name", item names and "comment" in ${LANG_NAME[lang]}. "name" is a short title for the whole meal. "comment" is one short sentence.`;
  const content = [
    { type: 'image', source: { type: 'base64', media_type: type, data: image } },
    { type: 'text', text: note ? `User's note: ${note}` : 'Estimate the calories of this meal.' },
  ];
  const out = await askClaude(env, { system, messages: [{ role: 'user', content }], effort: 'medium', maxTokens: 16000, schema: PHOTO_SCHEMA });
  out.kcal = int(out.kcal, 0, 10000, 0);
  return out;
}

// ---------- /menu ----------
const MENU_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['recipes', 'days', 'note'],
  properties: {
    recipes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'emoji', 'name', 'meals', 'time', 'kcal', 'ings', 'steps'],
        properties: {
          id: { type: 'string' },
          emoji: { type: 'string' },
          name: { type: 'string' },
          meals: { type: 'array', items: { type: 'string', enum: MEALS } },
          time: { type: 'integer' },
          kcal: { type: 'integer' },
          ings: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['name', 'q', 'u', 'sec'],
              properties: {
                name: { type: 'string' },
                q: { type: 'number' },
                u: { type: 'string', enum: UNITS },
                sec: { type: 'string', enum: SECTIONS },
              },
            },
          },
          steps: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    days: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: MEALS,
        properties: Object.fromEntries(MEALS.map(m => [m, { type: 'string' }])),
      },
    },
    note: { type: 'string' },
  },
};

async function menu(env, body) {
  const lang = langOf(body.lang);
  const p = body.profile || {};
  const meals = MEALS.filter(m => (body.meals || []).includes(m));
  if (!meals.length) throw new UserError('bad_request');
  const kcal = int(body.kcalGoal, 1200, 6000, 2000);
  const servings = int(body.servings, 1, 12, 2);
  const person = {
    sex: p.sex === 'f' ? 'female' : 'male',
    age: int(p.age, 10, 110, 35),
    goal: ['lose', 'keep', 'gain'].includes(p.goal) ? p.goal : 'keep',
    allergies: str(p.allergies, 200) || 'none',
    avoid: str(p.dislikes, 200) || 'none',
    diet: str(p.diet, 200) || 'none',
  };
  const system = `You plan weekly home menus for a Russian-speaking family living in the USA.
Rules:
- About two thirds of the dishes are Russian / Eastern European home cooking (borscht, buckwheat, syrniki, cutlets, etc.), the rest from other cuisines. Everyday, simple, tasty food.
- Ingredients must be easy to buy in a regular US supermarket.
- NEVER use ingredients from the allergies, "avoid" list or that break the diet — this is critical for health.
- 8 to 14 different recipes for the week. Cooking once for two days is fine (e.g. a soup for two lunches) — reuse the recipe id.
- Calories per ONE serving. The sum of the chosen meals per day should be close to the daily goal (within ±10%).
- Ingredient quantities are for ONE serving. Units: g, ml, pcs, tbsp, tsp, clove, or taste (q=0) for salt/pepper/spices. "sec" is the supermarket section (spice for salt, pepper, dried herbs, oil and vinegar go to "other").
- "time" is cooking time in minutes. "steps": 3–7 short clear steps.
- Recipe ids: "r1", "r2", ... "days" has exactly 7 items (day 1 = today). For each requested meal put a recipe id; for meals that are not requested put "".
- A recipe's "meals" lists which meals it fits.
- "note": one or two short friendly sentences about the week's menu.
- All names, steps and the note in ${LANG_NAME[lang]}.`;
  const user = `Daily calorie goal: ${kcal} kcal per person.
Meals to plan: ${meals.join(', ')}.
Cooking for ${servings} people.
Person: ${JSON.stringify(person)}.
Wishes: ${str(body.wishes, 400) || 'none'}.`;
  const out = await askClaude(env, { system, messages: [{ role: 'user', content: user }], effort: 'medium', maxTokens: 64000, schema: MENU_SCHEMA });
  // Проверяем, что ссылки на рецепты существуют, и что дней ровно 7
  const ids = new Set(out.recipes.map(r => r.id));
  const days = (out.days || []).slice(0, 7).map(d => Object.fromEntries(meals.map(m => [m, ids.has(d[m]) ? d[m] : ''])));
  if (days.length < 7 || !out.recipes.length) throw new UserError('bad_answer', 502);
  return { recipes: out.recipes, days, note: str(out.note, 500) };
}

// ---------- /coach ----------
async function coach(env, body) {
  const lang = langOf(body.lang);
  const tone = TONES[body.tone] ? body.tone : 'fun';
  const review = body.mode === 'review';
  const question = str(body.question, 1000);
  if (!review && !question) throw new UserError('bad_request');
  const stats = JSON.stringify(body.stats || {}).slice(0, 20000);
  const system = [
    {
      type: 'text',
      text: `You are the personal AI coach inside "Zdarovenkiy", a family healthy-lifestyle app.
${TONES[tone]}
${SAFETY}
Format: plain text, no markdown headings, no tables, no ** bold **. Short paragraphs or lines starting with an emoji. Answers up to ~120 words, weekly reviews up to ~180 words.
Always reply in ${LANG_NAME[lang]}. Address the user by name.`,
    },
    { type: 'text', text: `The user's data for the last 7 days (JSON, from the app):\n${stats}` },
  ];
  // История переписки: только последние сообщения, первым должен быть пользователь
  const history = (Array.isArray(body.history) ? body.history : []).slice(-10)
    .map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: str(m.text, 2000) }))
    .filter(m => m.content);
  while (history.length && history[0].role !== 'user') history.shift();
  const ask = review
    ? (lang === 'ru'
      ? 'Сделай разбор моей недели: что получилось хорошо, что хуже, и 2–3 конкретных задания на следующую неделю.'
      : 'Review my week: what went well, what did not, and 2–3 concrete tasks for next week.')
    : question;
  const messages = [...history, { role: 'user', content: ask }];
  const text = await askClaude(env, { system, messages, effort: 'low', maxTokens: 16000 });
  return { text };
}

// ---------- Маршруты ----------
const ROUTES = { '/ping': async () => ({ ok: true }), '/photo': photo, '/menu': menu, '/coach': coach };

// Ошибка → короткий код для сайта
function errorBody(e) {
  if (e instanceof UserError) return { error: e.code };
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return { error: 'bad_key' };
  if (e instanceof Anthropic.RateLimitError) return { error: 'busy' };
  if (e instanceof Anthropic.BadRequestError) return { error: 'bad_request', detail: e.message };
  if (e instanceof Anthropic.APIError) return { error: 'busy', detail: e.message };
  return { error: 'server' };
}

// Ответ «по кусочкам»: пока Claude думает (меню — до нескольких минут), каждые 10 секунд
// отправляем пробел, чтобы соединение не оборвалось. Пробелы перед JSON не мешают его прочитать.
// Код ответа здесь всегда 200, а ошибка приходит внутри: {"error": "..."}.
function streamed(ctx, work) {
  const { readable, writable } = new TransformStream();
  const w = writable.getWriter();
  const enc = new TextEncoder();
  const beat = setInterval(() => { w.write(enc.encode(' ')).catch(() => {}); }, 10_000);
  const done = (async () => {
    let out;
    try {
      out = await work();
    } catch (e) {
      out = errorBody(e);
      if (out.error === 'server' || out.detail) console.error(e);
    }
    clearInterval(beat);
    try {
      await w.write(enc.encode(JSON.stringify(out)));
      await w.close();
    } catch { /* телефон уже закрыл соединение */ }
  })();
  ctx.waitUntil(done);
  return new Response(readable, { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...CORS } });
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
    if (request.method === 'GET' && path === '/') return json({ app: 'zdorovenkiy-ai', ok: true });
    const handler = ROUTES[path];
    if (!handler || request.method !== 'POST') return json({ error: 'not_found' }, 404);
    if (!env.FAMILY_CODE) return json({ error: 'no_code_set' }, 500);
    if (!sameCode(request.headers.get('X-Family-Code'), env.FAMILY_CODE)) return json({ error: 'bad_code' }, 401);
    let body;
    try {
      const raw = await request.text();
      if (raw.length > MAX_BODY) return json({ error: 'too_big' }, 413);
      body = JSON.parse(raw || '{}');
    } catch {
      return json({ error: 'bad_request' }, 400);
    }
    return streamed(ctx, () => handler(env, body));
  },
};
