/* Точка входа: шапка и хеш-роутер.
   Маршруты:
     #/               — витрина для гостя
     #/org/<id>       — витрина + полная карточка организации
     #/auth           — вход и регистрация
     #/home           — главная студента и старосты: радиальное меню
     #/home/<id>      — главная + короткая карточка организации с записью
     #/hero           — страница персонажа
     #/preview/...    — безопасный предпросмотр экранов старосты для админа
     #/app[/<tab>]    — личный кабинет (вкладки, админка, кабинет организатора) */

import { EVENT } from './content.js';
import {
  $, api, esc, state, clearSession, flash, isPlayer, homeRoute, roleLabel,
} from './js/core.js';
import { initSheet, closeSheet } from './js/sheet.js';
import { renderLanding, openOrg } from './js/landing.js';
import { renderHub, openItemSheet, stopHub } from './js/hub.js';
import { renderHero } from './js/hero.js';
import { renderAuth } from './js/auth.js';
import { renderCabinet, stopCabinet } from './js/cabinet.js';

let currentView = null;

// ---------- шапка ----------

function renderTopbar() {
  const me = state.me;
  $('#topbar').innerHTML = `
    <div class="wrap topbar__inner">
      <a class="brand" href="${me ? homeRoute() : '#/'}">
        <img src="/img/SmSurvivalLogo.svg" alt="${esc(EVENT.title)}">
      </a>
      ${me ? `
        <div class="usermenu">
          <span class="usermenu__info">${esc(me.display_name)} · ${esc(roleLabel(me))}${
            me.group_name ? ', ' + esc(me.group_name)
              : me.point_name ? ', ' + esc(me.point_name) : ''}</span>
          <button class="btn btn--sm" id="logout">Выйти</button>
        </div>` : ''}
    </div>`;

  const btn = $('#logout');
  if (btn) btn.addEventListener('click', logout);
}

async function logout() {
  try { await api('/auth/logout', 'POST', {}); } catch { /* не критично */ }
  clearSession();
  stopCabinet();
  stopHub();
  currentView = null;
  location.hash = '#/';
  renderTopbar();
  await route();
}

// ---------- роутер ----------

async function show(name, render, force = false) {
  if (currentView === name && !force) return false;
  const first = currentView !== name;
  currentView = name;
  await render($('#view'));
  if (first) window.scrollTo({ top: 0, behavior: 'instant' });
  return true;
}

async function route() {
  const parts = (location.hash || '#/').replace(/^#\/?/, '').split('/').filter(Boolean);
  const head = parts[0] || '';

  renderTopbar();

  if (head === 'preview' || head === 'preview-hero') {
    if (!state.me) { location.replace('#/auth'); return; }
    if (state.me.role !== 'admin') { location.replace(homeRoute()); return; }
    stopCabinet();

    const groupId = Number(parts[1]) || null;
    if (head === 'preview-hero') {
      stopHub();
      closeSheet();
      await show('preview-hero', host => renderHero(host, { preview: true, groupId }), true);
      return;
    }

    await show('preview', host => renderHub(host, { preview: true, groupId }), true);
    if (parts[2]) await openItemSheet(parts[2]);
    else closeSheet();
    return;
  }

  // главная игрока и страница персонажа — только для старосты и студента
  if (head === 'home' || head === 'hero') {
    if (!state.me) { location.replace('#/auth'); return; }
    if (!isPlayer(state.me)) { location.replace('#/app'); return; }
    stopCabinet();

    if (head === 'hero') {
      stopHub();
      closeSheet();
      await show('hero', renderHero, true);
      return;
    }

    await show('hub', renderHub);
    if (parts[1]) await openItemSheet(parts[1]);
    else closeSheet();
    return;
  }

  if (head === 'app') {
    if (!state.me) { location.replace('#/auth'); return; }
    closeSheet();
    stopHub();
    await show('cabinet', host => renderCabinet(host, parts[1]), true);
    return;
  }

  if (head === 'auth') {
    if (state.me) { location.replace(homeRoute()); return; }
    closeSheet();
    stopCabinet();
    stopHub();
    await show('auth', renderAuth);
    return;
  }

  stopCabinet();
  stopHub();
  await show('landing', renderLanding);
  if (head === 'org' && parts[1]) openOrg(parts[1]);
  else closeSheet();
}

// ---------- старт ----------

(async () => {
  initSheet();

  if (state.token) {
    try { state.me = await api('/auth/me'); }
    catch { clearSession(); }
  }

  window.addEventListener('hashchange', () => {
    route().catch(err => flash(err.message, true));
  });

  await route().catch(err => flash(err.message, true));
})();
