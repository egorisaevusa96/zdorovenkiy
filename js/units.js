// Единицы измерения. Внутри всё храним в метрической системе (кг, см, г, мл),
// а показываем так, как выбрано в настройках.
import { data } from './store.js';
import { t } from './i18n.js';

export const KG_TO_LB = 2.2046226218;
export const CM_PER_IN = 2.54;
export const G_PER_OZ = 28.3495;
export const ML_PER_FLOZ = 29.5735;

export const isUS = () => data.settings.units === 'us';

const round1 = n => Math.round(n * 10) / 10;

// Вес
export const kgToShow = kg => round1(isUS() ? kg * KG_TO_LB : kg);
export const showToKg = v => (isUS() ? v / KG_TO_LB : v);
export const weightUnit = () => (isUS() ? t('u_lb') : t('u_kg'));
export const fmtWeight = kg => `${kgToShow(kg)} ${weightUnit()}`;

// Рост
export function fmtHeight(cm) {
  if (!isUS()) return `${Math.round(cm)} ${t('u_cm')}`;
  const totalIn = Math.round(cm / CM_PER_IN);
  return `${Math.floor(totalIn / 12)}′${totalIn % 12}″`;
}
export function cmToFtIn(cm) {
  const totalIn = Math.round(cm / CM_PER_IN);
  return { ft: Math.floor(totalIn / 12), inch: totalIn % 12 };
}
export const ftInToCm = (ft, inch) => (ft * 12 + inch) * CM_PER_IN;

// Порции еды
export const fmtMass = g => (isUS() ? `${round1(g / G_PER_OZ)} ${t('u_oz')}` : `${g} ${t('u_g')}`);
export const fmtVolume = ml => (isUS() ? `${Math.round(ml / ML_PER_FLOZ)} ${t('u_floz')}` : `${ml} ${t('u_ml')}`);

// Количество продукта для рецепта или списка покупок (shop = округлять для магазина)
function frac(n) {
  const whole = Math.floor(n + 1e-9), rest = n - whole;
  const map = [[0.25, '¼'], [0.33, '⅓'], [0.5, '½'], [0.67, '⅔'], [0.75, '¾']];
  for (const [v, s] of map) if (Math.abs(rest - v) < 0.04) return (whole ? whole : '') + s;
  return String(Math.round(n * 10) / 10);
}
export function fmtAmount(q, u, shop = false) {
  if (u === 'taste' || !q) return t('to_taste');
  if (u === 'g') {
    if (isUS()) {
      const oz = q / G_PER_OZ;
      if (oz >= 16) return `${(shop ? Math.ceil(oz / 16 * 10) / 10 : round1(oz / 16))} ${t('u_lb')}`;
      return `${shop ? Math.max(1, Math.ceil(oz)) : round1(oz)} ${t('u_oz')}`;
    }
    const g = shop ? (q >= 500 ? Math.ceil(q / 50) * 50 : Math.ceil(q / 10) * 10) : Math.round(q / 5) * 5 || Math.round(q);
    return g >= 1000 ? `${round1(g / 1000)} ${t('u_kg')}` : `${g} ${t('u_g')}`;
  }
  if (u === 'ml') {
    if (isUS()) return `${shop ? Math.ceil(q / ML_PER_FLOZ) : round1(q / ML_PER_FLOZ)} ${t('u_floz')}`;
    const ml = shop ? Math.ceil(q / 10) * 10 : Math.round(q / 5) * 5 || Math.round(q);
    return ml >= 1000 ? `${round1(ml / 1000)} ${t('u_l')}` : `${ml} ${t('u_ml')}`;
  }
  const n = shop && (u === 'pcs' || u === 'clove') ? Math.ceil(q - 1e-9) : q;
  return `${frac(n)} ${t('u_' + u)}`;
}

// Вода: 1 стакан = 250 мл (или 8 fl oz)
export const glassLabel = () => (isUS() ? `8 ${t('u_floz')}` : `250 ${t('u_ml')}`);
export function fmtWaterTotal(glasses) {
  if (isUS()) return `${glasses * 8} ${t('u_floz')}`;
  return `${round1(glasses * 0.25)} ${t('u_l')}`;
}
