/* Экран входа и регистрации. */

import { $, api, esc, state, setSession, flash, homeRoute, bindActions, bindForms } from './core.js';

let mode = 'login'; // login | register
let regRole = 'leader';

export async function renderAuth(host) {
  const [groups, points] = await Promise.all([api('/groups'), api('/points')]);
  state.cache.groups = groups;
  state.cache.points = points;

  host.innerHTML = `
    <section class="wrap section auth">
      <a class="backlink" href="#/">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
             stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18 9 12l6-6"/></svg>
        На главную
      </a>

      <div class="panel">
        <div class="segmented" role="tablist">
          <button role="tab" class="segmented__btn" data-act="mode" data-mode="login">Вход</button>
          <button role="tab" class="segmented__btn" data-act="mode" data-mode="register">Регистрация</button>
        </div>
        <div id="authform"></div>
      </div>
    </section>`;

  bindActions(host, {
    mode: ({ mode: m }) => { mode = m; renderForm(); },
    role: ({ role }) => { regRole = role; renderForm(); },
  });

  bindForms(host, {
    login: async f => {
      setSession(await api('/auth/login', 'POST', f));
      location.hash = homeRoute();
    },
    register: async f => {
      setSession(await api('/auth/register', 'POST', registerBody(f)));
      flash('Аккаунт создан');
      location.hash = homeRoute();
    },
  });

  renderForm();
}

/** Собирает тело запроса: набор полей у организатора и у команды разный. */
function registerBody(f) {
  const body = {
    login: f.login.trim(),
    password: f.password,
    role: f.role,
    code: f.code.trim(),
  };

  if (f.role === 'organizer') {
    // Точку определяет код; отдельного поля имени в форме пока нет — берём логин.
    body.display_name = body.login;
  } else {
    body.display_name = `${f.first_name.trim()} ${f.last_name.trim()}`.trim();
    body.group_name = f.group_name;
  }

  return body;
}

function renderForm() {
  document.querySelectorAll('.segmented__btn').forEach(b =>
    b.classList.toggle('is-active', b.dataset.mode === mode));

  $('#authform').innerHTML = mode === 'login' ? loginForm() : registerForm();

  if (mode === 'register') {
    const sel = $('#group-sel');
    if (sel) sel.addEventListener('change', updateLeaderHint);
    updateLeaderHint();
  }
}

/** Предупреждение, если у выбранной группы уже есть староста. */
function updateLeaderHint() {
  const hint = $('#leader-hint');
  const sel = $('#group-sel');
  if (!hint || !sel) return;
  const group = state.cache.groups.find(g => g.name === sel.value);
  hint.hidden = !(regRole === 'leader' && group?.has_leader);
}

const loginForm = () => `
  <form data-form="login" class="form">
    <label class="field">
      <span>Логин</span>
      <input name="login" autocomplete="username" required>
    </label>
    <label class="field">
      <span>Пароль</span>
      <input name="password" type="password" autocomplete="current-password" required>
    </label>
    <button class="btn btn--primary btn--lg btn--block">Войти</button>
  </form>`;

const ROLES = [
  ['leader', 'Староста'],
  ['student', 'Студент'],
  ['organizer', 'Организатор'],
];

function registerForm() {
  const isOrganizer = regRole === 'organizer';

  const roles = `
    <div class="field">
      <span>Кто ты</span>
      <div class="roles">
        ${ROLES.map(([v, title]) => `
          <label class="role ${v === regRole ? 'is-active' : ''}" data-act="role" data-role="${v}">
            <input type="radio" name="role" value="${v}" ${v === regRole ? 'checked' : ''} tabindex="-1">
            <b>${title}</b>
          </label>`).join('')}
      </div>
    </div>`;

  const group = `
    <div class="field">
      <span>Группа</span>
      <select name="group_name" id="group-sel" required>
        ${state.cache.groups.map(g => `<option value="${esc(g.name)}">${esc(g.name)}</option>`).join('')}
      </select>
      <p class="hint" id="leader-hint" hidden>
        <span class="hint__marker" aria-hidden="true"></span>
        Аккаунт старосты для этой группы уже создан.
        Если это не вы — обратитесь к организаторам.
      </p>
    </div>`;

  const credentials = `
    <label class="field">
      <span>Логин</span>
      <input name="login" minlength="3" autocomplete="username" required>
    </label>
    <label class="field">
      <span>Пароль</span>
      <input name="password" type="password" minlength="6" autocomplete="new-password" required>
    </label>`;

  const fio = `
    <label class="field">
      <span>Имя</span>
      <input name="first_name" autocomplete="given-name" required>
    </label>
    <label class="field">
      <span>Фамилия</span>
      <input name="last_name" autocomplete="family-name" required>
    </label>`;

  const code = `
    <label class="field">
      <span>${isOrganizer ? 'Код организатора' : 'Код регистрации'}</span>
      <input name="code" autocomplete="off" ${isOrganizer ? 'required' : ''}>
    </label>`;

  return `
    <form data-form="register" class="form">
      ${roles}
      ${isOrganizer ? '' : group}
      ${credentials}
      ${isOrganizer ? code : `${fio}${code}`}
      <button class="btn btn--primary btn--lg btn--block">Создать аккаунт</button>
    </form>`;
}
