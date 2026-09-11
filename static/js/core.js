/* Общие утилиты: состояние сессии, вызовы API, форматирование, делегирование
   событий. Никакой разметки — только инфраструктура. */

export const $ = s => document.querySelector(s);

/** Экранирование для вставки в HTML. Значения в data-* атрибутах читаются
    через dataset, поэтому кавычки в них безопасны. */
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const fmtT = ts => new Date(ts * 1000)
  .toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

export const fmtDT = ts => new Date(ts * 1000)
  .toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export const ROLE_LABELS = { admin: 'Админ', leader: 'Староста', student: 'Студент', organizer: 'Организатор' };
export const STATUS_LABELS = { active: 'активна', completed: 'пройдена', cancelled: 'отменена' };

/** Типы точек. noc — две оценки, activity — одна, mandatory — без баллов. */
export const KIND_LABELS = { noc: 'НОЦ', activity: 'Активность', mandatory: 'Обязательная' };
export const SCORE_KIND_LABELS = { test: 'тест', task: 'прохождение', manual: 'вручную' };

/** Состояние сессии. */
export const state = {
  token: localStorage.getItem('token'),
  me: null,
  cache: { groups: [], points: [], characters: [] },
};

/** Партнёрский демо-аккаунт — служебный студент без учебной группы. */
export const isPartnerDemo = me => !!me && me.role === 'student' && !me.group_id;

/** Подпись роли учитывает служебный партнёрский аккаунт. */
export const roleLabel = me => isPartnerDemo(me) ? 'Партнёр (демо)' : ROLE_LABELS[me?.role] || me?.role || '';

/** Игрок — староста или студент: у них главная с радиальным меню. */
export const isPlayer = me => !!me && (me.role === 'leader' || me.role === 'student');

/** Куда ведёт «домой» вошедшего: игроков — на главную, остальных — в кабинет. */
export const homeRoute = () => (isPlayer(state.me) ? '#/home' : '#/app');

export function setSession(d) {
  state.token = d.token;
  state.me = d.user;
  localStorage.setItem('token', d.token);
}

export function clearSession() {
  state.token = null;
  state.me = null;
  localStorage.removeItem('token');
}

/** Единая точка обращения к API. Бросает Error с текстом из {"error": "..."}. */
export async function api(path, method = 'GET', body) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.token) headers['Authorization'] = 'Bearer ' + state.token;
  const res = await fetch('/api' + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && state.me) {
    clearSession();
    location.hash = '#/auth';
    throw new Error('сессия истекла — войдите заново');
  }
  if (!res.ok) throw new Error(data.error || 'ошибка ' + res.status);
  return data;
}

/** Multipart-запрос для загрузки файлов. Content-Type выставляет браузер вместе с boundary. */
export async function apiForm(path, formData) {
  const headers = {};
  if (state.token) headers.Authorization = 'Bearer ' + state.token;
  const res = await fetch('/api' + path, { method: 'POST', headers, body: formData });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && state.me) {
    clearSession();
    location.hash = '#/auth';
    throw new Error('сессия истекла — войдите заново');
  }
  if (!res.ok) throw new Error(data.error || 'ошибка ' + res.status);
  return data;
}

// ---------- всплывающие уведомления ----------

let flashTimer = null;

export function flash(msg, isErr = false) {
  const el = $('#flash');
  el.textContent = msg;
  el.className = 'flash show' + (isErr ? ' flash--err' : ' flash--ok');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { el.className = 'flash'; }, 4500);
}

/** Обёртка для обработчиков: показывает ошибку вместо падения в консоль. */
export const guard = fn => async (...args) => {
  try { await fn(...args); } catch (err) { flash(err.message, true); }
};

// ---------- подтверждения ----------
//
// window.confirm/prompt использовать нельзя. Во встроенных браузерах
// (мессенджеры, webview) они подавляются: confirm молча возвращает false,
// prompt бросает «not supported» — и кнопка выглядит сломанной, хотя код цел.
// Поэтому свой диалог: он же одинаково выглядит на всех платформах.

