// Здаровенький — главный файл: экраны и кнопки.
import { data, save, replaceData, wipeData, todayKey, addDays, keyToDate, getDay, peekDay, uid } from './store.js';
import { t, lang, nm, locale } from './i18n.js';
import * as U from './units.js';
import * as H from './health.js';
import * as P from './progress.js';
import { SPORT_TYPES, WORKOUTS, FOOD_PRESETS, TIPS } from './content.js';
import { ING } from './recipes.js';
import * as PL from './planner.js';
import * as AI from './ai.js';

const $ = sel => document.querySelector(sel);
const view = $('#view');
const ui = { date: todayKey() };

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => parseFloat(String(v ?? '').replace(',', '.'));

const MEALS = ['breakfast', 'lunch', 'dinner', 'snack'];
const MEAL_EMOJI = { breakfast: '🍳', lunch: '🍲', dinner: '🍽️', snack: '🍎' };
const MOODS = ['😫', '😕', '😐', '🙂', '😀'];

// ---------- Мелкие помощники для разметки ----------
function card(title, body, cls = '', action = '') {
  return `<section class="card ${cls}"><div class="card-h"><h2>${title}</h2>${action}</div>${body}</section>`;
}
function bar(frac, cls = '') {
  const p = Math.max(0, Math.min(100, Math.round((frac || 0) * 100)));
  return `<div class="bar ${cls}"><i style="width:${p}%"></i></div>`;
}
function radio(name, value, label, checked, required = false) {
  return `<label class="chip"><input type="radio" name="${name}" value="${value}" ${checked ? 'checked' : ''} ${required ? 'required' : ''}><span>${label}</span></label>`;
}
function scale(name, val, labels) {
  return `<div class="scale">${labels.map((l, i) => `<label><input type="radio" name="${name}" value="${i + 1}" ${val === i + 1 ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>`;
}
function fmtDate(key, opts = { weekday: 'short', day: 'numeric', month: 'short' }) {
  return keyToDate(key).toLocaleDateString(locale(), opts);
}
function dayLabel(key) {
  const tk = todayKey();
  if (key === tk) return t('today');
  if (key === addDays(tk, -1)) return t('yesterday');
  return fmtDate(key);
}
const fmtDur = m => `${Math.floor(m / 60)} ${t('u_h')} ${m % 60} ${t('u_min')}`;
const isStandalone = () => window.navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
function mealByTime() {
  const h = new Date().getHours();
  return h < 11 ? 'breakfast' : h < 16 ? 'lunch' : h < 21 ? 'dinner' : 'snack';
}
const AIE = ['not_set', 'offline', 'timeout', 'network', 'bad_code', 'no_key', 'no_code_set', 'bad_key', 'busy', 'refusal', 'too_long', 'bad_answer', 'bad_image', 'too_big', 'not_found', 'bad_request', 'server'];
const aiErr = e => t('aie_' + (AIE.includes(e?.code) ? e.code : 'server'));
function needAi() {
  if (AI.aiReady()) return false;
  toast(t('ai_need_setup'));
  location.hash = '#/settings';
  return true;
}
const portion = f =>(f.g ? U.fmtMass(f.g) : f.ml ? U.fmtVolume(f.ml) : t('pcs', { n: f.pcs }));
const workoutSec = w => w.rounds * w.exercises.reduce((s, e) => s + e.sec, 0) + w.rest * (w.rounds * w.exercises.length - 1);

// ---------- Всплывающие сообщения и нижняя панель ----------
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 2600);
}
function openSheet(html) {
  $('#sheet .sheet-body').innerHTML = html;
  $('#sheet').hidden = false;
  document.body.classList.add('noscroll');
}
function closeSheet() {
  $('#sheet').hidden = true;
  $('#sheet .sheet-body').innerHTML = '';
  document.body.classList.remove('noscroll');
}

// Сохранить + проверить награды + перерисовать
function commit() {
  save();
  const fresh = P.checkBadges();
  if (fresh.length) save();
  render();
  fresh.forEach((b, i) => setTimeout(() => toast(`${b.emoji} ${t('new_badge')}: ${nm(b.name)}`), 700 + i * 2800));
}

// ---------- Графики ----------
function barChart(vals, labels, max, goal, fmt) {
  const W = 300, Hh = 110, pad = 20, bw = W / vals.length;
  let s = `<svg viewBox="0 -14 ${W} ${Hh + pad + 14}" class="chart" aria-hidden="true">`;
  if (goal && max) {
    const y = Hh - (goal / max) * Hh;
    s += `<line x1="0" x2="${W}" y1="${y}" y2="${y}" class="goal"/>`;
  }
  vals.forEach((v, i) => {
    const h = max ? Math.min(Hh, (v / max) * Hh) : 0;
    const x = i * bw + bw * 0.2, cx = x + bw * 0.3;
    s += `<rect x="${x}" y="${Hh - h}" width="${bw * 0.6}" height="${Math.max(h, 0)}" rx="4" class="b"/>`;
    if (v) s += `<text x="${cx}" y="${Hh - h - 4}" class="v">${fmt(v)}</text>`;
    s += `<text x="${cx}" y="${Hh + 15}" class="l">${esc(labels[i])}</text>`;
  });
  return s + '</svg>';
}

function lineChart(points) {
  const W = 300, Hh = 120, padX = 6;
  const ys = points.map(p => U.kgToShow(p.kg));
  let min = Math.min(...ys), max = Math.max(...ys);
  if (max - min < 1) { min -= 0.5; max += 0.5; }
  const X = i => padX + (i / (points.length - 1)) * (W - padX * 2);
  const Y = v => 8 + (1 - (v - min) / (max - min)) * (Hh - 16);
  const pts = ys.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
  let s = `<svg viewBox="0 0 ${W} ${Hh + 18}" class="chart" aria-hidden="true">`;
  s += `<polyline points="${pts}" class="ln"/>`;
  ys.forEach((v, i) => { s += `<circle cx="${X(i)}" cy="${Y(v)}" r="3" class="dot"/>`; });
  s += `<text x="${padX}" y="${Hh + 14}" class="l" text-anchor="start">${esc(fmtDate(points[0].date, { day: 'numeric', month: 'short' }))}</text>`;
  s += `<text x="${W - padX}" y="${Hh + 14}" class="l" text-anchor="end">${esc(fmtDate(points[points.length - 1].date, { day: 'numeric', month: 'short' }))}</text>`;
  s += `<text x="${W - padX}" y="12" class="v" text-anchor="end">${Math.max(...ys)}</text>`;
  s += `<text x="${W - padX}" y="${Hh - 2}" class="v" text-anchor="end">${Math.min(...ys)}</text>`;
  return s + '</svg>';
}

// ================= ЭКРАНЫ =================

// ----- Сегодня -----
function installHint() {
  if (data.settings.installHintHidden || isStandalone()) return '';
  return card('📲 ' + t('install_title'), `<p>${t('install_hint')}</p>
    <div class="row"><a class="btn primary grow" href="#/install">${t('how_install')}</a>
    <button class="btn ghost" data-act="hide-install">${t('hide')}</button></div>`, 'hint');
}
function backupHint() {
  const last = new Date(data.lastBackup || data.createdAt);
  const days = (Date.now() - last) / 864e5;
  if (days < 7 || !Object.keys(data.days).length) return '';
  return card('💾 ' + t('backup_title'), `<p>${t('backup_remind')}</p><a class="btn primary full" href="#/backup">${t('make_backup')}</a>`, 'warn');
}
function waterCard(d) {
  const g = data.settings.waterGoal, n = d.water;
  const cups = Array.from({ length: Math.max(g, n) }, (_, i) => `<span class="cup ${i < n ? 'full' : ''}"></span>`).join('');
  return card('💧 ' + t('water_title'), `
    <div class="big">${n}<small> / ${g} ${t('glasses')}</small></div>
    <div class="muted">${U.fmtWaterTotal(n)} · ${t('glass_is', { v: U.glassLabel() })}</div>
    <div class="cups">${cups}</div>
    <div class="row">
      <button class="btn ghost" data-act="water" data-n="-1" ${n <= 0 ? 'disabled' : ''} aria-label="−1">−1</button>
      <button class="btn primary grow" data-act="water" data-n="1">+1 ${t('glass')}</button>
    </div>
    ${n >= g ? `<div class="ok">${t('water_done')} 🔥 ${P.waterStreak()}</div>` : ''}`);
}
function kcalCard(d) {
  const eaten = H.dayEaten(d), burned = H.dayBurned(d), goal = H.kcalGoal(), left = goal - eaten + burned;
  return card('🍽️ ' + t('kcal_title'), `
    <div class="kcal3">
      <div><b>${eaten}</b><small>${t('eaten')}</small></div>
      <div><b>${burned}</b><small>${t('burned')}</small></div>
      <div><b class="${left < 0 ? 'bad' : ''}">${Math.abs(left)}</b><small>${left < 0 ? t('over') : t('left')}</small></div>
    </div>
    ${bar(eaten / (goal + burned), eaten > goal + burned ? 'bad' : '')}
    <div class="muted">${t('kcal_goal_is', { n: goal })}</div>
    <a class="btn ghost full" href="#/food">+ ${t('add_food')}</a>`);
}
function stepsCard(d) {
  const g = data.settings.stepsGoal;
  return card('👣 ' + t('steps_title'), `
    <form data-form="steps" class="row">
      <input type="number" inputmode="numeric" name="steps" min="0" max="200000" value="${d.steps || ''}" placeholder="0" aria-label="${t('steps_title')}">
      <button class="btn primary">${t('save')}</button>
    </form>
    ${bar(d.steps / g)}
    <div class="muted">${t('steps_goal', { n: g.toLocaleString(locale()) })} · ${t('steps_hint')}</div>`);
}
function habitsCard(d) {
  const hs = data.habits.filter(h => h.active);
  const body = hs.length
    ? hs.map(h => {
      const on = !!d.habits[h.id], st = P.habitStreak(h.id);
      return `<button class="habit ${on ? 'on' : ''}" data-act="habit" data-id="${h.id}" aria-pressed="${on}">
        <span class="chk">${on ? '✓' : ''}</span><span class="em">${esc(h.emoji)}</span>
        <span class="nm">${esc(nm(h.name))}</span>${st ? `<span class="st">🔥${st}</span>` : ''}</button>`;
    }).join('')
    : `<div class="muted">${t('no_habits')}</div>`;
  return card('✅ ' + t('habits_title'), body + `<a class="link" href="#/habits">${t('edit_habits')} ›</a>`);
}
function sleepMini(d) {
  let body = d.sleep
    ? `<div>${t('slept')} <b>${fmtDur(H.sleepMinutes(d.sleep.bed, d.sleep.wake))}</b> ${MOODS[d.sleep.quality - 1] || ''}</div>`
    : `<div class="muted">${t('sleep_not_logged')}</div>`;
  if (d.diary?.mood) body += `<div>${t('mood')}: ${MOODS[d.diary.mood - 1]}</div>`;
  body += `<a class="btn ghost full" href="#/sleep">${d.sleep ? t('open_diary') : t('log_sleep')}</a>`;
  return card('🌙 ' + t('sleep_title'), body);
}
function tipCard() {
  const d = new Date();
  const doy = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 864e5);
  return card('💡 ' + t('tip_title'), `<p>${esc(nm(TIPS[doy % TIPS.length]))}</p>`, 'tip');
}
function vToday() {
  const d = peekDay(ui.date);
  const isToday = ui.date === todayKey();
  let html = '';
  if (isToday) {
    const lv = P.level();
    html += `<section class="hello">
      <div><div class="hi">${t('hello', { name: esc(data.profile.name) })}</div>
      <div class="muted">${esc(fmtDate(ui.date, { weekday: 'long', day: 'numeric', month: 'long' }))}</div></div>
      <a class="lvl" href="#/awards">⭐ ${lv.level}<small>${t('level_short')}</small></a></section>`;
    html += installHint() + backupHint();
  }
  html += waterCard(d) + kcalCard(d) + menuTodayCard() + habitsCard(d) + stepsCard(d) + sleepMini(d);
  if (isToday) html += coachCard() + tipCard();
  return html;
}

// ----- Еда -----
function vFood() {
  const d = peekDay(ui.date);
  const eaten = H.dayEaten(d), burned = H.dayBurned(d), total = H.kcalGoal() + burned;
  let html = foodTabs('food') + card('🍽️ ' + t('kcal_title'), `
    <div class="big">${eaten}<small> / ${total} ${t('kcal')}</small></div>
    ${bar(eaten / total, eaten > total ? 'bad' : '')}
    ${burned ? `<div class="muted">${t('incl_sport', { n: burned })}</div>` : ''}`);
  html += `<div class="row"><button class="btn primary grow" data-act="food-add">+ ${t('add_food')}</button>
    <button class="btn ghost" data-act="photo">📷 ${t('photo')}</button></div>
    <input type="file" id="photo-file" accept="image/*" hidden>`;
  for (const m of MEALS) {
    const items = d.food.filter(f => f.meal === m);
    const sum = items.reduce((s, f) => s + (Number(f.kcal) || 0), 0);
    const body = items.length
      ? `<ul class="list">${items.map(f => `<li><span class="grow">${esc(f.name)}</span><b>${f.kcal}</b>
          <button class="x" data-act="food-del" data-id="${f.id}" aria-label="${t('delete')}">×</button></li>`).join('')}</ul>`
      : `<div class="muted">${t('empty')}</div>`;
    html += card(`${MEAL_EMOJI[m]} ${t('meal_' + m)} ${sum ? `<span class="muted">· ${sum} ${t('kcal')}</span>` : ''}`, body, '',
      `<button class="mini" data-act="food-add" data-meal="${m}" aria-label="${t('add_food')}">+</button>`);
  }
  return html;
}
function foodSheet(meal) {
  meal = meal || mealByTime();
  return `<form data-form="food">
    <h2>${t('add_food')}</h2>
    <div class="chips">${MEALS.map(m => radio('meal', m, `${MEAL_EMOJI[m]} ${t('meal_' + m)}`, m === meal)).join('')}</div>
    <label class="fld"><span>${t('food_name')}</span><input name="name" required maxlength="80" placeholder="${t('food_name_ph')}"></label>
    <label class="fld"><span>${t('kcal')}</span><input name="kcal" type="number" inputmode="numeric" min="0" max="5000" required></label>
    <div class="row"><button type="button" class="btn ghost" data-act="sheet-close">${t('cancel')}</button>
      <button class="btn primary grow">${t('save')}</button></div>
    <h3>${t('quick_pick')}</h3>
    <div class="presets">${FOOD_PRESETS.map((f, i) => `<button type="button" class="preset" data-act="food-preset" data-i="${i}">
      <span>${esc(nm(f.name))}</span><small>${portion(f)} · ${f.kcal} ${t('kcal')}</small></button>`).join('')}</div>
  </form>`;
}

// ----- Еда: калории по фото (ИИ) -----
let photoReq = 0;
async function photoPicked(file) {
  if (!file) return;
  let img;
  try { img = await AI.shrinkImage(file); } catch { toast(t('aie_bad_image')); return; }
  ui.photo = { dataUrl: img.dataUrl, base64: img.base64, note: '', meal: mealByTime() };
  runPhoto();
}
async function runPhoto() {
  const req = ++photoReq;
  openSheet(photoSheet('wait'));
  try {
    const res = await AI.aiCall('photo', { image: ui.photo.base64, mediaType: 'image/jpeg', note: ui.photo.note });
    if (req !== photoReq || $('#sheet').hidden) return;
    ui.photo.res = res;
    openSheet(photoSheet('done'));
  } catch (e) {
    if (req !== photoReq || $('#sheet').hidden) return;
    openSheet(photoSheet('error', aiErr(e)));
  }
}
function photoSheet(state, err) {
  const ph = ui.photo;
  const head = `<h2>📷 ${t('photo_title')}</h2><img class="photo-prev" src="${ph.dataUrl}" alt="">`;
  const cancel = `<button type="button" class="btn ghost full" data-act="sheet-close">${t('cancel')}</button>`;
  if (state === 'wait') return `<div class="sheet-form">${head}<div class="ai-wait"><span class="spin"></span>${t('photo_wait')}</div>${cancel}</div>`;
  if (state === 'error') return `<div class="sheet-form">${head}<p class="bad">⚠️ ${esc(err)}</p>
    <button class="btn primary full" data-act="photo-retry">↻ ${t('retry')}</button>${cancel}</div>`;
  const r = ph.res;
  if (!r.is_food) return `<div class="sheet-form">${head}<p>${t('photo_not_food')}</p>
    <button class="btn primary full" data-act="photo">📷 ${t('photo_another')}</button>${cancel}</div>`;
  const conf = { low: '🤔', medium: '🙂', high: '😎' }[r.confidence] || '';
  return `<form data-form="food" data-ai="1" class="sheet-form">${head}
    ${r.items.length ? `<ul class="list">${r.items.map(i => `<li><span class="grow">${esc(i.name)} <small class="muted">~${U.fmtMass(i.grams)}</small></span><b>${i.kcal}</b></li>`).join('')}</ul>` : ''}
    ${r.comment ? `<div class="ai-note">${conf} ${esc(r.comment)}</div>` : ''}
    <div class="chips">${MEALS.map(m => radio('meal', m, `${MEAL_EMOJI[m]} ${t('meal_' + m)}`, m === ph.meal)).join('')}</div>
    <label class="fld"><span>${t('food_name')}</span><input name="name" required maxlength="80" value="${esc(r.name)}"></label>
    <label class="fld"><span>${t('kcal')}</span><input name="kcal" type="number" inputmode="numeric" min="0" max="5000" required value="${r.kcal}"></label>
    <div class="muted">${t('photo_check')}</div>
    <div class="row"><button type="button" class="btn ghost" data-act="sheet-close">${t('cancel')}</button>
      <button class="btn primary grow">${t('save')}</button></div>
    <label class="fld"><span>${t('photo_note')}</span><input name="note" maxlength="200" value="${esc(ph.note)}" placeholder="${t('photo_note_ph')}"></label>
    <button type="button" class="btn ghost full" data-act="photo-redo">🤖 ${t('photo_redo')}</button>
  </form>`;
}

// ----- Еда: вкладки -----
function foodTabs(active) {
  const tabs = [['food', 'seg_diary'], ['menu', 'seg_menu'], ['recipes', 'seg_recipes'], ['shop', 'seg_shop']];
  return `<nav class="seg">${tabs.map(([r, k]) => `<a href="#/${r}" class="${r === active ? 'on' : ''}">${t(k)}</a>`).join('')}</nav>`;
}
const SEC_EMOJI = { veg: '🥕', fruit: '🍎', meat: '🥩', fish: '🐟', dairy: '🥛', eggs: '🥚', grain: '🌾', bakery: '🍞', canned: '🥫', frozen: '🧊', nuts: '🥜', other: '🛍️', spice: '🧂' };
const planDayIdx = key => (data.plan ? data.plan.days.findIndex(d => d.date === key) : -1);
const planActive = () => !!data.plan && data.plan.days[data.plan.days.length - 1].date >= todayKey();

// Строка блюда в меню
function planRow(di, m) {
  const day = data.plan.days[di];
  const r = day.items[m] && PL.recipeById(day.items[m]);
  const eaten = !!day.eaten?.[m];
  const canEat = r && day.date <= todayKey();
  return `<li class="${eaten ? 'done' : ''}"><span class="mtag" title="${t('meal_' + m)}">${MEAL_EMOJI[m]}</span>
    ${r ? `<a class="grow pl" href="#/recipe/${r.id}"><b>${r.emoji} ${esc(nm(r.name))}</b><small>${t('meal_' + m)} · ${r.kcal} ${t('kcal')} · ⏱ ${r.time} ${t('u_min')}</small></a>`
    : `<span class="grow muted">${t('meal_' + m)}: ${t('menu_empty_slot')}</span>`}
    <button class="x" data-act="plan-swap" data-d="${di}" data-m="${m}" aria-label="${t('swap')}">↻</button>
    ${canEat ? `<button class="eat ${eaten ? 'on' : ''}" data-act="plan-eat" data-d="${di}" data-m="${m}">${eaten ? '✓' : t('ate')}</button>` : ''}</li>`;
}
function menuTodayCard() {
  const di = planDayIdx(ui.date);
  if (di < 0) return '';
  return card('📅 ' + t('menu_today'), `<ul class="list plan">${data.plan.meals.map(m => planRow(di, m)).join('')}</ul>
    <a class="link" href="#/menu">${t('menu_week')} ›</a>`);
}

// ----- Меню на неделю -----
function restrictionNote() {
  const rs = PL.restrictions();
  return rs.tags.size || rs.words.length
    ? `<div class="muted">⚠️ ${t('menu_excl')}: ${esc([data.profile.allergies, data.profile.dislikes, data.profile.diet].filter(Boolean).join(', '))}</div>`
    : `<div class="muted">${t('menu_no_excl')} <a href="#/profile">${t('profile_title')} ›</a></div>`;
}
function menuForm() {
  const pp = data.planPrefs;
  return card('📅 ' + t('menu_title'), `<p>${t('menu_intro')}</p>${restrictionNote()}
    <form data-form="plan">
      <label class="fld"><span>${t('servings_q')}</span><input name="servings" type="number" inputmode="numeric" min="1" max="12" value="${pp.servings}" required></label>
      <div class="lbl">${t('meals_q')}</div>
      <div class="chips">${PL.MEALS.map(m => `<label class="chip"><input type="checkbox" name="meals" value="${m}" ${pp.meals.includes(m) ? 'checked' : ''}><span>${MEAL_EMOJI[m]} ${t('meal_' + m)}</span></label>`).join('')}</div>
      <button class="btn primary full big-btn">✨ ${t('menu_make')}</button>
    </form>
    <div class="lbl">${t('or')}</div>
    <button class="btn ghost full" data-act="ai-menu">🤖 ${t('menu_ai')}</button>
    <div class="muted">${t('menu_ai_hint')}</div>`);
}
// Меню от ИИ: окно с пожеланиями
function aiMenuSheet(state, err) {
  if (state === 'wait') return `<div class="sheet-form"><h2>🤖 ${t('menu_ai')}</h2>
    <div class="ai-wait"><span class="spin"></span>${t('menu_ai_wait')}</div>
    <div class="muted">${t('menu_ai_wait2')}</div>
    <button type="button" class="btn ghost full" data-act="sheet-close">${t('close')}</button></div>`;
  const pp = data.planPrefs;
  return `<form data-form="aiplan" class="sheet-form">
    <h2>🤖 ${t('menu_ai')}</h2>
    ${err ? `<p class="bad">⚠️ ${esc(err)}</p>` : `<p class="muted">${t('menu_ai_intro', { n: H.kcalGoal() })}</p>`}
    ${restrictionNote()}
    <label class="fld"><span>${t('servings_q')}</span><input name="servings" type="number" inputmode="numeric" min="1" max="12" value="${pp.servings}" required></label>
    <div class="lbl">${t('meals_q')}</div>
    <div class="chips">${PL.MEALS.map(m => `<label class="chip"><input type="checkbox" name="meals" value="${m}" ${pp.meals.includes(m) ? 'checked' : ''}><span>${MEAL_EMOJI[m]} ${t('meal_' + m)}</span></label>`).join('')}</div>
    <label class="fld"><span>${t('menu_wishes')}</span><textarea name="wishes" rows="3" maxlength="400" placeholder="${t('menu_wishes_ph')}">${esc(ui.aiWishes || '')}</textarea></label>
    ${planActive() ? `<div class="muted">⚠️ ${t('menu_ai_replace')}</div>` : ''}
    <button class="btn primary full big-btn">🤖 ${t('menu_ai_go')}</button>
    <button type="button" class="btn ghost full" data-act="sheet-close">${t('cancel')}</button>
  </form>`;
}
async function runAiMenu(servings, meals, wishes) {
  if (ui.aiMenuBusy) return;
  ui.aiMenuBusy = true;
  openSheet(aiMenuSheet('wait'));
  const p = data.profile;
  try {
    const res = await AI.aiMenu({
      profile: { sex: p.sex, age: p.age, goal: p.goal, allergies: p.allergies, dislikes: p.dislikes, diet: p.diet },
      kcalGoal: H.kcalGoal(), servings, meals, wishes,
    });
    data.plan = PL.planFromAi(res, { servings, meals });
    data.plansMade = (data.plansMade || 0) + 1;
    data.shop = { planId: data.plan.id, checked: {} };
    ui.aiWishes = '';
    closeSheet();
    commit();
    if (route().name === 'menu') window.scrollTo(0, 0);
    toast(t('menu_ai_ready'));
  } catch (e) {
    openSheet(aiMenuSheet('form', aiErr(e)));
  } finally {
    ui.aiMenuBusy = false;
  }
}
function vMenu() {
  let html = foodTabs('menu');
  if (!planActive()) return html + menuForm();
  const plan = data.plan, goal = H.kcalGoal(), tk = todayKey();
  const short = { day: 'numeric', month: 'short' };
  html += card('📅 ' + t('menu_title'), `
    <div class="muted">${plan.ai ? '🤖 ' : ''}${t('menu_range', { a: esc(fmtDate(plan.start, short)), b: esc(fmtDate(plan.days[6].date, short)), n: plan.servings })}</div>
    ${plan.ai && plan.note ? `<div class="ai-note">🤖 ${esc(plan.note)}</div>` : ''}
    <a class="btn primary full" href="#/shop">🛒 ${t('shop_open')}</a>
    <div class="row"><button class="btn ghost grow" data-act="menu-new">↻ ${t('menu_new')}</button>
      <button class="btn ghost" data-act="ai-menu">🤖 ${t('ai')}</button></div>`);
  plan.days.forEach((day, i) => {
    if (day.date < tk) return;
    const sum = plan.meals.reduce((s, m) => s + (PL.recipeById(day.items[m])?.kcal || 0), 0);
    const title = day.date === tk ? t('today') : fmtDate(day.date, { weekday: 'long', day: 'numeric', month: 'short' });
    const gap = goal - sum;
    html += card(esc(title), `<ul class="list plan">${plan.meals.map(m => planRow(i, m)).join('')}</ul>
      <div class="muted">${t('day_total', { n: sum, g: goal })}</div>
      ${gap > goal * 0.12 ? `<div class="muted">💡 ${t('day_gap', { n: Math.round(gap / 10) * 10 })}</div>` : ''}`, day.date === tk ? 'today' : '');
  });
  return html;
}
function swapSheet(di, m) {
  const day = data.plan.days[di];
  const cur = day.items[m];
  const list = PL.suitableFor(m);
  return `<div class="sheet-form">
    <h2>${MEAL_EMOJI[m]} ${t('meal_' + m)} · ${esc(fmtDate(day.date, { weekday: 'short', day: 'numeric', month: 'short' }))}</h2>
    <button class="btn primary full" data-act="plan-random" data-d="${di}" data-m="${m}">🎲 ${t('swap_random')}</button>
    <h3>${t('swap_choose')}</h3>
    <div class="presets">${list.map(r => `<button type="button" class="preset ${r.id === cur ? 'on' : ''}" data-act="plan-set" data-d="${di}" data-m="${m}" data-id="${r.id}">
      <span>${r.emoji} ${esc(nm(r.name))}</span><small>${r.ai ? '🤖 · ' : ''}${r.kcal} ${t('kcal')} · ⏱ ${r.time} ${t('u_min')}</small></button>`).join('')}</div>
    ${cur ? `<button class="btn danger full" data-act="plan-set" data-d="${di}" data-m="${m}" data-id="">${t('remove_from_menu')}</button>` : ''}
    <button class="btn ghost full" data-act="sheet-close">${t('cancel')}</button>
  </div>`;
}
function setPlanItem(di, m, id) {
  const day = data.plan.days[di];
  if (day.eaten?.[m]) unEat(di, m);
  day.items[m] = id || null;
}
function unEat(di, m) {
  const day = data.plan.days[di];
  const entryId = day.eaten[m];
  const d = getDay(day.date);
  d.food = d.food.filter(f => f.id !== entryId);
  delete day.eaten[m];
}

// ----- Список покупок -----
function vShop() {
  let html = foodTabs('shop');
  const plan = data.plan;
  if (!planActive()) {
    return html + card('🛒 ' + t('shop_title'), `<p>${t('shop_empty')}</p><a class="btn primary full" href="#/menu">✨ ${t('menu_make')}</a>`);
  }
  if (data.shop.planId !== plan.id) data.shop = { planId: plan.id, checked: {} };
  const groups = PL.shoppingList(plan);
  const all = groups.flatMap(g => g.items).filter(x => x.sec !== 'spice');
  const done = all.filter(x => data.shop.checked[x.key]).length;
  html += card('🛒 ' + t('shop_title'), `<div class="muted">${t('shop_for', { n: plan.servings })}</div>
    ${bar(all.length ? done / all.length : 0)}
    <div class="muted">${t('shop_progress', { a: done, b: all.length })}</div>
    ${done ? `<button class="btn ghost full" data-act="shop-reset">${t('shop_reset')}</button>` : ''}`);
  for (const g of groups) {
    const items = [...g.items].sort((a, b) => Number(!!data.shop.checked[a.key]) - Number(!!data.shop.checked[b.key]));
    html += card(`${SEC_EMOJI[g.sec]} ${t('sec_' + g.sec)}`,
      (g.sec === 'spice' ? `<div class="muted">${t('shop_pantry')}</div>` : '') +
      items.map(it => {
        const on = !!data.shop.checked[it.key];
        return `<button class="habit ${on ? 'on' : ''}" data-act="shop-check" data-key="${esc(it.key)}" aria-pressed="${on}">
          <span class="chk">${on ? '✓' : ''}</span><span class="nm">${esc(it.name)}</span><span class="qty">${esc(it.qty)}</span></button>`;
      }).join(''));
  }
  return html;
}

// ----- Рецепты -----
function vRecipes() {
  const f = ui.rf || 'all';
  const rs = PL.restrictions();
  const list = PL.allRecipes().filter(r => (f === 'all' ? true : f === 'own' ? r.custom : r.meals.includes(f)));
  const cuisine = r => (r.custom ? '⭐ ' + t('own') : r.cuisine === 'ru' ? t('cuisine_ru') : t('cuisine_world'));
  return foodTabs('recipes') + `
    <div class="row"><input type="search" id="rsearch" class="grow" placeholder="🔍 ${t('search')}" value="${esc(ui.rq || '')}" aria-label="${t('search')}">
      <a class="btn primary" href="#/recipe-edit/new">+ ${t('my_recipe')}</a></div>
    <div class="chips scroll">${['all', 'breakfast', 'lunch', 'dinner', 'snack', 'own'].map(k => chipBtn('rf', k, t('rf_' + k), f === k)).join('')}</div>
    <div class="rlist">${list.map(r => {
      const c = PL.conflicts(r, rs);
      const search = (r.custom ? r.name : `${r.name.ru} ${r.name.en}`).toLowerCase();
      return `<a class="card rcard" href="#/recipe/${r.id}" data-search="${esc(search)}"><span class="wem">${r.emoji}</span>
        <span class="grow"><b>${esc(nm(r.name))}</b><small>⏱ ${r.time} ${t('u_min')} · ${r.kcal} ${t('kcal')} · ${cuisine(r)}</small>
        ${c.length ? `<small class="bad">⚠️ ${esc(c.join(', '))}</small>` : ''}</span></a>`;
    }).join('') || `<div class="muted">${f === 'own' ? t('no_own') : t('nothing_found')}</div>`}</div>`;
}
function filterRecipes() {
  const q = (ui.rq || '').toLowerCase().trim();
  view.querySelectorAll('.rcard').forEach(el => { el.hidden = q && !el.dataset.search.includes(q); });
}
function recipeServings(id) {
  return ui.rs?.[id] || (planActive() ? data.plan.servings : data.planPrefs.servings) || 1;
}
function vRecipe(id) {
  const r = PL.recipeById(id);
  if (!r) return `<p>${t('not_found')}</p>`;
  const sv = recipeServings(id);
  const c = PL.conflicts(r);
  const ingRow = i => {
    if (i.custom) return `<li><span class="grow">${esc(i.name)}</span><span class="muted">${i.q ? U.fmtAmount(i.q * sv, i.u) : ''}</span></li>`;
    const d = ING[i.k];
    return `<li><span class="grow">${esc(nm(d.name))}</span><span class="muted">${U.fmtAmount(i.q * sv, d.u)}</span></li>`;
  };
  return card(`<span class="remoji">${r.emoji}</span> ${esc(nm(r.name))}`, `
      <div class="muted">⏱ ${r.time} ${t('u_min')} · ${r.kcal} ${t('kcal')} ${t('per_serving')}${r.ai ? ' · 🤖 ' + t('ai_recipe') : ''}</div>
      ${c.length ? `<div class="bad">⚠️ ${t('has_conflict')}: ${esc(c.join(', '))}</div>` : ''}
      <div class="row"><span class="grow lbl">${t('servings')}</span>
        <button class="mini" data-act="rs" data-id="${r.id}" data-n="-1" aria-label="−">−</button>
        <b class="sv">${sv}</b>
        <button class="mini" data-act="rs" data-id="${r.id}" data-n="1" aria-label="+">+</button></div>
      <ul class="list">${r.ings.map(ingRow).join('')}</ul>`)
    + (r.steps.length ? card('👩‍🍳 ' + t('steps'), `<ol class="steps">${r.steps.map(s => `<li>${esc(nm(s))}</li>`).join('')}</ol>`) : '')
    + `<button class="btn primary full" data-act="recipe-eat" data-id="${r.id}">🍽️ ${t('ate_portion')}</button>`
    + (r.ai ? `<button class="btn ghost full" data-act="recipe-keep" data-id="${r.id}">⭐ ${t('recipe_keep')}</button>` : '')
    + (r.custom ? `<div class="row"><a class="btn ghost grow" href="#/recipe-edit/${r.id}">✏️ ${t('edit')}</a>
        <button class="btn danger" data-act="recipe-del" data-id="${r.id}" aria-label="${t('delete')}">🗑</button></div>` : '');
}
function vRecipeEdit(id) {
  const r = id === 'new' ? null : data.recipes.find(x => x.id === id);
  if (id !== 'new' && !r) return `<p>${t('not_found')}</p>`;
  const v = r || { emoji: '🍲', name: '', meals: ['lunch'], time: 30, kcal: '', servings: 2, ingText: '', steps: [] };
  return `<form data-form="recipe" data-id="${r ? r.id : ''}" class="card">
    <h2>${r ? '✏️ ' + t('edit') : '⭐ ' + t('my_recipe')}</h2>
    <div class="row">
      <input name="emoji" class="emoji-in" maxlength="4" value="${esc(v.emoji)}" aria-label="emoji">
      <input name="name" class="grow" required maxlength="80" value="${esc(v.name)}" placeholder="${t('recipe_name_ph')}" aria-label="${t('recipe_name')}">
    </div>
    <div class="lbl">${t('meals_q')}</div>
    <div class="chips">${PL.MEALS.map(m => `<label class="chip"><input type="checkbox" name="meals" value="${m}" ${v.meals.includes(m) ? 'checked' : ''}><span>${MEAL_EMOJI[m]} ${t('meal_' + m)}</span></label>`).join('')}</div>
    <div class="two">
      <label class="fld"><span>${t('cook_time')}</span><input name="time" type="number" inputmode="numeric" min="0" max="600" value="${v.time}"></label>
      <label class="fld"><span>${t('recipe_servings')}</span><input name="servings" type="number" inputmode="numeric" min="1" max="20" required value="${v.servings}"></label>
    </div>
    <label class="fld"><span>${t('kcal_per_serving')}</span><input name="kcal" type="number" inputmode="numeric" min="0" max="3000" required value="${v.kcal}"></label>
    <label class="fld"><span>${t('ingredients')}</span><textarea name="ings" rows="6" placeholder="${t('ings_ph')}">${esc(v.ingText)}</textarea></label>
    <div class="muted">${t('ings_hint')}</div>
    <label class="fld"><span>${t('steps')}</span><textarea name="steps" rows="5" placeholder="${t('steps_ph')}">${esc(v.steps.join('\n'))}</textarea></label>
    <button class="btn primary full">${t('save')}</button>
  </form>`;
}

// ----- Спорт -----
function vSport() {
  const d = peekDay(ui.date);
  let html = stepsCard(d);
  const list = d.sport.length
    ? `<ul class="list">${d.sport.map(x => {
      const st = H.sportType(x.type);
      return `<li><span>${st.emoji}</span><span class="grow">${esc(x.title ? nm(x.title) : nm(st.name))}</span>
        <span class="muted">${x.min} ${t('u_min')}</span><b>${x.kcal}</b>
        <button class="x" data-act="sport-del" data-id="${x.id}" aria-label="${t('delete')}">×</button></li>`;
    }).join('')}</ul><div class="muted">${t('sport_total', { min: H.daySportMin(d), kcal: H.dayBurned(d) })}</div>`
    : `<div class="muted">${t('no_sport')}</div>`;
  html += card('🏃 ' + t('sport_title'), list + `<button class="btn primary full" data-act="sport-add">+ ${t('add_sport')}</button>`);
  html += `<h2 class="sec">${t('workouts_title')}</h2>`;
  html += WORKOUTS.map(w => `<a class="card wcard" href="#/workout/${w.id}">
    <span class="wem">${w.emoji}</span>
    <span class="grow"><b>${esc(nm(w.name))}</b><small>${esc(nm(w.desc))}</small></span>
    <span class="muted">${Math.round(workoutSec(w) / 60)} ${t('u_min')}</span></a>`).join('');
  return html;
}
function sportSheet() {
  return `<form data-form="sport">
    <h2>${t('add_sport')}</h2>
    <div class="chips">${SPORT_TYPES.map((s, i) => radio('type', s.id, `${s.emoji} ${esc(nm(s.name))}`, i === 0)).join('')}</div>
    <label class="fld"><span>${t('minutes')}</span><input name="min" type="number" inputmode="numeric" min="1" max="600" value="30" required></label>
    <div class="muted" id="sport-kcal"></div>
    <div class="row"><button type="button" class="btn ghost" data-act="sheet-close">${t('cancel')}</button>
      <button class="btn primary grow">${t('save')}</button></div>
  </form>`;
}
function updateSportPreview(f) {
  const fd = new FormData(f);
  const out = f.querySelector('#sport-kcal');
  if (out) out.textContent = t('kcal_approx', { n: H.sportKcal(fd.get('type'), num(fd.get('min')) || 0) });
}

// ----- Тренировка с таймером -----
let wo = null;          // идущая тренировка
let wakeLock = null;
let actx = null;

function unlockAudio() {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    actx.resume?.();
  } catch { /* без звука */ }
}
function beep(freq = 800, dur = 0.12) {
  if (!actx) return;
  try {
    const o = actx.createOscillator(), g = actx.createGain();
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.18, actx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + dur);
    o.connect(g).connect(actx.destination);
    o.start();
    o.stop(actx.currentTime + dur);
  } catch { /* без звука */ }
}
async function requestWake() {
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* не поддерживается */ }
}
function releaseWake() {
  try { wakeLock?.release?.(); } catch { /* ничего */ }
  wakeLock = null;
}
function buildSteps(w) {
  const steps = [{ kind: 'ready', sec: 5, name: { ru: 'Приготовься', en: 'Get ready' } }];
  for (let r = 0; r < w.rounds; r++) {
    w.exercises.forEach((e, i) => {
      steps.push({ kind: 'work', sec: e.sec, name: e.name, hint: e.hint, round: r + 1 });
      const last = r === w.rounds - 1 && i === w.exercises.length - 1;
      if (!last && w.rest) steps.push({ kind: 'rest', sec: w.rest, name: { ru: 'Отдых', en: 'Rest' } });
    });
  }
  return steps;
}
function startWorkout(id) {
  const w = WORKOUTS.find(x => x.id === id);
  if (!w) return;
  unlockAudio();
  wo = { id, w, steps: buildSteps(w), idx: 0, endAt: 0, paused: false, left: 0, done: false, lastBeep: null, doneSec: 0 };
  beginStep();
  wo.timer = setInterval(tick, 200);
  requestWake();
  render();
}
function beginStep() {
  wo.endAt = Date.now() + wo.steps[wo.idx].sec * 1000;
  wo.lastBeep = null;
}
// Сколько секунд реально прошло в текущем шаге («Приготовься» не считается)
function stepElapsed() {
  if (wo.idx === 0 || wo.idx >= wo.steps.length) return 0;
  const rem = wo.paused ? wo.left : wo.endAt - Date.now();
  return Math.max(0, Math.min(wo.steps[wo.idx].sec, wo.steps[wo.idx].sec - rem / 1000));
}
const elapsedSec = () => wo.doneSec + stepElapsed();
function tick() {
  if (!wo || wo.paused || wo.done) return;
  const rem = wo.endAt - Date.now();
  if (rem <= 0) { nextStep(); return; }
  updateTime(rem);
  const sec = Math.ceil(rem / 1000);
  if (sec <= 3 && sec !== wo.lastBeep) { wo.lastBeep = sec; beep(600, 0.08); }
}
function nextStep() {
  wo.doneSec += stepElapsed();
  wo.paused = false;
  wo.idx++;
  if (wo.idx >= wo.steps.length) { finishWorkout(wo.doneSec); return; }
  beep(950, 0.25);
  beginStep();
  drawPlayer();
}
function logWorkout(sec) {
  const min = Math.max(1, Math.round(sec / 60));
  const kcal = H.sportKcal(wo.w.type, min);
  getDay(todayKey()).sport.push({ id: uid(), type: wo.w.type, min, kcal, title: wo.w.name });
  save();
  const fresh = P.checkBadges();
  if (fresh.length) save();
  fresh.forEach((b, i) => setTimeout(() => toast(`${b.emoji} ${t('new_badge')}: ${nm(b.name)}`), 1500 + i * 2800));
  return { min, kcal };
}
function finishWorkout(sec) {
  clearInterval(wo.timer);
  wo.done = true;
  wo.result = sec >= 30 ? logWorkout(sec) : { min: 0, kcal: 0 };
  releaseWake();
  beep(1000, 0.15); setTimeout(() => beep(1300, 0.3), 180);
  drawPlayer();
}
function cleanupWorkout() {
  if (!wo) return;
  clearInterval(wo.timer);
  releaseWake();
  wo = null;
}
function updateTime(rem) {
  const st = wo.steps[wo.idx];
  const te = $('#wo-time');
  if (te) te.textContent = Math.max(0, Math.ceil(rem / 1000));
  const ring = $('#wo-ring');
  if (ring) ring.style.setProperty('--p', Math.min(1, Math.max(0, 1 - rem / (st.sec * 1000))).toFixed(3));
}
function drawPlayer() {
  const el = $('#player');
  if (!el || !wo) return;
  if (wo.done) {
    el.innerHTML = `<div class="player done"><div class="wem">🎉</div><h2>${t('wo_done')}</h2>
      <p>${wo.result.min ? t('wo_result', { min: wo.result.min, kcal: wo.result.kcal }) : t('wo_short')}</p>
      <div class="row"><button class="btn ghost grow" data-act="wo-again" data-id="${wo.id}">↻ ${t('again')}</button>
      <a class="btn primary grow" href="#/sport">${t('to_sport')}</a></div></div>`;
    return;
  }
  const st = wo.steps[wo.idx];
  const works = wo.steps.filter(s => s.kind === 'work');
  const workIdx = wo.steps.slice(0, wo.idx + 1).filter(s => s.kind === 'work').length;
  const next = wo.steps.slice(wo.idx + 1).find(s => s.kind === 'work');
  const roundTxt = st.round && wo.w.rounds > 1 ? ` · ${t('round')} ${st.round}/${wo.w.rounds}` : '';
  el.innerHTML = `<div class="player ${st.kind}">
    <div class="ph-kind">${t('wo_' + st.kind)}${roundTxt}</div>
    <div class="ring" id="wo-ring"><span id="wo-time"></span></div>
    <div class="ph-name">${esc(nm(st.name))}</div>
    ${st.hint ? `<div class="ph-hint">${esc(nm(st.hint))}</div>` : ''}
    ${next ? `<div class="muted">${t('next')}: ${esc(nm(next.name))}</div>` : ''}
    <div class="muted">${t('exercise_n', { i: Math.max(1, workIdx), n: works.length })}</div>
    <div class="row">
      <button class="btn ghost" data-act="wo-stop">■ ${t('stop')}</button>
      <button class="btn primary grow" data-act="wo-pause">${wo.paused ? '▶ ' + t('resume') : '⏸ ' + t('pause')}</button>
      <button class="btn ghost" data-act="wo-skip" aria-label="${t('next')}">⏭</button>
    </div></div>`;
  updateTime(wo.paused ? wo.left : wo.endAt - Date.now());
}
function vWorkout(id) {
  const w = WORKOUTS.find(x => x.id === id);
  if (!w) return `<p>${t('not_found')}</p>`;
  if (wo && wo.id === id) return `<div id="player"></div>`;
  return card(`${w.emoji} ${esc(nm(w.name))}`, `
    <p>${esc(nm(w.desc))}</p>
    <div class="muted">${t('wo_meta', { min: Math.round(workoutSec(w) / 60), n: w.exercises.length, r: w.rounds })}</div>
    <ol class="exlist">${w.exercises.map(e => `<li><b>${esc(nm(e.name))}</b> — ${e.sec} ${t('u_sec')}<br><small>${esc(nm(e.hint))}</small></li>`).join('')}</ol>
    <button class="btn primary full big-btn" data-act="wo-start" data-id="${w.id}">▶ ${t('start')}</button>`);
}

// ----- Сон и дневник -----
function lastSleep() {
  const keys = Object.keys(data.days).sort().reverse();
  for (const k of keys) if (data.days[k].sleep) return data.days[k].sleep;
  return null;
}
function sleepChart() {
  const keys = Array.from({ length: 7 }, (_, i) => addDays(ui.date, i - 6));
  const vals = keys.map(k => { const s = peekDay(k).sleep; return s ? H.sleepMinutes(s.bed, s.wake) : 0; });
  const labels = keys.map(k => fmtDate(k, { weekday: 'short' }));
  const moods = keys.map(k => { const m = peekDay(k).diary?.mood; return `<span>${m ? MOODS[m - 1] : '·'}</span>`; }).join('');
  return barChart(vals, labels, 600, 480, v => (v / 60).toFixed(1)) +
    `<div class="moods">${moods}</div><div class="muted">${t('sleep_chart_hint')}</div>`;
}
function vSleep() {
  const d = peekDay(ui.date);
  const last = lastSleep();
  const sl = d.sleep || { bed: last?.bed || '23:00', wake: last?.wake || '07:00', quality: 0 };
  const di = d.diary || { mood: 0, energy: 0, stress: 0, note: '' };
  let html = card('🌙 ' + t('sleep_title'), `<form data-form="sleep">
    <div class="muted">${t('sleep_hint')}</div>
    <div class="two">
      <label class="fld"><span>${t('bedtime')}</span><input type="time" name="bed" value="${sl.bed}" required></label>
      <label class="fld"><span>${t('waketime')}</span><input type="time" name="wake" value="${sl.wake}" required></label>
    </div>
    <div class="ok" id="sleep-dur"></div>
    <div class="lbl">${t('sleep_quality')}</div>${scale('quality', sl.quality, MOODS)}
    <button class="btn primary full">${d.sleep ? '✓ ' : ''}${t('save')}</button></form>`);
  html += card('📔 ' + t('diary_title'), `<form data-form="diary">
    <div class="lbl">${t('mood')}</div>${scale('mood', di.mood, MOODS)}
    <div class="lbl">${t('energy')} ⚡</div>${scale('energy', di.energy, ['1', '2', '3', '4', '5'])}
    <div class="lbl">${t('stress')} 🌪️</div>${scale('stress', di.stress, ['1', '2', '3', '4', '5'])}
    <label class="fld"><span>${t('note')}</span><textarea name="note" rows="3" maxlength="1000" placeholder="${t('note_ph')}">${esc(di.note)}</textarea></label>
    <button class="btn primary full">${d.diary ? '✓ ' : ''}${t('save')}</button></form>`);
  html += card('📊 ' + t('week_sleep'), sleepChart());
  return html;
}
function updateSleepPreview(f) {
  const out = f.querySelector('#sleep-dur');
  if (out) out.textContent = t('sleep_dur', { d: fmtDur(H.sleepMinutes(f.elements.bed.value, f.elements.wake.value)) });
}

// ----- Ещё -----
function vMore() {
  const items = [
    ['#/coach', '🤖', 'coach_title'], ['#/weight', '⚖️', 'weight_title'], ['#/habits', '✅', 'habits_title'], ['#/awards', '🏅', 'awards_title'],
    ['#/profile', '👤', 'profile_title'], ['#/settings', '⚙️', 'settings_title'], ['#/backup', '💾', 'backup_title'],
    ['#/install', '📲', 'install_title'],
  ];
  return `<nav class="menu card">${items.map(([h, e, k]) => `<a href="${h}"><span class="em">${e}</span><span class="grow">${t(k)}</span><span class="muted">›</span></a>`).join('')}</nav>`
    + card('🔜 ' + t('coming_title'), `<ul class="plain">${t('coming_list')}</ul>`);
}

// ----- ИИ-тренер -----
const fmtMsg = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');
const reviewDue = () => !data.coach.lastReview || data.coach.lastReview <= addDays(todayKey(), -7);
function coachCard() {
  if (!AI.aiReady() || !reviewDue() || !P.totalPoints()) return '';
  return card('🤖 ' + t('coach_title'), `<p>${t('coach_week_ready')}</p>
    <button class="btn primary full" data-act="coach-review-go">📊 ${t('coach_review')}</button>`);
}
function vCoach() {
  if (!AI.aiReady()) {
    return card('🤖 ' + t('coach_title'), `<p>${t('coach_intro')}</p><p class="muted">${t('ai_off')}</p>
      <a class="btn primary full" href="#/settings">⚙️ ${t('ai_setup_btn')}</a>`);
  }
  const c = data.coach, busy = !!ui.coachBusy;
  const msgs = c.msgs.map(m => `<div class="msg ${m.role}${m.err ? ' err' : ''}">${fmtMsg(m.text)}</div>`).join('');
  return card('🤖 ' + t('coach_title'), `<p class="muted">${t('coach_intro')}</p>
      <div class="muted">${t('tone')}: ${t('tone_' + data.settings.tone)} · <a href="#/settings">${t('change')}</a></div>
      <button class="btn primary full" data-act="coach-review" ${busy ? 'disabled' : ''}>📊 ${t('coach_review')}</button>`)
    + `<div class="chat" id="chat">${msgs || `<div class="muted center">${t('coach_empty')}</div>`}
      ${busy ? `<div class="msg assistant wait"><span class="spin"></span>${t('coach_thinking')}</div>` : ''}</div>`
    + (c.msgs.length ? '' : `<div class="chips">${['coach_q1', 'coach_q2', 'coach_q3'].map(k => `<button type="button" class="chip-btn" data-act="coach-quick" data-q="${esc(t(k))}" ${busy ? 'disabled' : ''}>${t(k)}</button>`).join('')}</div>`)
    + `<form data-form="coach" class="row chat-in">
      <input name="q" class="grow" maxlength="1000" required placeholder="${t('coach_ph')}" aria-label="${t('coach_ph')}" ${busy ? 'disabled' : ''}>
      <button class="btn primary" ${busy ? 'disabled' : ''} aria-label="${t('send')}">➤</button></form>`
    + (c.msgs.length && !busy ? `<button class="btn ghost full" data-act="coach-clear">🧹 ${t('coach_clear')}</button>` : '');
}
function scrollChat() {
  const last = view.querySelector('#chat > :last-child');
  if (last) last.scrollIntoView({ block: 'end', behavior: 'smooth' });
}
async function coachAsk(mode, question = '') {
  if (ui.coachBusy || !AI.aiReady()) return;
  const c = data.coach;
  const history = c.msgs.filter(m => !m.err).slice(-10).map(m => ({ role: m.role, text: m.text }));
  c.msgs.push({ role: 'user', text: mode === 'review' ? '📊 ' + t('coach_review') : question, at: Date.now() });
  ui.coachBusy = true;
  save();
  render();
  scrollChat();
  try {
    const res = await AI.aiCall('coach', { mode, question, tone: data.settings.tone, stats: AI.weekStats(), history });
    c.msgs.push({ role: 'assistant', text: String(res.text || '…'), at: Date.now() });
    if (mode === 'review') c.lastReview = todayKey();
  } catch (e) {
    c.msgs.push({ role: 'assistant', text: '⚠️ ' + aiErr(e), at: Date.now(), err: true });
  }
  c.msgs = c.msgs.slice(-40);
  ui.coachBusy = false;
  save();
  if (route().name === 'coach') { render(); scrollChat(); }
  else toast('🤖 ' + t('coach_answered'));
}

// ----- Вес -----
function upsertWeight(date, kg) {
  data.weights = data.weights.filter(w => w.date !== date);
  data.weights.push({ date, kg: Math.round(kg * 100) / 100 });
  data.weights.sort((a, b) => a.date.localeCompare(b.date));
}
function vWeight() {
  const p = data.profile;
  const cur = H.currentWeight();
  const b = H.bmi(cur);
  let goalTxt = t('goal') + ': ' + t('goalc_' + p.goal);
  if (p.targetKg) {
    const diff = Math.abs(cur - p.targetKg);
    goalTxt += ` · ${t('target')} ${U.fmtWeight(p.targetKg)} — ${diff < 0.25 ? t('goal_reached') : t('left_to_go', { v: U.fmtWeight(diff) })}`;
  }
  let html = card('⚖️ ' + t('weight_title'), `
    <div class="big">${U.kgToShow(cur)}<small> ${U.weightUnit()}</small></div>
    <div class="muted">${goalTxt}</div>
    <div>${t('bmi')}: <b>${b ?? '—'}</b> ${b ? '— ' + t(H.bmiCategory(b)) : ''}</div>
    <form data-form="weight" class="row">
      <input name="w" type="text" inputmode="decimal" placeholder="${U.kgToShow(cur)}" required aria-label="${t('weight')}">
      <span class="unit">${U.weightUnit()}</span>
      <button class="btn primary">${t('add')}</button>
    </form>`);
  const sorted = data.weights;
  html += card('📈 ' + t('weight_chart'), sorted.length >= 2 ? lineChart(sorted.slice(-60)) : `<div class="muted">${t('weight_chart_empty')}</div>`);
  if (sorted.length) {
    html += card('🗓️ ' + t('history'), `<ul class="list">${[...sorted].reverse().slice(0, 20).map(w => `<li>
      <span class="grow">${esc(fmtDate(w.date, { day: 'numeric', month: 'long', year: 'numeric' }))}</span><b>${U.fmtWeight(w.kg)}</b>
      <button class="x" data-act="weight-del" data-date="${w.date}" aria-label="${t('delete')}">×</button></li>`).join('')}</ul>`);
  }
  return html;
}

// ----- Привычки -----
function vHabits() {
  const rows = data.habits.map(h => {
    const st = h.active ? P.habitStreak(h.id) : 0;
    return `<li class="${h.active ? '' : 'off'}"><span class="em">${esc(h.emoji)}</span>
      <span class="grow">${esc(nm(h.name))}${st ? ` <small>🔥${st}</small>` : ''}</span>
      <button class="toggle ${h.active ? 'on' : ''}" data-act="habit-active" data-id="${h.id}" role="switch" aria-checked="${h.active}" aria-label="${esc(nm(h.name))}"><i></i></button>
      ${h.custom ? `<button class="x" data-act="habit-del" data-id="${h.id}" aria-label="${t('delete')}">×</button>` : ''}</li>`;
  }).join('');
  return card('✅ ' + t('habits_title'), `<p class="muted">${t('habits_hint')}</p><ul class="list habits-list">${rows}</ul>`)
    + card('➕ ' + t('habit_new'), `<form data-form="habit" class="row">
      <input name="emoji" class="emoji-in" maxlength="4" placeholder="⭐" aria-label="emoji">
      <input name="name" class="grow" required maxlength="50" placeholder="${t('habit_name_ph')}" aria-label="${t('habit_new')}">
      <button class="btn primary">${t('add')}</button></form>`);
}

// ----- Награды -----
function vAwards() {
  const pts = P.totalPoints(), lv = P.level(pts);
  return card(`⭐ ${t('level')} ${lv.level}`, `
      <div class="big">${pts}<small> ${t('points')}</small></div>
      ${bar(lv.progress)}
      <div class="muted">${t('to_next', { n: P.POINTS_PER_LEVEL - lv.inLevel })}</div>
      <div>🔥 ${t('active_streak', { n: P.activeStreak() })}</div>`)
    + card('🏅 ' + t('badges'), `<div class="badges">${P.BADGES.map(b => {
      const got = data.badges[b.id];
      return `<div class="badge ${got ? 'got' : ''}"><div class="bem">${b.emoji}</div><b>${esc(nm(b.name))}</b>
        <small>${esc(nm(b.desc))}</small>${got ? `<small class="ok">✓ ${esc(fmtDate(got, { day: 'numeric', month: 'short' }))}</small>` : ''}</div>`;
    }).join('')}</div>`)
    + card('ℹ️ ' + t('how_points'), `<ul class="plain">${t('points_rules')}</ul>`);
}

// ----- Профиль (и первый запуск) -----
function chipBtn(act, v, label, on) {
  return `<button type="button" class="chip-btn ${on ? 'on' : ''}" data-act="${act}" data-v="${v}" aria-pressed="${on}">${label}</button>`;
}
function vProfile(isOnb) {
  const p = data.profile || { name: '', sex: '', age: '', heightCm: '', weightKg: '', goal: 'keep', targetKg: '', activity: 1.375, allergies: '', dislikes: '', diet: '' };
  const s = data.settings, us = U.isUS();
  const fi = p.heightCm ? U.cmToFtIn(p.heightCm) : { ft: '', inch: '' };
  const wNow = p.weightKg ? U.kgToShow(isOnb ? p.weightKg : H.currentWeight()) : '';
  let html = '';
  if (isOnb) {
    html += `<section class="welcome"><div class="logo">🌿</div><h2>${t('welcome_title')}</h2><p>${t('welcome_text')}</p></section>`;
    html += card('🌐 ' + t('lang_units'), `
      <div class="chips">${chipBtn('set-lang', 'ru', 'Русский', s.lang === 'ru')}${chipBtn('set-lang', 'en', 'English', s.lang === 'en')}</div>
      <div class="chips">${chipBtn('set-units', 'metric', t('units_metric'), !us)}${chipBtn('set-units', 'us', t('units_us'), us)}</div>`);
  }
  const height = us
    ? `<div class="fld"><span>${t('height')}</span><div class="row tight">
        <input name="ft" type="number" inputmode="numeric" min="3" max="8" required value="${fi.ft}" aria-label="ft"><span class="unit">ft</span>
        <input name="in" type="number" inputmode="numeric" min="0" max="11" value="${fi.inch}" aria-label="in"><span class="unit">in</span></div></div>`
    : `<label class="fld"><span>${t('height')}, ${t('u_cm')}</span><input name="cm" type="number" inputmode="numeric" min="90" max="250" required value="${p.heightCm ? Math.round(p.heightCm) : ''}"></label>`;
  html += `<form data-form="profile" class="card">
    ${isOnb ? '' : `<h2>👤 ${t('profile_title')}</h2>`}
    <label class="fld"><span>${t('name')}</span><input name="name" required maxlength="30" value="${esc(p.name)}" autocomplete="given-name"></label>
    <div class="lbl">${t('sex')}</div><div class="chips">${radio('sex', 'm', t('sex_m'), p.sex === 'm', true)}${radio('sex', 'f', t('sex_f'), p.sex === 'f')}</div>
    <div class="two">
      <label class="fld"><span>${t('age')}</span><input name="age" type="number" inputmode="numeric" min="10" max="110" required value="${p.age}"></label>
      ${height}
    </div>
    <div class="two">
      <label class="fld"><span>${t('weight')}, ${U.weightUnit()}</span><input name="w" type="text" inputmode="decimal" required value="${wNow}"></label>
      <label class="fld"><span>${t('target_weight')}, ${U.weightUnit()}</span><input name="tw" type="text" inputmode="decimal" value="${p.targetKg ? U.kgToShow(p.targetKg) : ''}" placeholder="${t('optional')}"></label>
    </div>
    <div class="lbl">${t('goal')}</div><div class="chips">${['lose', 'keep', 'gain'].map(g => radio('goal', g, t('goalc_' + g), p.goal === g)).join('')}</div>
    <label class="fld"><span>${t('activity')}</span><select name="activity">${H.ACTIVITY_LEVELS.map(a => `<option value="${a.v}" ${Number(p.activity) === a.v ? 'selected' : ''}>${t(a.key)}</option>`).join('')}</select></label>
    <label class="fld"><span>${t('allergies')}</span><input name="allergies" maxlength="200" value="${esc(p.allergies)}" placeholder="${t('allergies_ph')}"></label>
    <label class="fld"><span>${t('dislikes')}</span><input name="dislikes" maxlength="200" value="${esc(p.dislikes)}" placeholder="${t('dislikes_ph')}"></label>
    <label class="fld"><span>${t('diet')}</span><input name="diet" maxlength="200" value="${esc(p.diet)}" placeholder="${t('diet_ph')}"></label>
    <p class="muted">${t('food_prefs_hint')}</p>
    <button class="btn primary full">${isOnb ? t('start_using') : t('save')}</button>
  </form>`;
  return html;
}

// ----- Настройки -----
function vSettings() {
  const s = data.settings;
  return `<form data-form="settings" class="card">
    <div class="lbl">${t('language')}</div><div class="chips">${radio('lang', 'ru', 'Русский', s.lang === 'ru')}${radio('lang', 'en', 'English', s.lang === 'en')}</div>
    <div class="lbl">${t('units')}</div><div class="chips">${radio('units', 'metric', t('units_metric'), s.units === 'metric')}${radio('units', 'us', t('units_us'), s.units === 'us')}</div>
    <div class="lbl">${t('tone')}</div><div class="chips">${['kind', 'fun', 'strict'].map(x => radio('tone', x, t('tone_' + x), s.tone === x)).join('')}</div>
    <p class="muted">${t('tone_hint')}</p>
    <label class="fld"><span>${t('water_goal')}</span><input name="water" type="number" inputmode="numeric" min="1" max="30" required value="${s.waterGoal}"></label>
    <label class="fld"><span>${t('steps_goal_lbl')}</span><input name="steps" type="number" inputmode="numeric" min="500" max="100000" step="500" required value="${s.stepsGoal}"></label>
    <label class="fld"><span>${t('kcal_goal_lbl')}</span><input name="kcal" type="number" inputmode="numeric" min="800" max="6000" value="${s.kcalGoal || ''}" placeholder="${t('kcal_auto', { n: H.autoKcalGoal() })}"></label>
    <button class="btn primary full">${t('save')}</button>
  </form>
  <form data-form="aiset" class="card" id="ai-settings">
    <h2>🤖 ${t('ai_title')}</h2>
    <p class="muted">${AI.aiReady() ? `<span class="ok-txt">✓ ${t('ai_on')}</span>` : t('ai_off_here')}</p>
    <label class="fld"><span>${t('ai_url')}</span><input name="aiUrl" type="text" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(s.aiUrl)}" placeholder="https://zdorovenkiy-ai.….workers.dev"></label>
    <label class="fld"><span>${t('ai_code')}</span><input name="aiCode" type="password" autocomplete="off" value="${esc(s.aiCode)}"></label>
    <div class="row"><button type="button" class="btn ghost grow" data-act="ai-test">🔌 ${t('ai_test')}</button>
      <button class="btn primary grow">${t('save')}</button></div>
    <div id="ai-test-res" class="muted" aria-live="polite"></div>
    <details class="howto"><summary>${t('ai_howto_title')}</summary><ol class="steps">${t('ai_howto')}</ol></details>
    <p class="muted">💵 ${t('ai_cost')}</p>
  </form>`;
}

// ----- Резервная копия -----
function vBackup() {
  const last = data.lastBackup ? new Date(data.lastBackup).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' }) : t('never');
  return card('💾 ' + t('backup_title'), `<p>${t('backup_text')}</p>
      <div class="muted">${t('last_backup')}: ${esc(last)}</div>
      <button class="btn primary full" data-act="backup-save">💾 ${t('backup_save')}</button>
      <button class="btn ghost full" data-act="backup-load">📂 ${t('backup_load')}</button>
      <input type="file" id="backup-file" accept="application/json,.json" hidden>`)
    + card('⚠️ ' + t('danger_zone'), `<button class="btn danger full" data-act="wipe">${t('wipe')}</button>`);
}
async function backupSave() {
  const stamp = todayKey();
  const json = JSON.stringify({ app: 'zdorovenkiy', exportedAt: new Date().toISOString(), data }, null, 1);
  const fileName = `zdorovenkiy-backup-${stamp}.json`;
  const file = new File([json], fileName, { type: 'application/json' });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: fileName });
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(file);
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }
    data.lastBackup = new Date().toISOString();
    commit();
    toast(t('backup_done'));
  } catch (e) {
    if (e?.name !== 'AbortError') toast(t('backup_fail'));
  }
}
async function backupLoad(file) {
  if (!file) return;
  try {
    const obj = JSON.parse(await file.text());
    if (obj?.app !== 'zdorovenkiy' || !obj.data) { toast(t('backup_bad')); return; }
    const when = obj.exportedAt ? new Date(obj.exportedAt).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' }) : '?';
    if (!confirm(t('restore_q', { d: when }))) return;
    replaceData(obj.data);
    ui.date = todayKey();
    render();
    toast(t('restored'));
  } catch {
    toast(t('backup_bad'));
  }
}

// ----- Установка -----
function vInstall() {
  return card('📲 ' + t('install_title'), `<ol class="steps">${t('install_steps')}</ol><p class="muted">${t('install_note')}</p>`);
}

// ================= КНОПКИ =================
const ACTIONS = {
  'date': el => {
    const next = addDays(ui.date, Number(el.dataset.n));
    if (next <= todayKey()) { ui.date = next; render(); }
  },
  'water': el => {
    const d = getDay(ui.date);
    const before = d.water;
    d.water = Math.max(0, d.water + Number(el.dataset.n));
    commit();
    if (before < data.settings.waterGoal && d.water >= data.settings.waterGoal) toast(t('water_done') + ' 🎉');
  },
  'habit': el => {
    const d = getDay(ui.date);
    d.habits[el.dataset.id] = !d.habits[el.dataset.id];
    commit();
  },
  'hide-install': () => { data.settings.installHintHidden = true; commit(); },
  'food-add': el => openSheet(foodSheet(el.dataset.meal)),
  'food-preset': el => {
    const f = FOOD_PRESETS[Number(el.dataset.i)];
    const form = el.closest('form');
    form.elements.namedItem('name').value = `${nm(f.name)} (${portion(f)})`;
    form.elements.namedItem('kcal').value = f.kcal;
    form.querySelector('.fld')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  },
  'food-del': el => {
    if (!confirm(t('confirm_delete'))) return;
    const d = getDay(ui.date);
    d.food = d.food.filter(f => f.id !== el.dataset.id);
    commit();
  },
  'photo': () => { if (!needAi()) $('#photo-file')?.click(); },
  'photo-retry': () => runPhoto(),
  'photo-redo': el => {
    const f = el.closest('form');
    ui.photo.note = String(f.elements.namedItem('note').value || '').trim();
    ui.photo.meal = f.querySelector('input[name="meal"]:checked')?.value || ui.photo.meal;
    runPhoto();
  },
  'sport-add': () => {
    openSheet(sportSheet());
    updateSportPreview($('#sheet form'));
  },
  'sport-del': el => {
    if (!confirm(t('confirm_delete'))) return;
    const d = getDay(ui.date);
    d.sport = d.sport.filter(x => x.id !== el.dataset.id);
    commit();
  },
  'wo-start': el => startWorkout(el.dataset.id),
  'wo-again': el => { const id = el.dataset.id; cleanupWorkout(); startWorkout(id); },
  'wo-pause': () => {
    if (!wo) return;
    if (wo.paused) { wo.endAt = Date.now() + wo.left; wo.paused = false; }
    else { wo.left = wo.endAt - Date.now(); wo.paused = true; }
    drawPlayer();
  },
  'wo-skip': () => { if (wo && !wo.done) nextStep(); },
  'wo-stop': () => {
    if (!wo) return;
    const sec = elapsedSec();
    const min = Math.round(sec / 60);
    if (min >= 1) {
      if (!confirm(t('wo_stop_log', { min }))) return;
      logWorkout(sec);
    } else if (!confirm(t('wo_stop_q'))) return;
    cleanupWorkout();
    location.hash = '#/sport';
  },
  'habit-active': el => {
    const h = data.habits.find(x => x.id === el.dataset.id);
    if (h) { h.active = !h.active; commit(); }
  },
  'habit-del': el => {
    if (!confirm(t('confirm_delete_habit'))) return;
    data.habits = data.habits.filter(x => x.id !== el.dataset.id);
    commit();
  },
  'set-lang': el => { data.settings.lang = el.dataset.v; save(); render(); },
  'set-units': el => { data.settings.units = el.dataset.v; save(); render(); },
  'weight-del': el => {
    if (!confirm(t('confirm_delete'))) return;
    data.weights = data.weights.filter(w => w.date !== el.dataset.date);
    commit();
  },
  'backup-save': () => backupSave(),
  'backup-load': () => $('#backup-file')?.click(),
  'wipe': () => {
    if (!confirm(t('wipe_q')) || !confirm(t('wipe_q2'))) return;
    cleanupWorkout();
    wipeData();
    ui.date = todayKey();
    toast(t('wiped'));
    location.hash = '#/onboarding';
    render();
  },
  'sheet-close': () => closeSheet(),

  // --- Меню, покупки, рецепты ---
  'ai-menu': () => {
    if (needAi()) return;
    openSheet(ui.aiMenuBusy ? aiMenuSheet('wait') : aiMenuSheet());
  },
  'recipe-keep': el => {
    const r = data.plan?.recipes?.find(x => x.id === el.dataset.id);
    if (!r) return;
    if (data.recipes.some(x => x.fromAi === r.id)) { toast(t('recipe_kept_already')); return; }
    const UN = lang() === 'en'
      ? { g: 'g', ml: 'ml', pcs: 'pcs', tbsp: 'tbsp', tsp: 'tsp', clove: 'cloves' }
      : { g: 'г', ml: 'мл', pcs: 'шт', tbsp: 'ст.л', tsp: 'ч.л', clove: 'зубч' };
    const lines = r.ings.map(i => (i.u === 'taste' || !i.q || !UN[i.u] ? i.name : `${i.name} ${Math.round(i.q * 10) / 10} ${UN[i.u]}`));
    const ingText = lines.join('\n');
    data.recipes.push({
      id: uid(), fromAi: r.id, emoji: r.emoji, name: r.name, meals: [...r.meals], time: r.time, servings: 1, kcal: r.kcal,
      ingText, ings: lines.map(PL.parseIngLine).filter(Boolean), steps: [...r.steps],
    });
    commit();
    toast(t('recipe_kept'));
  },
  'coach-review': () => coachAsk('review'),
  'coach-review-go': () => { location.hash = '#/coach'; setTimeout(() => coachAsk('review'), 50); },
  'coach-quick': el => coachAsk('ask', el.dataset.q),
  'coach-clear': () => {
    if (!confirm(t('coach_clear_q'))) return;
    data.coach.msgs = [];
    commit();
  },
  'ai-test': async el => {
    const f = el.closest('form');
    const out = f.querySelector('#ai-test-res');
    const url = AI.normUrl(f.elements.namedItem('aiUrl').value);
    const code = String(f.elements.namedItem('aiCode').value || '').trim();
    if (!url || !code) { out.textContent = t('ai_fill_both'); return; }
    el.disabled = true;
    out.innerHTML = `<span class="ai-wait"><span class="spin"></span>${t('ai_testing')}</span>`;
    try {
      await AI.aiCall('ping', {}, { url, code });
      out.innerHTML = `<span class="ok-txt">✓ ${t('ai_test_ok')}</span>`;
    } catch (e) {
      out.innerHTML = `<span class="bad">⚠️ ${esc(aiErr(e))}</span>`;
    } finally {
      el.disabled = false;
    }
  },
  'menu-new': () => {
    if (!confirm(t('menu_new_q'))) return;
    data.plan = null;
    commit();
  },
  'plan-swap': el => openSheet(swapSheet(Number(el.dataset.d), el.dataset.m)),
  'plan-random': el => {
    const di = Number(el.dataset.d), m = el.dataset.m;
    setPlanItem(di, m, PL.replacement(data.plan, di, m));
    closeSheet();
    commit();
  },
  'plan-set': el => {
    setPlanItem(Number(el.dataset.d), el.dataset.m, el.dataset.id);
    closeSheet();
    commit();
  },
  'plan-eat': el => {
    const di = Number(el.dataset.d), m = el.dataset.m;
    const day = data.plan.days[di];
    day.eaten = day.eaten || {};
    if (day.eaten[m]) { unEat(di, m); commit(); return; }
    const r = PL.recipeById(day.items[m]);
    if (!r) return;
    const entry = { id: uid(), meal: m, name: `${r.emoji} ${nm(r.name)}`, kcal: r.kcal, at: Date.now() };
    getDay(day.date).food.push(entry);
    day.eaten[m] = entry.id;
    commit();
    toast(t('logged_food', { n: r.kcal }));
  },
  'shop-check': el => {
    const k = el.dataset.key;
    if (data.shop.checked[k]) delete data.shop.checked[k]; else data.shop.checked[k] = true;
    commit();
  },
  'shop-reset': () => { data.shop.checked = {}; commit(); },
  'rf': el => { ui.rf = el.dataset.v; render(); },
  'rs': el => {
    const id = el.dataset.id;
    ui.rs = ui.rs || {};
    ui.rs[id] = Math.min(20, Math.max(1, recipeServings(id) + Number(el.dataset.n)));
    render();
  },
  'recipe-eat': el => {
    const r = PL.recipeById(el.dataset.id);
    if (!r) return;
    getDay(todayKey()).food.push({ id: uid(), meal: mealByTime(), name: `${r.emoji} ${nm(r.name)}`, kcal: r.kcal, at: Date.now() });
    commit();
    toast(t('logged_food', { n: r.kcal }));
  },
  'recipe-del': el => {
    if (!confirm(t('recipe_del_q'))) return;
    data.recipes = data.recipes.filter(r => r.id !== el.dataset.id);
    save();
    location.hash = '#/recipes';
  },
};

// ================= ФОРМЫ =================
const FORMS = {
  steps: (f, fd) => {
    getDay(ui.date).steps = Math.max(0, Math.round(num(fd.get('steps')) || 0));
    commit();
    toast(t('saved'));
  },
  food: (f, fd) => {
    getDay(ui.date).food.push({
      id: uid(), meal: fd.get('meal') || mealByTime(), name: String(fd.get('name')).trim(),
      kcal: Math.max(0, Math.round(num(fd.get('kcal')) || 0)), at: Date.now(),
      ...(f.dataset.ai ? { ai: true } : {}),
    });
    if (f.dataset.ai) data.aiPhotos = (data.aiPhotos || 0) + 1;
    closeSheet();
    commit();
    toast(t('saved'));
  },
  sport: (f, fd) => {
    const type = fd.get('type'), min = Math.max(1, Math.round(num(fd.get('min')) || 0));
    getDay(ui.date).sport.push({ id: uid(), type, min, kcal: H.sportKcal(type, min) });
    closeSheet();
    commit();
    toast(t('saved'));
  },
  sleep: (f, fd) => {
    getDay(ui.date).sleep = { bed: fd.get('bed'), wake: fd.get('wake'), quality: Number(fd.get('quality')) || 3 };
    commit();
    toast(t('saved'));
  },
  diary: (f, fd) => {
    const note = String(fd.get('note') || '').trim();
    const mood = Number(fd.get('mood')) || 0;
    if (!mood && !note) { toast(t('diary_empty')); return; }
    getDay(ui.date).diary = { mood, energy: Number(fd.get('energy')) || 0, stress: Number(fd.get('stress')) || 0, note };
    commit();
    toast(t('saved'));
  },
  weight: (f, fd) => {
    const kg = U.showToKg(num(fd.get('w')));
    if (!(kg > 20 && kg < 350)) { toast(t('bad_weight')); return; }
    upsertWeight(todayKey(), kg);
    commit();
    toast(t('saved'));
  },
  habit: (f, fd) => {
    const name = String(fd.get('name')).trim();
    if (!name) return;
    data.habits.push({ id: uid(), emoji: String(fd.get('emoji') || '').trim() || '⭐', name, active: true, custom: true });
    commit();
    toast(t('saved'));
  },
  profile: (f, fd) => {
    const isOnb = !data.profile;
    const prevW = H.currentWeight();
    const heightCm = U.isUS() ? U.ftInToCm(num(fd.get('ft')) || 0, num(fd.get('in')) || 0) : num(fd.get('cm'));
    const w = U.showToKg(num(fd.get('w')));
    const tw = num(fd.get('tw'));
    if (!fd.get('sex')) { toast(t('pick_sex')); return; }
    if (!(heightCm >= 90 && heightCm <= 250)) { toast(t('bad_height')); return; }
    if (!(w > 20 && w < 350)) { toast(t('bad_weight')); return; }
    data.profile = {
      name: String(fd.get('name')).trim(), sex: fd.get('sex'), age: Math.round(num(fd.get('age'))),
      heightCm: Math.round(heightCm * 10) / 10, weightKg: w, targetKg: tw > 0 ? U.showToKg(tw) : null,
      goal: fd.get('goal') || 'keep', activity: Number(fd.get('activity')) || 1.375,
      allergies: String(fd.get('allergies') || '').trim(), dislikes: String(fd.get('dislikes') || '').trim(),
      diet: String(fd.get('diet') || '').trim(),
    };
    if (isOnb || Math.abs(w - prevW) > 0.05) upsertWeight(todayKey(), w);
    if (isOnb) {
      save();
      location.hash = '#/today';
      toast(t('welcome_toast'));
      return;
    }
    commit();
    toast(t('saved'));
  },
  plan: (f, fd) => {
    const meals = PL.MEALS.filter(m => fd.getAll('meals').includes(m));
    if (!meals.length) { toast(t('pick_meals')); return; }
    const servings = Math.min(12, Math.max(1, Math.round(num(fd.get('servings')) || 1)));
    data.planPrefs = { servings, meals };
    data.plan = PL.generatePlan({ servings, meals });
    data.plansMade = (data.plansMade || 0) + 1;
    data.shop = { planId: data.plan.id, checked: {} };
    commit();
    window.scrollTo(0, 0);
    toast(t('menu_ready'));
  },
  aiplan: (f, fd) => {
    const meals = PL.MEALS.filter(m => fd.getAll('meals').includes(m));
    if (!meals.length) { toast(t('pick_meals')); return; }
    const servings = Math.min(12, Math.max(1, Math.round(num(fd.get('servings')) || 1)));
    ui.aiWishes = String(fd.get('wishes') || '').trim();
    data.planPrefs = { servings, meals };
    save();
    runAiMenu(servings, meals, ui.aiWishes);
  },
  coach: (f, fd) => {
    const q = String(fd.get('q') || '').trim();
    if (q) coachAsk('ask', q);
  },
  aiset: (f, fd) => {
    data.settings.aiUrl = AI.normUrl(fd.get('aiUrl'));
    data.settings.aiCode = String(fd.get('aiCode') || '').trim();
    commit();
    toast(t('saved'));
  },
  recipe: (f, fd) => {
    const meals = PL.MEALS.filter(m => fd.getAll('meals').includes(m));
    if (!meals.length) { toast(t('pick_meals')); return; }
    const ingText = String(fd.get('ings') || '').trim();
    const rec = {
      id: f.dataset.id || uid(),
      emoji: String(fd.get('emoji') || '').trim() || '🍲',
      name: String(fd.get('name')).trim(),
      meals,
      time: Math.max(0, Math.round(num(fd.get('time')) || 0)),
      servings: Math.max(1, Math.round(num(fd.get('servings')) || 1)),
      kcal: Math.max(0, Math.round(num(fd.get('kcal')) || 0)),
      ingText,
      ings: ingText.split('\n').map(PL.parseIngLine).filter(Boolean),
      steps: String(fd.get('steps') || '').split('\n').map(s => s.trim()).filter(Boolean),
    };
    const i = data.recipes.findIndex(r => r.id === rec.id);
    if (i >= 0) data.recipes[i] = rec; else data.recipes.push(rec);
    save();
    const fresh = P.checkBadges();
    if (fresh.length) save();
    location.hash = '#/recipe/' + rec.id;
    toast(t('saved'));
    fresh.forEach((b, k) => setTimeout(() => toast(`${b.emoji} ${t('new_badge')}: ${nm(b.name)}`), 2000 + k * 2800));
  },
  settings: (f, fd) => {
    const s = data.settings;
    s.lang = fd.get('lang') || s.lang;
    s.units = fd.get('units') || s.units;
    s.tone = fd.get('tone') || s.tone;
    s.waterGoal = Math.min(30, Math.max(1, Math.round(num(fd.get('water')) || 8)));
    s.stepsGoal = Math.min(100000, Math.max(500, Math.round(num(fd.get('steps')) || 8000)));
    const k = Math.round(num(fd.get('kcal')));
    s.kcalGoal = k >= 800 ? k : null;
    commit();
    toast(t('saved'));
  },
};

// ================= ОТРИСОВКА =================
function route() {
  const [name, arg] = (location.hash.replace(/^#\/?/, '') || 'today').split('/');
  return { name, arg };
}
const SUBPAGES = ['coach', 'weight', 'habits', 'awards', 'profile', 'settings', 'backup', 'install'];
const FOODPAGES = ['food', 'menu', 'recipes', 'shop', 'recipe', 'recipe-edit'];
const TITLES = {
  menu: 'tab_food', recipes: 'tab_food', shop: 'tab_food', recipe: 'seg_recipes', 'recipe-edit': 'seg_recipes',
  today: 'tab_today', food: 'tab_food', sport: 'tab_sport', sleep: 'tab_sleep', more: 'tab_more',
  coach: 'coach_title', weight: 'weight_title', habits: 'habits_title', awards: 'awards_title', profile: 'profile_title',
  settings: 'settings_title', backup: 'backup_title', install: 'install_title', workout: 'workouts_title', onboarding: 'app_name',
};
function header(r) {
  $('#title').textContent = t(TITLES[r.name] || 'app_name');
  const back = SUBPAGES.includes(r.name) ? '#/more'
    : r.name === 'workout' ? '#/sport'
      : r.name === 'recipe' ? '#/recipes'
        : r.name === 'recipe-edit' ? (r.arg && r.arg !== 'new' ? '#/recipe/' + r.arg : '#/recipes')
          : null;
  const b = $('#back');
  b.hidden = !back;
  if (back) { b.href = back; b.setAttribute('aria-label', t('back')); }
  const showDate = ['today', 'food', 'sport', 'sleep'].includes(r.name);
  $('#datebar').innerHTML = showDate
    ? `<button data-act="date" data-n="-1" aria-label="${t('prev_day')}">‹</button>
       <span>${esc(dayLabel(ui.date))}</span>
       <button data-act="date" data-n="1" ${ui.date >= todayKey() ? 'disabled' : ''} aria-label="${t('next_day')}">›</button>`
    : '';
}
function updateNav(name) {
  const nav = $('#tabs');
  nav.hidden = name === 'onboarding';
  const active = SUBPAGES.includes(name) ? 'more' : name === 'workout' ? 'sport' : FOODPAGES.includes(name) ? 'food' : name;
  nav.querySelectorAll('a[data-tab]').forEach(a => {
    a.classList.toggle('on', a.dataset.tab === active);
    a.querySelector('.lb').textContent = t('tab_' + a.dataset.tab);
  });
}

const VIEWS = {
  today: vToday, food: vFood, sport: vSport, sleep: vSleep, more: vMore, weight: vWeight, habits: vHabits,
  awards: vAwards, profile: () => vProfile(false), onboarding: () => vProfile(true), settings: vSettings,
  backup: vBackup, install: vInstall, workout: vWorkout, coach: vCoach,
  menu: vMenu, shop: vShop, recipes: vRecipes, recipe: vRecipe, 'recipe-edit': vRecipeEdit,
};

function render() {
  const r = route();
  if (!data.profile && r.name !== 'onboarding') { location.replace('#/onboarding'); return; }
  if (data.profile && r.name === 'onboarding') { location.replace('#/today'); return; }
  if (wo && !(r.name === 'workout' && r.arg === wo.id)) cleanupWorkout();
  document.documentElement.lang = lang();
  document.title = t('app_name');
  header(r);
  updateNav(r.name);
  view.innerHTML = (VIEWS[r.name] || vToday)(r.arg);
  if (r.name === 'sleep') { const f = view.querySelector('form[data-form="sleep"]'); if (f) updateSleepPreview(f); }
  if (r.name === 'workout' && wo) drawPlayer();
  if (r.name === 'recipes') filterRecipes();
}

// ================= ЗАПУСК =================
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const fn = ACTIONS[el.dataset.act];
  if (fn) { e.preventDefault(); fn(el, e); }
});
document.addEventListener('submit', e => {
  const f = e.target;
  const fn = FORMS[f.dataset.form];
  if (fn) { e.preventDefault(); fn(f, new FormData(f)); }
});
document.addEventListener('input', e => {
  if (e.target.id === 'rsearch') { ui.rq = e.target.value; filterRecipes(); return; }
  const f = e.target.form;
  if (f?.dataset.form === 'sport') updateSportPreview(f);
  if (f?.dataset.form === 'sleep') updateSleepPreview(f);
});
document.addEventListener('change', e => {
  if (e.target.id === 'backup-file') { backupLoad(e.target.files[0]); e.target.value = ''; }
  if (e.target.id === 'photo-file') { photoPicked(e.target.files[0]); e.target.value = ''; }
  const f = e.target.form;
  if (f?.dataset.form === 'sport') updateSportPreview(f);
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#sheet').hidden) closeSheet(); });

window.addEventListener('hashchange', () => { closeSheet(); window.scrollTo(0, 0); render(); });

// Если программа была открыта со вчера — переключиться на новый день
let lastToday = todayKey();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  const tk = todayKey();
  if (tk !== lastToday) {
    if (ui.date === lastToday) ui.date = tk;
    lastToday = tk;
    if (!wo) render();
  }
  if (wo && !wo.done && !wo.paused) requestWake();
});

if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
  navigator.serviceWorker.register('./sw.js').catch(() => { /* без офлайна */ });
}

render();
