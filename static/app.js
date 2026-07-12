'use strict';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtT = ts => new Date(ts * 1000).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
const fmtDT = ts => new Date(ts * 1000).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const ROLE_LABELS = { admin: 'Админ', leader: 'Староста', student: 'Студент', organizer: 'Организатор' };
const STATUS_LABELS = { active: 'активна', completed: 'пройдена', cancelled: 'отменена' };

let token = localStorage.getItem('token');
let me = null;
let currentTab = null;
const cache = { groups: [], points: [], characters: [] };

async function api(path, method = 'GET', body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch('/api' + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && me) { doLogout(); throw new Error('сессия истекла'); }
  if (!res.ok) throw new Error(data.error || 'ошибка ' + res.status);
  return data;
}

function flash(msg, isErr = false) {
  const el = $('#flash');
  el.textContent = msg;
  el.className = isErr ? 'err' : 'ok';
  clearTimeout(flash._t);
  flash._t = setTimeout(() => { el.className = ''; }, 5000);
}

// ---------- вход и регистрация ----------

async function renderAuth() {
  $('#userbox').innerHTML = '';
  $('#tabs').innerHTML = '';
  [cache.groups, cache.points] = await Promise.all([api('/groups'), api('/points')]);
  $('#app').innerHTML = `
    <div class="auth">
      <div class="card">
        <h2>Вход</h2>
        <form onsubmit="return doLogin(event)">
          <input name="login" placeholder="Логин" required>
          <input name="password" type="password" placeholder="Пароль" required>
          <button>Войти</button>
        </form>
      </div>
      <div class="card">
        <h2>Регистрация</h2>
        <form onsubmit="return doRegister(event)">
          <input name="login" placeholder="Логин (мин. 3 символа)" required>
          <input name="password" type="password" placeholder="Пароль (мин. 6 символов)" required>
          <input name="display_name" placeholder="Ваше имя" required>
          <select name="role" onchange="regRoleChanged(this.value)">
            <option value="leader">Староста (бронирует точки за команду)</option>
            <option value="student">Студент (только просмотр)</option>
            <option value="organizer">Организатор точки</option>
          </select>
          <span id="reg-extra"></span>
          <input name="code" placeholder="Код регистрации (если требуется)">
          <button>Создать аккаунт</button>
        </form>
      </div>
    </div>`;
  regRoleChanged('leader');
}

function regRoleChanged(role) {
  const box = $('#reg-extra');
  if (role === 'organizer') {
    box.innerHTML = `<select name="point_id" required>` +
      cache.points.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('') +
      `</select>`;
    if (!cache.points.length) box.innerHTML = `<p class="muted">Точек пока нет — их создаёт админ.</p>`;
  } else {
    box.innerHTML = `<select name="group_name" required>` +
      cache.groups.map(g =>
        `<option value="${esc(g.name)}" ${role === 'leader' && g.has_leader ? 'disabled' : ''}>` +
        `${esc(g.name)}${g.has_leader ? ' — староста уже есть' : ''}</option>`).join('') +
      `</select>`;
  }
}

async function doLogin(e) {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  try {
    const d = await api('/auth/login', 'POST', f);
    setSession(d);
  } catch (err) { flash(err.message, true); }
  return false;
}

async function doRegister(e) {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  if (f.point_id) f.point_id = Number(f.point_id);
  if (!f.code) delete f.code;
  try {
    const d = await api('/auth/register', 'POST', f);
    setSession(d);
    flash('Аккаунт создан!');
  } catch (err) { flash(err.message, true); }
  return false;
}

function setSession(d) {
  token = d.token;
  me = d.user;
  localStorage.setItem('token', token);
  renderApp();
}

async function doLogout() {
  try { await api('/auth/logout', 'POST', {}); } catch (_) { /* не критично */ }
  token = null; me = null;
  localStorage.removeItem('token');
  renderAuth();
}

// ---------- каркас приложения ----------

function renderApp() {
  $('#userbox').innerHTML =
    `<b>${esc(me.display_name)}</b> — ${ROLE_LABELS[me.role] || esc(me.role)}` +
    (me.group_name ? `, ${esc(me.group_name)}` : '') +
    (me.point_name ? `, точка «${esc(me.point_name)}»` : '') +
    ` <button class="plain" onclick="doLogout()">Выйти</button>`;

  const tabs = [];
  if (me.role !== 'organizer') tabs.push(['points', 'Точки и слоты']);
  if (me.group_id) tabs.push(['team', 'Моя команда']);
  tabs.push(['rating', 'Рейтинг']);
  if (me.role === 'organizer') tabs.push(['org', 'Моя точка']);
  if (me.role === 'admin') tabs.push(['admin', 'Админка']);

  $('#tabs').innerHTML = tabs.map(([id, label]) =>
    `<button id="tab-${id}" onclick="showTab('${id}')">${label}</button>`).join('');
  showTab(tabs[0][0]);
}

