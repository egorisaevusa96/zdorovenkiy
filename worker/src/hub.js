// «Центр» семьи (Durable Object): телефоны, их напоминания и счётчик «анти-YouTube».
// Хранит по одной записи на телефон: dev:<id>. По секретному токену телефона — tok:<token> → id.
import { DurableObject } from 'cloudflare:workers';
import { sendPush, vapidFromEnv } from './push.js';

const MAX_DEVICES = 20;
const DEF_TZ = 'America/New_York';
const DAY_MS = 864e5;

// Защита кошелька: сколько запросов к ИИ можно за сутки на всю семью (меняется в wrangler.toml: LIMIT_MENU и т. д.)
const DEF_LIMITS = { menu: 20, photo: 150, coach: 150, hook: 40 };
// Защита от подбора семейного пароля: столько неверных попыток с одного адреса — и пауза
const MAX_FAILS = 10;
const FAIL_WINDOW_MS = 15 * 60_000;

const s = (v, max) => String(v ?? '').trim().slice(0, max);
const clampInt = (v, lo, hi, def) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def; };
const randHex = n => [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, '0')).join('');

function goodTz(tz) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; } catch { return DEF_TZ; }
}

// Местные дата, минуты с полуночи и день недели (0 = воскресенье) в часовом поясе телефона
export function localNow(tz, now = Date.now()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: goodTz(tz), year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23',
  }).formatToParts(new Date(now)).map(p => [p.type, p.value]));
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  return { date: `${parts.year}-${parts.month}-${parts.day}`, min: Number(parts.hour) * 60 + Number(parts.minute), wd };
}

const hmToMin = hm => { const m = /^(\d{1,2}):(\d{2})$/.exec(hm || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : -1; };
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

function cleanReminders(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 40).map(r => ({
    id: s(r.id, 40),
    at: hmToMin(r.at) >= 0 ? s(r.at, 5) : '',
    days: Array.isArray(r.days) ? r.days.map(Number).filter(d => d >= 0 && d <= 6) : null,
    title: s(r.title, 80),
    body: s(r.body, 240),
    cond: s(r.cond, 20),
    url: s(r.url, 60),
  })).filter(r => r.id && r.at && r.title);
}

function cleanStatus(st) {
  if (!st || typeof st !== 'object') return null;
  const meals = {};
  for (const m of ['breakfast', 'lunch', 'dinner', 'snack']) meals[m] = !!st.meals?.[m];
  return {
    date: s(st.date, 10), water_ok: !!st.water_ok, sport: !!st.sport, meals,
    weighed_at: s(st.weighed_at, 10), backup_at: s(st.backup_at, 10),
  };
}

