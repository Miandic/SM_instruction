/* Полноэкранная карточка (<dialog id="sheet">). Одна на всё приложение:
   ей пользуются и главная лендинга, и радиальное меню кабинета. */

import { $, bindActions } from './core.js';

const sheet = () => $('#sheet');

/** Длительность анимации закрытия (.sheet.is-closing) плюс запас. */
const CLOSE_MS = 240;
let closeTimer = null;

/**
 * Показывает карточку.
 * @param {string} html содержимое диалога целиком
 * @param {Record<string, Function>} actions обработчики data-act;
 *        `close` уже есть и ведёт «назад» — историю ведёт роутер
 */
export function openSheet(html, actions = {}) {
  const dlg = sheet();

  clearTimeout(closeTimer);
  dlg.classList.remove('is-closing');
  dlg.innerHTML = html;

  // навешиваем каждый раз: карточку открывают разные экраны со своими действиями
  bindActions(dlg, { close: () => history.back(), ...actions });

  if (!dlg.open) dlg.showModal();
  dlg.querySelector('.sheet__scroll')?.scrollTo({ top: 0 });
  return dlg;
}

export const isSheetOpen = () => sheet().open;

export function closeSheet() {
  const dlg = sheet();
  if (!dlg.open) return;

  const done = () => {
    clearTimeout(closeTimer);
    dlg.classList.remove('is-closing');
    if (dlg.open) dlg.close();
  };

  dlg.classList.add('is-closing');
  dlg.addEventListener('animationend', done, { once: true });
  // страховка: в фоновой вкладке анимация может не доиграть —
  // диалог всё равно обязан закрыться
  clearTimeout(closeTimer);
  closeTimer = setTimeout(done, CLOSE_MS);
}

/** Esc и клик по фону возвращают назад. Вызывается один раз при старте. */
export function initSheet() {
  const dlg = sheet();
  dlg.addEventListener('cancel', e => { e.preventDefault(); history.back(); });
  dlg.addEventListener('click', e => { if (e.target === dlg) history.back(); });
}

/** Шапка карточки с кнопкой «назад». */
export const sheetBar = () => `
  <div class="sheet__bar">
    <button class="btn btn--icon" data-act="close" aria-label="Закрыть">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
           stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18 9 12l6-6"/></svg>
    </button>
  </div>`;