const RENDERERS = {};

async function showTab(id) {
  currentTab = id;
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('active', b.id === 'tab-' + id));
  try { await RENDERERS[id](); } catch (err) { flash(err.message, true); }
}

// авто-обновление сеток без форм, чтобы не сбивать ввод
setInterval(() => {
  if (me && (currentTab === 'points' || currentTab === 'rating')) {
    RENDERERS[currentTab]().catch(() => {});
  }
}, 20000);

// ---------- точки и слоты ----------

RENDERERS.points = async () => {
  const [points, slots, myBookings] = await Promise.all([
    api('/points'), api('/slots'),
    me.group_id ? api('/bookings/my') : [],
  ]);
  cache.points = points;
  const now = Date.now() / 1000;
  const byPoint = {};
  for (const s of slots) (byPoint[s.point_id] ??= []).push(s);

  // правила бэка: точку дважды не проходят, одна активная бронь на команду
  const visited = new Set(myBookings.filter(b => b.status !== 'cancelled').map(b => b.point_id));
  const completed = new Set(myBookings.filter(b => b.status === 'completed').map(b => b.point_id));
  const activeBooking = myBookings.find(b => b.status === 'active');

  const notice = activeBooking ? `
    <div class="card notice">Активная бронь: <b>${esc(activeBooking.point_name)}</b>,
      ${fmtDT(activeBooking.starts_at)}–${fmtT(activeBooking.ends_at)}.
      ${me.role === 'leader' ? 'Новую точку можно занять после завершения или отмены этой (вкладка «Моя команда»).' : ''}
    </div>` : '';

  $('#app').innerHTML = notice + points.map(p => `
    <div class="card">
      <h3>${esc(p.name)}${completed.has(p.id) ? '<span class="badge done">пройдена ✓</span>'
        : activeBooking?.point_id === p.id ? '<span class="badge current">активная бронь</span>' : ''}</h3>
      ${p.location ? `<div class="muted">Где: ${esc(p.location)}</div>` : ''}
      ${p.description ? `<p>${esc(p.description)}</p>` : ''}
      <div class="slots">${(byPoint[p.id] || []).map(s => slotChip(s, now, visited, !!activeBooking)).join('')
        || '<span class="muted">слотов пока нет</span>'}</div>
    </div>`).join('') || '<p class="muted">Точки ещё не добавлены.</p>';
};

function slotChip(s, now, visited = new Set(), hasActive = false) {
  const sameDay = new Date(s.starts_at * 1000).toDateString() === new Date(now * 1000).toDateString();
  const time = `${sameDay ? fmtT(s.starts_at) : fmtDT(s.starts_at)}–${fmtT(s.ends_at)}`;
  let cls = 'slot', label = '', btn = '';
  if (s.mine) { cls += ' mine'; label = 'ваша команда'; }
  else if (now >= s.ends_at) { cls += ' past'; label = 'завершён'; }
  else if (s.booked >= s.capacity) { cls += ' full'; label = 'занято'; }
  else {
    label = s.capacity > 1 ? `свободно ${s.capacity - s.booked} из ${s.capacity}` : 'свободно';
    if (me.role === 'leader' && !visited.has(s.point_id)) {
      btn = hasActive
        ? `<button disabled title="у команды уже есть активная бронь">Занять</button>`
        : now < s.starts_at - 900
          ? `<button disabled title="бронь откроется за 15 минут до начала">бронь с ${fmtT(s.starts_at - 900)}</button>`
          : `<button onclick="book(${s.id})">Занять</button>`;
    }
  }
  return `<span class="${cls}"><b>${time}</b> ${label}${btn}</span>`;
}

async function book(slotId) {
  try {
    await api('/bookings', 'POST', { slot_id: slotId });
    flash('Слот забронирован!');
    showTab('points');
  } catch (err) { flash(err.message, true); }
}

// ---------- моя команда ----------