function cleanSub(sub) {
  if (!sub) return null;
  const endpoint = s(sub.endpoint, 1000);
  if (!/^https:\/\//.test(endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) return null;
  return { endpoint, keys: { p256dh: s(sub.keys.p256dh, 200), auth: s(sub.keys.auth, 100) } };
}

// Нужно ли напоминание сейчас — с учётом того, что человек уже записал за сегодня
function condOk(cond, st, date) {
  const today = st?.date === date ? st : {};
  if (cond === 'water') return !today.water_ok;
  if (cond?.startsWith('meal:')) return !today.meals?.[cond.slice(5)];
  if (cond === 'sport') return !today.sport;
  if (cond === 'weight') return !(st?.weighed_at && daysBetween(st.weighed_at, date) < 3);
  if (cond === 'backup') return !(st?.backup_at && daysBetween(st.backup_at, date) < 7);
  return true;
}

// Пометить «уже отправлено сегодня» всё, чьё время уже прошло (чтобы не прилетело разом после сохранения)
function markPassed(dev) {
  const now = localNow(dev.tz);
  dev.sent = {};
  for (const r of dev.reminders) if (hmToMin(r.at) <= now.min) dev.sent[r.id] = now.date;
}

export class Hub extends DurableObject {
  #fails = new Map(); // адрес → { n, first }: неверные пароли за последние 15 минут (только в памяти)

  // Проверка перед каждым запросом. false — с этого адреса слишком много неверных паролей, ждите.
  // Пока пауза не кончилась, не пускаем даже с верным паролем — иначе подбор можно было бы продолжать.
  gate(ip, good) {
    const key = s(ip, 60) || '?', now = Date.now();
    let f = this.#fails.get(key);
    if (f && now - f.first > FAIL_WINDOW_MS) { this.#fails.delete(key); f = null; }
    if (f && f.n >= MAX_FAILS) return false;
    if (good) return true;
    if (this.#fails.size > 5000) this.#fails.clear();
    this.#fails.set(key, { n: (f?.n || 0) + 1, first: f?.first || now });
    return true;
  }

  // Счётчик запросов к ИИ за сутки. true — можно, false — дневной лимит исчерпан.
  async spend(kind) {
    if (!(kind in DEF_LIMITS)) return true;
    const raw = this.env['LIMIT_' + kind.toUpperCase()];
    const lim = raw === undefined || raw === '' ? DEF_LIMITS[kind] : clampInt(raw, 0, 100000, DEF_LIMITS[kind]);
    const day = localNow(DEF_TZ).date;
    let u = await this.ctx.storage.get('ai-usage');
    if (!u || u.day !== day) u = { day, n: {} };
    if ((u.n[kind] || 0) >= lim) return false;
    u.n[kind] = (u.n[kind] || 0) + 1;
    await this.ctx.storage.put('ai-usage', u);
    return true;
  }

  async #get(id) { return id ? this.ctx.storage.get('dev:' + id) : null; }
  async #put(dev) { await this.ctx.storage.put('dev:' + dev.id, dev); }
  async #auth(id, token) {
    const dev = await this.#get(s(id, 40));
    if (!dev || !token || dev.token !== token) throw new Error('bad_device');
    return dev;
  }

  // Новый телефон (или повторная регистрация того же)
  async register(info) {
    let dev = await this.#get(s(info.id, 40));
    // Номер телефона без его секретного токена — токен не отдаём, заводим новый телефон
    if (dev && (!info.token || dev.token !== s(info.token, 64))) dev = null;
    if (!dev) {
      const all = await this.ctx.storage.list({ prefix: 'dev:' });
      if (all.size >= MAX_DEVICES) {
        // Места нет — убираем самый давно молчащий телефон: без напоминаний и неделю не выходил на связь
        // (так выглядят старые записи после переустановки), либо молчит больше двух месяцев.
        const now = Date.now(), last = d => d.seen || d.created || 0;
        const old = [...all.values()]
          .filter(d => now - last(d) > (d.sub ? 60 : 7) * DAY_MS)
          .sort((a, b) => last(a) - last(b))[0];
        if (!old) throw new Error('too_many');
        await this.ctx.storage.delete(['dev:' + old.id, 'tok:' + old.token]);
      }
      dev = { id: randHex(8), token: randHex(16), created: Date.now(), reminders: [], sent: {}, usage: {}, sub: null, status: null, limit: 60, openAt: null };
      await this.ctx.storage.put('tok:' + dev.token, dev.id);
    }
    if (info.name !== undefined || dev.name === undefined) dev.name = s(info.name, 40);
    if (info.tz || !dev.tz) dev.tz = goodTz(s(info.tz, 60));
    if (info.lang || !dev.lang) dev.lang = info.lang === 'en' ? 'en' : 'ru';
    if (['kind', 'fun', 'strict'].includes(info.tone)) dev.tone = info.tone;
    else if (!dev.tone) dev.tone = 'fun';
    dev.seen = Date.now();
    await this.#put(dev);
    return { id: dev.id, token: dev.token };
  }

  async update(id, token, p) {
    const dev = await this.#auth(id, token);
    if (p.name !== undefined) dev.name = s(p.name, 40);
    if (p.tz) dev.tz = goodTz(s(p.tz, 60));
    if (p.lang) dev.lang = p.lang === 'en' ? 'en' : 'ru';
    if (p.tone && ['kind', 'fun', 'strict'].includes(p.tone)) dev.tone = p.tone;
    if (p.limit !== undefined) dev.limit = clampInt(p.limit, 5, 600, 60);
    if (p.status !== undefined) dev.status = cleanStatus(p.status);
    if (p.sub !== undefined) dev.sub = cleanSub(p.sub);
    if (p.reminders !== undefined) { dev.reminders = cleanReminders(p.reminders); markPassed(dev); }
    dev.seen = Date.now();
    await this.#put(dev);
    return { ok: true, push: !!dev.sub, reminders: dev.reminders.length };
  }

  async testPush(id, token, message) {
    const dev = await this.#auth(id, token);
    if (!dev.sub) return { ok: false, error: 'no_sub' };
    const vapid = vapidFromEnv(this.env);
    if (!vapid) return { ok: false, error: 'no_vapid' };
    const code = await sendPush(dev.sub, { title: s(message?.title, 80), body: s(message?.body, 240), url: './' }, vapid);
    if (code === 404 || code === 410) { dev.sub = null; await this.#put(dev); }
    return { ok: code >= 200 && code < 300, code };
  }

  // Статистика «анти-YouTube» за 7 дней
  async stats(id, token) {
    const dev = await this.#auth(id, token);
    const now = localNow(dev.tz);
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.parse(now.date) - i * 864e5).toISOString().slice(0, 10);
      const u = dev.usage[d] || { opens: 0, min: 0 };
      days.push({ date: d, opens: u.opens, min: Math.round(u.min) });
    }
    return { limit: dev.limit, days, today: now.date, inApp: !!dev.openAt && Date.now() - dev.openAt < 4 * 3600e3 };
  }

  // Событие из «Команд»: приложение открыто/закрыто. Ключ — токен телефона в ссылке.
  async hook(token, event) {
    const id = await this.ctx.storage.get('tok:' + s(token, 64));
    const dev = id && await this.#get(id);
    if (!dev) return null;
    const now = Date.now();
    const { date } = localNow(dev.tz, now);
    const u = dev.usage[date] || (dev.usage[date] = { opens: 0, min: 0 });
    if (event === 'close') {
      if (dev.openAt && now - dev.openAt < 4 * 3600e3) u.min += (now - dev.openAt) / 60000;
      dev.openAt = null;
    } else {
      // Прошлый заход не закрылся (например, телефон заблокировали) — считаем его коротким
      if (dev.openAt && now - dev.openAt < 4 * 3600e3) u.min += Math.min(10, (now - dev.openAt) / 60000);
      u.opens += 1;
      dev.openAt = now;
    }
    // Храним только 14 дней
    const keep = Object.keys(dev.usage).sort().slice(-14);
    dev.usage = Object.fromEntries(keep.map(k => [k, dev.usage[k]]));
    dev.seen = now;
    await this.#put(dev);
    // ИИ придумывает «ругань» только для первых 20 заходов телефона за день и пока не исчерпан общий дневной лимит —
    // дальше идут готовые фразы (ссылка для «Команд» может срабатывать очень часто)
    const ai = event !== 'close' && u.opens <= 20 && await this.spend('hook');
    return { lang: dev.lang, tone: dev.tone, name: dev.name, opens: u.opens, min: Math.round(u.min), limit: dev.limit, ai };
  }

  // Раз в минуту (по расписанию Cloudflare): разослать напоминания, у которых подошло время
  async tick() {
    const vapid = vapidFromEnv(this.env);
    if (!vapid) return { sent: 0 };
    const all = await this.ctx.storage.list({ prefix: 'dev:' });
    let sent = 0, tried = 0, failed = 0;
    for (const dev of all.values()) {
      if (!dev.sub || !dev.reminders?.length) continue;
      const now = localNow(dev.tz);
      let changed = false;
      for (const r of dev.reminders) {
        const at = hmToMin(r.at);
        if (r.days && !r.days.includes(now.wd)) continue;
        if (at < 0 || now.min < at || now.min - at > 60 || dev.sent?.[r.id] === now.date) continue;
        dev.sent = dev.sent || {};
        dev.sent[r.id] = now.date;
        changed = true;
        if (!condOk(r.cond, dev.status, now.date)) continue;
        tried++;
        try {
          const code = await sendPush(dev.sub, { title: r.title, body: r.body, url: r.url || './' }, vapid);
          if (code === 404 || code === 410) { dev.sub = null; break; }
          if (code >= 200 && code < 300) sent++;
          else { failed++; console.error('push', code, dev.id); }
        } catch (e) {
          failed++;
          console.error('push fail', dev.id, String(e?.message || e));
        }
      }
      if (changed) await this.#put(dev);
    }
    return { sent, tried, failed, devices: all.size };
  }
}
