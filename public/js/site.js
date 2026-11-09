// When the office is mounted inside another site (createOffice({ site })), show that site's
// navigation as a thin bar above the header so both apps feel like one site.
// It looks the same as the host site's own top bar (app.css "site bar"). While mounted, this publishes
// window.__ccoSite = { section, siteName } and fires a 'cco:site' event; main.js then shows the section name
// as the header brand (so it doesn't repeat the site bar) and follows the host's tab title pattern
// ("<section> — <siteName>"). Standalone, nothing changes (no site config means an early return).
import { esc } from './util.js';
import { t } from './i18n.js';

async function mountSiteBar() {
  let cfg;
  try { cfg = await (await fetch('api/config', { cache: 'no-store' })).json(); } catch { return; }
  const site = cfg && cfg.site;
  if (!site || !Array.isArray(site.links)) return;
  const here = location.pathname.replace(/\/+$/, '/');
  const isCurrent = l => l.current || (l.href && new URL(l.href, location.href).pathname.replace(/\/+$/, '/') === here && !l.href.includes('#'));
  const bar = document.createElement('nav');
  bar.className = 'sitebar';
  bar.setAttribute('aria-label', site.name || 'Site');
  bar.innerHTML =
    `<a class="sitebar__name" href="${esc(site.home || '/')}">${esc(site.name || 'Site')}</a>` +
    `<div class="sitebar__links">` +
    site.links.map(l => `<a href="${esc(l.href)}"${isCurrent(l) ? ' aria-current="page"' : ''}>${esc(l.label)}</a>`).join('') +
    `</div>`;
  document.body.prepend(bar);
  document.documentElement.classList.add('has-sitebar');
  // on narrow screens the links scroll sideways; keep the active link (usually the last one) in view
  const box = bar.querySelector('.sitebar__links');
  const act = box.querySelector('[aria-current="page"]');
  if (act) {
    const over = act.getBoundingClientRect().right - box.getBoundingClientRect().right;
    if (over > 0) box.scrollLeft += over + 16;
  }

  // section name = label of the host's current link; main.js builds the brand and tab title from it
  const section = (site.links.find(isCurrent) || {}).label || t('app.name');
  window.__ccoSite = { section, siteName: site.name || 'Site' };
  dispatchEvent(new Event('cco:site'));
}

mountSiteBar();