RENDERERS.team = async () => {
  const d = await api('/groups/' + me.group_id);
  const g = d.group;

  let charBlock;
  if (g.character_name) {
    charBlock = `<p>Персонаж: <b>${esc(g.character_name)}</b>, уровень <b>${g.level}</b> (${g.total_points} баллов)</p>`;
  } else if (me.role === 'leader') {
    if (!cache.characters.length) cache.characters = await api('/characters');
    charBlock = `<p>Персонаж не выбран:
      <select id="char-sel">${cache.characters.map(c =>
        `<option value="${c.id}">${esc(c.name)} — ${esc(c.description)}</option>`).join('')}</select>
      <button onclick="pickCharacter()">Выбрать</button><br>
      <span class="muted">Выбор окончательный — поменять сможет только админ.</span></p>`;
  } else {
    charBlock = `<p class="muted">Персонаж ещё не выбран старостой. Баллы: ${g.total_points}.</p>`;
  }

  const bookings = d.bookings.map(b => `
    <tr>
      <td>${fmtDT(b.starts_at)}–${fmtT(b.ends_at)}</td>
      <td>${esc(b.point_name)}</td>
      <td class="status-${b.status}">${STATUS_LABELS[b.status]}</td>
      <td>${b.status === 'active' && me.role === 'leader'
        ? `<button class="danger" onclick="cancelBooking(${b.id})">Отменить</button>` : ''}</td>
    </tr>`).join('');

  const scores = d.scores.map(s => `
    <tr>
      <td>${fmtDT(s.created_at)}</td>
      <td>${esc(s.point_name)}</td>
      <td><b>+${s.points}</b></td>
      <td>${esc(s.comment)}</td>
    </tr>`).join('');

  $('#app').innerHTML = `
    <div class="card">
      <h3>${esc(g.name)} (кафедра СМ${g.department})</h3>
      ${charBlock}
    </div>
    <div class="card">
      <h3>Брони</h3>
      ${bookings ? `<table><tr><th>Время</th><th>Точка</th><th>Статус</th><th></th></tr>${bookings}</table>`
        : '<p class="muted">Броней пока нет. Староста может занять слот на вкладке «Точки и слоты».</p>'}
    </div>
    <div class="card">
      <h3>Баллы</h3>
      ${scores ? `<table><tr><th>Когда</th><th>Точка</th><th>Баллы</th><th>Комментарий</th></tr>${scores}</table>`
        : '<p class="muted">Баллов пока нет.</p>'}
    </div>`;
};

async function pickCharacter() {
  try {
    await api('/character', 'POST', { character_id: Number($('#char-sel').value) });
    flash('Персонаж выбран!');
    showTab('team');
  } catch (err) { flash(err.message, true); }
}

async function cancelBooking(id) {
  if (!confirm('Отменить бронь?')) return;
  try {
    await api('/bookings/' + id, 'DELETE');
    flash('Бронь отменена');
    showTab('team');
  } catch (err) { flash(err.message, true); }
}

// ---------- рейтинг ----------

RENDERERS.rating = async () => {
  const rows = await api('/rating');
  $('#app').innerHTML = `
    <div class="card">
      <h3>Рейтинг команд</h3>
      <table>
        <tr><th>#</th><th>Команда</th><th>Кафедра</th><th>Персонаж</th><th>Уровень</th><th>Баллы</th></tr>
        ${rows.map((r, i) => `
          <tr class="${r.id === me.group_id ? 'me' : ''}">
            <td>${i + 1}</td>
            <td>${esc(r.name)}</td>
            <td>СМ${r.department}</td>
            <td>${esc(r.character_name ?? '—')}</td>
            <td>${r.level}</td>
            <td><b>${r.total_points}</b></td>
          </tr>`).join('')}
      </table>
    </div>`;
};

// ---------- организатор ----------

RENDERERS.org = async () => {
  const rows = await api('/organizer/bookings');
  $('#app').innerHTML = `
    <div class="card">
      <h3>Записи на точку «${esc(me.point_name ?? '')}»</h3>
      ${rows.length ? `
        <table>
          <tr><th>Время</th><th>Команда</th><th>Статус</th><th>Баллы</th></tr>
          ${rows.map(b => `
            <tr>
              <td>${fmtDT(b.starts_at)}–${fmtT(b.ends_at)}</td>
              <td><b>${esc(b.group_name)}</b></td>
              <td class="status-${b.status}">${STATUS_LABELS[b.status]}</td>
              <td>${b.status === 'active' ? `
                <input type="number" id="pts-${b.id}" value="10" min="0" max="1000" style="width:70px">
                <input id="cmt-${b.id}" placeholder="комментарий" style="width:160px">
                <button onclick="completeVisit(${b.id})">Завершить визит</button>`
                : `+${b.points ?? 0}`}</td>
            </tr>`).join('')}
        </table>`
        : '<p class="muted">Записей пока нет.</p>'}
      <p class="muted">Список обновляется при переключении вкладки — или нажмите
        <button class="plain" onclick="showTab('org')">Обновить</button></p>
    </div>`;
};

