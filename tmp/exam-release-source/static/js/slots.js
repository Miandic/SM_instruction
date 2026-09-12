/* Правила бронирования на стороне фронта — общие для кабинета и главной.
   Это копия серверных проверок (src/handlers/booking.rs): здесь мы только
   не даём нажать заведомо отказную кнопку, решение всё равно за сервером. */

import { state, esc, fmtT, fmtDT } from './core.js';

/** За сколько секунд до начала слота открывается бронь (совпадает с бекендом). */
export const BOOKING_WINDOW = 15 * 60;

/** Разбирает брони команды в удобный для проверок вид. */
export function bookingCtx(myBookings = []) {
  const active = myBookings.filter(b => b.status === 'active');
  return {
    // на точку с активной или уже пройденной бронью второй раз не записаться
    visited: new Set(myBookings.filter(b => b.status !== 'cancelled').map(b => b.point_id)),
    completed: new Set(myBookings.filter(b => b.status === 'completed').map(b => b.point_id)),
    // Лимит «одна активная бронь» считают только обычные точки. Обязательные
    // (экзамен, босс, администрация) назначает админ, они идут параллельно —
    // иначе команда с ними не смогла бы записаться вообще никуда.
    active: active.find(b => !b.mandatory) || null,
    // назначенные админом брони: показываем их, но трогать нельзя
    fixed: active.filter(b => b.mandatory),
  };
}

/**
 * Состояние слота для отрисовки.
 * @returns {{state: 'mine'|'past'|'full'|'free', label: string,
 *            can?: 'book'|'busy'|'early', opensAt?: number}}
 */
export function slotStatus(slot, point, ctx, now = Date.now() / 1000, options = {}) {
  if (slot.mine) return { state: 'mine', label: 'ваша команда' };
  if (now >= slot.ends_at) return { state: 'past', label: 'завершён' };
  if (slot.booked >= slot.capacity) return { state: 'full', label: 'занято' };

  const free = {
    state: 'free',
    label: slot.capacity > 1 ? `свободно ${slot.capacity - slot.booked} из ${slot.capacity}` : 'свободно',
  };

  // на обязательные точки записывают организаторы; студент только смотрит
  const role = options.role || state.me.role;
  if (role !== 'leader' || point?.kind === 'mandatory' || ctx.visited.has(slot.point_id)) {
    return free;
  }
  if (ctx.active) return { ...free, can: 'busy' };
  if (now < slot.starts_at - BOOKING_WINDOW) {
    return { ...free, can: 'early', opensAt: slot.starts_at - BOOKING_WINDOW };
  }
  return { ...free, can: 'book' };
}

/** Кнопка брони по состоянию слота. Пустая строка — кнопки нет. */
export function bookButton(st, slot, readOnly = false) {
  const cls = 'btn btn--sm';
  switch (st.can) {
    case 'book':
      return `<button class="${cls} btn--primary" data-act="book" data-id="${slot.id}"
              ${readOnly ? 'disabled title="предпросмотр без изменения данных"' : ''}>Занять</button>`;
    case 'busy':
      return `<button class="${cls}" disabled title="у команды уже есть активная бронь">Занять</button>`;
    case 'early':
      return `<button class="${cls}" disabled>с ${fmtT(st.opensAt)}</button>`;
    default:
      return '';
  }
}

/**
 * Расписание точки блоками. Прошедшие слоты не показываем — список начинается
 * с первого ещё живого и дальше идёт в будущее независимо от занятости.
 * Исключение — свой слот: собственная бронь из расписания пропадать не должна.
 */
export function slotChips(slots, point, ctx, now = Date.now() / 1000, options = {}) {
  if (!slots.length) return '<p class="note">Слотов пока нет.</p>';

  const visible = slots.filter(s => now < s.ends_at || s.mine);
  if (!visible.length) return '<p class="note">Все слоты этой точки уже прошли.</p>';

  return `<div class="slots">${visible.map(s => slotChip(s, point, ctx, now, options)).join('')}</div>`;
}

function slotChip(s, point, ctx, now, options) {
  const st = slotStatus(s, point, ctx, now, options);
  const sameDay = new Date(s.starts_at * 1000).toDateString() === new Date(now * 1000).toDateString();
  const time = `${sameDay ? fmtT(s.starts_at) : fmtDT(s.starts_at)}–${fmtT(s.ends_at)}`;

  // свою бронь снимают прямо из блока; обязательную не отменить — её в ctx.active нет
  const isLeader = (options.role || state.me.role) === 'leader';
  const action = ctx.active?.slot_id === s.id && isLeader
    ? `<button class="btn btn--sm btn--danger" data-act="cancel" data-id="${ctx.active.id}"
         ${options.readOnly ? 'disabled title="предпросмотр без изменения данных"' : ''}>Отменить</button>`
    : bookButton(st, s, options.readOnly);

  return `<div class="slot slot--${st.state}">
    <span class="slot__time">${time}</span>
    <span class="slot__state">${esc(st.label)}</span>
    ${action}
  </div>`;
}