/** Общая обвязка: показывает <dialog> и резолвится ответом. */
function modal(bodyHtml, wire) {
  return new Promise(resolve => {
    const dlg = document.createElement('dialog');
    dlg.className = 'ask';
    dlg.innerHTML = bodyHtml;
    document.body.append(dlg);

    // Закрыть обязательно до удаления: иначе диалог остаётся в top layer,
    // его невидимый backdrop продолжает ловить клики — и вся страница
    // выглядит «залипшей». Событию `close` при этом не доверяем, снимаем сами.
    const done = value => { dlg.close(); dlg.remove(); resolve(value); };

    dlg.addEventListener('click', e => { if (e.target === dlg) done(null); });
    dlg.addEventListener('cancel', e => { e.preventDefault(); done(null); });

    wire(dlg, done);
    dlg.showModal();
  });
}

/** Замена confirm(). @returns {Promise<boolean>} */
export async function ask(message, { ok = 'Да', cancel = 'Отмена', danger = false } = {}) {
  const answer = await modal(`
    <p class="ask__text">${esc(message)}</p>
    <div class="ask__row">
      <button class="btn" data-no>${esc(cancel)}</button>
      <button class="btn ${danger ? 'btn--danger' : 'btn--primary'}" data-yes>${esc(ok)}</button>
    </div>`, (dlg, done) => {
    dlg.querySelector('[data-no]').addEventListener('click', () => done(false));
    const yes = dlg.querySelector('[data-yes]');
    yes.addEventListener('click', () => done(true));
    yes.focus();
  });
  return answer === true;
}

/** Замена prompt(). @returns {Promise<string|null>} null — отказались */
export function askText(message, { value = '', ok = 'Сохранить', type = 'text' } = {}) {
  return modal(`
    <form class="ask__form">
      <label class="field">
        <span>${esc(message)}</span>
        <input name="v" type="${esc(type)}" value="${esc(value)}" autocomplete="off">
      </label>
      <div class="ask__row">
        <button type="button" class="btn" data-no>Отмена</button>
        <button class="btn btn--primary">${esc(ok)}</button>
      </div>
    </form>`, (dlg, done) => {
    const form = dlg.querySelector('form');
    form.addEventListener('submit', e => { e.preventDefault(); done(form.elements.v.value); });
    dlg.querySelector('[data-no]').addEventListener('click', () => done(null));
    form.elements.v.focus();
    form.elements.v.select();
  });
}

// ---------- делегирование событий ----------
//
// Вместо inline-onclick с подстановкой данных в строку используем
// data-act + dataset. Разметка при этом не может «сломаться» текстом
// пользователя (имя со скобкой или кавычкой больше ничего не ломает).

// Контейнеры (#view, #sheet) переживают перерисовку: innerHTML меняет только
// потомков. Поэтому слушатель, навешенный повторно, накапливался бы, и один
// клик слал бы несколько запросов. Храним предыдущий и снимаем его.
const boundClicks = new WeakMap();
const boundSubmits = new WeakMap();

/** @param {Element} root  @param {Record<string, Function>} handlers */
export function bindActions(root, handlers) {
  const prev = boundClicks.get(root);
  if (prev) root.removeEventListener('click', prev);

  const listener = e => {
    const btn = e.target.closest('[data-act]');
    if (!btn || !root.contains(btn)) return;
    const fn = handlers[btn.dataset.act];
    if (!fn) return;
    e.preventDefault();
    guard(fn)(btn.dataset, btn);
  };

  boundClicks.set(root, listener);
  root.addEventListener('click', listener);
}

/** @param {Element} root  @param {Record<string, Function>} handlers */
export function bindForms(root, handlers) {
  const prev = boundSubmits.get(root);
  if (prev) root.removeEventListener('submit', prev);

  const listener = e => {
    const form = e.target.closest('[data-form]');
    if (!form || !root.contains(form)) return;
    e.preventDefault();
    const fn = handlers[form.dataset.form];
    if (!fn) return;
    guard(fn)(Object.fromEntries(new FormData(form)), form);
  };

  boundSubmits.set(root, listener);
  root.addEventListener('submit', listener);
}

/** Числовые поля формы: приводит перечисленные ключи к Number. */
export function nums(obj, ...keys) {
  for (const k of keys) if (obj[k] !== undefined && obj[k] !== '') obj[k] = Number(obj[k]);
  return obj;
}