async function completeVisit(bookingId) {
  try {
    const points = Number($('#pts-' + bookingId).value);
    const comment = $('#cmt-' + bookingId).value;
    const d = await api('/organizer/complete', 'POST', { booking_id: bookingId, points, comment });
    flash(`Начислено ${d.points} баллов`);
    showTab('org');
  } catch (err) { flash(err.message, true); }
}

// ---------- админка ----------

RENDERERS.admin = async () => {
  const [points, groups, users, bookings, scores, characters, slots, rating] = await Promise.all([
    api('/admin/points'), api('/groups'), api('/admin/users'),
    api('/admin/bookings'), api('/admin/scores'), api('/characters'), api('/slots'), api('/rating'),
  ]);
  cache.points = points;
  cache.groups = groups;

  const pointOpts = points.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  const groupOpts = groups.map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join('');
  const pointName = Object.fromEntries(points.map(p => [p.id, p.name]));
  const charByGroup = Object.fromEntries(rating.map(r => [r.id, r.character_name]));
  const slotsByPoint = {};
  for (const s of slots) (slotsByPoint[s.point_id] ??= []).push(s);

  $('#app').innerHTML = `
    <div class="card">
      <h3>Точки</h3>
      <table>
        <tr><th>Название</th><th>Где</th><th>Активна</th><th></th></tr>
        ${points.map(p => `
          <tr>
            <td>${esc(p.name)}</td><td>${esc(p.location)}</td><td>${p.is_active ? 'да' : 'нет'}</td>
            <td>
              <button class="plain" onclick="adminPatchPoint(${p.id}, {is_active: ${!p.is_active}})">
                ${p.is_active ? 'Выключить' : 'Включить'}</button>
              <button class="danger" onclick="adminDelete('/admin/points/${p.id}', 'точку со всеми её слотами')">Удалить</button>
            </td>
          </tr>`).join('')}
      </table>
      <form onsubmit="return adminCreate(event, '/admin/points')">
        <input name="name" placeholder="Название" required>
        <input name="location" placeholder="Где находится">
        <input name="description" placeholder="Описание">
        <button>Добавить точку</button>
      </form>
    </div>

    <div class="card">
      <h3>Слоты</h3>
      ${points.map(p => `
        <div><b>${esc(p.name)}</b>: ${(slotsByPoint[p.id] || []).map(s =>
          `<span class="slot${s.booked ? ' full' : ''}">${fmtDT(s.starts_at)} (${s.booked}/${s.capacity})
            <button class="danger" onclick="adminDelete('/admin/slots/${s.id}', 'слот')">×</button></span>`).join(' ')
          || '<span class="muted">нет слотов</span>'}</div>`).join('')}
      <form onsubmit="return adminGenerateSlots(event)">
        <select name="point_id" required>${pointOpts}</select>
        <input name="first_start" type="datetime-local" required>
        <input name="slot_minutes" type="number" value="20" min="1" style="width:70px" title="длительность, минут">
        <input name="count" type="number" value="10" min="1" max="200" style="width:60px" title="количество слотов">
        <input name="break_minutes" type="number" value="0" min="0" style="width:60px" title="перерыв, минут">
        <input name="capacity" type="number" value="1" min="1" style="width:55px" title="команд на слот">
        <button>Сгенерировать</button>
      </form>
      <p class="muted">длительность / количество / перерыв / вместимость</p>
    </div>

    <div class="card">
      <h3>Группы</h3>
      <table>
        <tr><th>Группа</th><th>Кафедра</th><th>Староста</th><th>Персонаж</th><th></th></tr>
        ${groups.map(g => `
          <tr>
            <td>${esc(g.name)}
              <button class="plain" onclick="adminRenameGroup(${g.id}, '${esc(g.name)}')" title="переименовать">✎</button></td>
            <td>СМ${g.department}</td><td>${g.has_leader ? 'есть' : '—'}</td>
            <td>
              <select id="grp-char-${g.id}">
                <option value="">—</option>
                ${characters.map(c => `<option value="${c.id}" ${c.name === charByGroup[g.id] ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
              </select>
              <button class="plain" onclick="adminSetGroupChar(${g.id})">OK</button>
            </td>
            <td><button class="danger" onclick="adminDelete('/admin/groups/${g.id}', 'группу со всеми бронями и баллами')">Удалить</button></td>
          </tr>`).join('')}
      </table>
      <form onsubmit="return adminCreate(event, '/admin/groups', {department: Number})">
        <input name="name" placeholder="Название (СМ1-12)" required>
        <input name="department" type="number" min="1" max="13" placeholder="Кафедра" required style="width:90px">
        <button>Добавить группу</button>
      </form>
    </div>

    <div class="card">
      <h3>Пользователи</h3>
      <table>
        <tr><th>Логин</th><th>Имя</th><th>Роль</th><th>Группа/точка</th><th></th></tr>
        ${users.map(u => u.id === me.id ? `
          <tr>
            <td>${esc(u.login)}</td><td>${esc(u.display_name)}</td>
            <td>${ROLE_LABELS[u.role] || esc(u.role)}</td>
            <td>${esc(u.group_name ?? u.point_name ?? '—')}</td>
            <td><button class="plain" onclick="adminResetPassword(${u.id}, '${esc(u.login)}')">Сменить пароль</button></td>
          </tr>` : `
          <tr>
            <td>${esc(u.login)}</td>
            <td>${esc(u.display_name)}
              <button class="plain" onclick="adminRenameUser(${u.id}, '${esc(u.display_name)}')" title="изменить имя">✎</button></td>
            <td>
              <select id="usr-role-${u.id}">
                ${Object.entries(ROLE_LABELS).map(([r, l]) =>
                  `<option value="${r}" ${r === u.role ? 'selected' : ''}>${l}</option>`).join('')}
              </select>
            </td>
            <td>
              <select id="usr-grp-${u.id}" title="группа">
                <option value="">без группы</option>
                ${groups.map(g => `<option value="${g.id}" ${g.id === u.group_id ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}
              </select>
              <select id="usr-pt-${u.id}" title="точка">
                <option value="">без точки</option>
                ${points.map(p => `<option value="${p.id}" ${p.id === u.point_id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
              </select>
            </td>
            <td>
              <button class="plain" onclick="adminSaveUser(${u.id})">Сохранить</button>
              <button class="plain" onclick="adminResetPassword(${u.id}, '${esc(u.login)}')">Сменить пароль</button>
              <button class="danger" onclick="adminDelete('/admin/users/${u.id}', 'пользователя')">Удалить</button>
            </td>
          </tr>`).join('')}
      </table>
    </div>

    <div class="card">
      <h3>Брони</h3>
      ${bookings.length ? `
        <table>
          <tr><th>Время</th><th>Команда</th><th>Точка</th><th>Статус</th><th></th></tr>
          ${bookings.map(b => `
            <tr>
              <td>${fmtDT(b.starts_at)}</td><td>${esc(b.group_name)}</td><td>${esc(b.point_name)}</td>
              <td class="status-${b.status}">${STATUS_LABELS[b.status]}</td>
              <td>${b.status === 'active'
                ? `<button class="danger" onclick="adminPatchBooking(${b.id}, 'cancelled')">Отменить</button>` : ''}</td>
            </tr>`).join('')}
        </table>` : '<p class="muted">Броней нет.</p>'}
      <form onsubmit="return adminCreate(event, '/admin/bookings', {slot_id: Number, group_id: Number})">
        <select name="slot_id" required>
          ${slots.map(s => `<option value="${s.id}">${esc(pointName[s.point_id] ?? '?')} — ${fmtDT(s.starts_at)} (${s.booked}/${s.capacity})</option>`).join('')}
        </select>
        <select name="group_id" required>${groupOpts}</select>
        <button>Создать бронь</button>
      </form>
      <p class="muted">Ручная бронь — в обход окна 15 минут и лимита одной активной брони, но не вместимости слота.</p>
    </div>

    <div class="card">
      <h3>Баллы</h3>
      ${scores.length ? `
        <table>
          <tr><th>Когда</th><th>Команда</th><th>Точка</th><th>Баллы</th><th>Кто</th><th></th></tr>
          ${scores.map(s => `
            <tr>
              <td>${fmtDT(s.created_at)}</td><td>${esc(s.group_name)}</td><td>${esc(s.point_name)}</td>
              <td>+${s.points}</td><td>${esc(s.organizer_name ?? '—')}</td>
              <td><button class="danger" onclick="adminDelete('/admin/scores/${s.id}', 'начисление')">Удалить</button></td>
            </tr>`).join('')}
        </table>` : '<p class="muted">Начислений нет.</p>'}
      <form onsubmit="return adminCreate(event, '/admin/scores', {group_id: Number, point_id: Number, points: Number})">
        <select name="group_id" required>${groupOpts}</select>
        <select name="point_id" required>${pointOpts}</select>
        <input name="points" type="number" placeholder="Баллы" required style="width:80px">
        <input name="comment" placeholder="Комментарий">
        <button>Начислить вручную</button>
      </form>
    </div>

    <div class="card">
      <h3>Персонажи</h3>
      <table>
        ${characters.map(c => `
          <tr>
            <td><b>${esc(c.name)}</b></td><td>${esc(c.description)}</td>
            <td><button class="danger" onclick="adminDelete('/admin/characters/${c.id}', 'персонажа')">Удалить</button></td>
          </tr>`).join('')}
      </table>
      <form onsubmit="return adminCreate(event, '/admin/characters')">
        <input name="name" placeholder="Имя" required>
        <input name="description" placeholder="Описание">
        <button>Добавить персонажа</button>
      </form>
    </div>`;
};

async function adminCreate(e, path, casts = {}) {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  for (const [k, cast] of Object.entries(casts)) if (f[k] !== undefined) f[k] = cast(f[k]);
  try {
    await api(path, 'POST', f);
    flash('Добавлено');
    showTab('admin');
  } catch (err) { flash(err.message, true); }
  return false;
}

async function adminGenerateSlots(e) {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  try {
    const d = await api('/admin/slots', 'POST', {
      point_id: Number(f.point_id),
      first_start: new Date(f.first_start).toISOString(),
      slot_minutes: Number(f.slot_minutes),
      count: Number(f.count),
      break_minutes: Number(f.break_minutes) || 0,
      capacity: Number(f.capacity) || 1,
    });
    flash(`Создано слотов: ${d.created.length}`);
    showTab('admin');
  } catch (err) { flash(err.message, true); }
  return false;
}

async function adminPatchPoint(id, patch) {
  try { await api('/admin/points/' + id, 'PATCH', patch); showTab('admin'); }
  catch (err) { flash(err.message, true); }
}

async function adminPatchBooking(id, status) {
  try { await api('/admin/bookings/' + id, 'PATCH', { status }); flash('Статус изменён'); showTab('admin'); }
  catch (err) { flash(err.message, true); }
}

async function adminPatchGroup(id, patch) {
  try { await api('/admin/groups/' + id, 'PATCH', patch); flash('Сохранено'); showTab('admin'); }
  catch (err) { flash(err.message, true); }
}

function adminRenameGroup(id, name) {
  const v = prompt('Новое название группы:', name);
  if (v && v !== name) adminPatchGroup(id, { name: v });
}

function adminSetGroupChar(id) {
  const v = $('#grp-char-' + id).value;
  adminPatchGroup(id, { character_id: v ? Number(v) : null });
}

async function adminSaveUser(id) {
  const g = $('#usr-grp-' + id).value;
  const p = $('#usr-pt-' + id).value;
  try {
    await api('/admin/users/' + id, 'PATCH', {
      role: $('#usr-role-' + id).value,
      group_id: g ? Number(g) : null,
      point_id: p ? Number(p) : null,
    });
    flash('Сохранено');
    showTab('admin');
  } catch (err) { flash(err.message, true); }
}

async function adminRenameUser(id, name) {
  const v = prompt('Новое имя:', name);
  if (!v || v === name) return;
  try { await api('/admin/users/' + id, 'PATCH', { display_name: v }); flash('Имя изменено'); showTab('admin'); }
  catch (err) { flash(err.message, true); }
}

async function adminResetPassword(id, login) {
  const password = prompt(`Новый пароль для ${login} (мин. 6 символов):`);
  if (!password) return;
  try { await api('/admin/users/' + id, 'PATCH', { password }); flash('Пароль изменён'); }
  catch (err) { flash(err.message, true); }
}

async function adminDelete(path, what) {
  if (!confirm(`Удалить ${what}? Это действие необратимо.`)) return;
  try { await api(path, 'DELETE'); flash('Удалено'); showTab('admin'); }
  catch (err) { flash(err.message, true); }
}

// ---------- старт ----------

(async () => {
  if (token) {
    try {
      me = await api('/auth/me');
      renderApp();
      return;
    } catch (_) {
      token = null;
      localStorage.removeItem('token');
    }
  }
  renderAuth().catch(err => flash(err.message, true));
})();
