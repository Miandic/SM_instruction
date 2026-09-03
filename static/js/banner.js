/* Общая разметка рекламных баннеров. Контент задаётся в content.js. */

import { esc } from './core.js';

export function adBanner(banner, variant = 'wide') {
  if (!banner) return '';

  const className = `ad-banner ad-banner--${variant}${banner.href ? ' is-link' : ''}${
    banner.image ? '' : ' no-image'}`;
  const content = `
    ${banner.image ? `
      <span class="ad-banner__visual">
        <img src="${esc(banner.image)}" alt="${esc(banner.imageAlt || '')}" loading="lazy">
      </span>` : ''}
    <span class="ad-banner__body">
      <span class="ad-banner__label">${esc(banner.label || 'Реклама')}</span>
      <strong class="ad-banner__title">${esc(banner.title)}</strong>
      ${banner.text ? `<span class="ad-banner__text">${esc(banner.text)}</span>` : ''}
    </span>
    ${banner.href && banner.action
      ? `<span class="ad-banner__action">${esc(banner.action)}<span aria-hidden="true">→</span></span>`
      : ''}`;

  if (banner.href) {
    return `<a class="${className}" href="${esc(banner.href)}" target="_blank" rel="noopener noreferrer"
               aria-label="${esc(`${banner.label || 'Реклама'}: ${banner.title}`)}">${content}</a>`;
  }

  return `<aside class="${className}" aria-label="${esc(banner.label || 'Реклама')}">${content}</aside>`;
}
