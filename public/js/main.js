import { t as msg, locale, fmtPct } from './i18n.js';
import { CATS, STATUS, verbOf, actText, evName, evText, catColor, fmtDur, fmtShort, fmtClock, fmtTok, fmtUsd, pct, esc, icon } from './util.js';
import { createPano } from './pano.js';
import { createOfis } from './ofis.js';
import { createAkis } from './akis.js';
import { createMaliyet } from './maliyet.js';
import './site.js';
import { initChat, TOKEN } from './chat.js';

// ---------------------------------------------------------------- store

export const store = {
  agents: new Map(),
  evByAgent: new Map(),
  evById: new Map(),
  offset: 0,
  ready: false,
  now() { return Date.now() + this.offset; },
  mains() {
    return [...this.agents.values()].filter(a => a.kind === 'main')
      .sort((a, b) => a.project.localeCompare(b.project, locale) || (a.started || 0) - (b.started || 0));
  },
  subsOf(id) {
    const m = this.agents.get(id);
    if (!m) return [];
    return m.subs.map(s => this.agents.get(s)).filter(Boolean).sort((a, b) => (a.started || 0) - (b.started || 0));
  },
  events(id) { return this.evByAgent.get(id) || []; },
};

function addEvent(ev) {
  const old = store.evById.get(ev.id);
  if (old) { Object.assign(old, ev); return; }
  store.evById.set(ev.id, ev);
  let arr = store.evByAgent.get(ev.a);
  if (!arr) store.evByAgent.set(ev.a, arr = []);
  if (!arr.length || arr[arr.length - 1].s <= ev.s) arr.push(ev);
  else {
    let i = arr.length - 1;
    while (i > 0 && arr[i - 1].s > ev.s) i--;
    arr.splice(i, 0, ev);
  }
}

function removeAgent(id) {
  store.agents.delete(id);
  for (const ev of store.evByAgent.get(id) || []) store.evById.delete(ev.id);
  store.evByAgent.delete(id);
}

setInterval(() => {
  const cut = store.now() - 6 * 3600e3;
  for (const [id, arr] of store.evByAgent) {
    let i = 0;
    while (i < arr.length && (arr[i].e || Infinity) < cut) { store.evById.delete(arr[i].id); i++; }
    if (i) arr.splice(0, i);
  }
}, 60e3);

// ---------------------------------------------------------------- live connection

const conn = document.getElementById('conn');
let es, chatApi;
function connect() {
  es = new EventSource('events' + (TOKEN ? '?t=' + encodeURIComponent(TOKEN) : ''));
  chatApi = initChat({ es });
  es.addEventListener('snap', e => {
    const d = JSON.parse(e.data);
    store.offset = d.now - Date.now();
    store.agents.clear(); store.evByAgent.clear(); store.evById.clear();
    for (const a of d.agents) store.agents.set(a.id, a);
    d.events.sort((x, y) => x.s - y.s).forEach(addEvent);
    store.ready = true;
    for (const a of store.mains()) prevStatus.set(a.id, a.status);
    changed(true);
  });
  es.addEventListener('tick', e => {
    const d = JSON.parse(e.data);
    store.offset = d.now - Date.now();
    for (const id of d.removed) removeAgent(id);
    for (const a of d.agents) store.agents.set(a.id, a);
    for (const ev of d.events) addEvent(ev);
    watchTransitions();
    changed(false, d);
  });
  // Cost: equivalent at API list prices (sent on connect and after every scan).
  es.addEventListener('cost', e => {
    ctx.cost = JSON.parse(e.data);
    renderKpis();
    for (const name of ['pano', 'maliyet']) if (current === name && views[name]) views[name].update(false, { cost: true });
  });
  es.onopen = () => { conn.classList.add('live'); conn.title = msg('conn.live'); };
  es.onerror = () => { conn.classList.remove('live'); conn.title = msg('conn.lost'); };
}

// ---------------------------------------------------------------- views

const tipEl = document.getElementById('tip');
export const tip = {
  show(html, x, y) {
    tipEl.innerHTML = html;
    tipEl.classList.add('on');
    const r = tipEl.getBoundingClientRect();
    let left = x + 14, top = y + 16;
    if (left + r.width > innerWidth - 8) left = x - r.width - 14;
    if (top + r.height > innerHeight - 8) top = y - r.height - 12;
    tipEl.style.left = Math.max(8, left) + 'px';
    tipEl.style.top = Math.max(8, top) + 'px';
  },
  hide() { tipEl.classList.remove('on'); },
};

export function evTipHtml(ev, agent) {
  const cat = CATS[ev.c] || CATS.other;
  const t = store.now();
  const dur = (ev.e || t) - ev.s;
  const who = agent ? `<div class="m">${esc(agent.kind === 'sub' ? '↳ ' + (agent.desc || agent.atype) : agent.project + ' · ' + agent.name)}</div>` : '';
  const state = ev.e == null ? ' · ' + msg('ev.ongoing') : ev.x === 1 ? ' · ' + msg('ev.error') : ev.x === 2 ? ' · ' + msg('ev.interrupted') : '';
  const waitingNow = agent && (agent.status === 'waiting' || agent.status === 'ask');
  const head = ev.c === 'wait' ? (ev.e == null ? (waitingNow ? msg('status.waiting') : msg('ev.waitBg')) : msg('ev.wasYourTurn')) : ev.c === 'think' ? msg('ev.modelThinking') : evName(ev);
  const text = ev.c === 'wait' ? '' : evText(ev);
  return `<div class="h"><span class="sq" style="background:${ev.c === 'wait' ? (ev.e == null && waitingNow ? '#fab219' : '#5b6272') : cat.color}"></span>${esc(head)}</div>${who}` +
    `<div class="m">${fmtClock(ev.s, true)} · ${fmtDur(dur)}${state}</div>` +
    (text ? `<div class="c">${esc(text)}</div>` : '') +
    (ev.d && ev.d !== ev.l ? `<div class="c">${esc(ev.d)}</div>` : '');
}

const ctx = {
  store, tip, evTipHtml, statusPill, activityHtml, subRow, drawSpark, clockDur, counts,
  openDrawer: id => openDrawer(id),
  // extras: latest cost summary ({progress, scannedAt, totals}) and view switching
  cost: null,
  setView: name => setView(name),
};
// Each view is isolated: if one throws while being set up or drawn, only that tab shows
// an error message; the rest of the app keeps running.
function safeView(name, create) {
  const root = document.getElementById('view-' + name);
  const fail = e => {
    console.error(`[${name}]`, e);
    if (root) root.innerHTML = `<div class="empty">${esc(msg('view.failed'))}<br><span class="faint mono">${esc(e && e.message || e)}</span></div>`;
  };
  let v;
  try { v = create(root); } catch (e) { fail(e); v = null; }
  const guard = fn => (...args) => { if (!v) return; try { return fn.apply(v, args); } catch (e) { fail(e); v = null; } };
  return { show: guard(function () { return this.show(); }), hide: guard(function () { return this.hide(); }), update: guard(function (...a) { return this.update(...a); }) };
}
const views = {
  pano: safeView('pano', root => createPano(root, ctx)),
  ofis: safeView('ofis', root => createOfis(root, ctx)),
  akis: safeView('akis', root => createAkis(root, ctx)),
  maliyet: safeView('maliyet', root => createMaliyet(root, ctx)),
};
let current = null;

function setView(name) {
  if (!views[name]) name = 'pano';
  if (current === name) return;
  if (current) { views[current].hide(); document.getElementById('view-' + current).hidden = true; }
  current = name;
  document.getElementById('view-' + name).hidden = false;
  views[name].show();
  document.querySelectorAll('.top .seg button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.view === name)));
  try { localStorage.setItem('ajan-ofisi.view', name); } catch { /* storage disabled */ }
  if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
}
document.querySelectorAll('.top .seg button').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));

function changed(full, d) {
  renderKpis();
  renderAttention();
  if (current) views[current].update(full, d);
  if (drawerId) scheduleDrawer();
}

// ---------------------------------------------------------------- header indicators

function counts() {
  let working = 0, waiting = 0, subs = 0, hour = 0, calls5 = 0;
  for (const a of store.agents.values()) {
    hour += a.hourOut || 0;
    calls5 += (a.sparkT || []).slice(-5).reduce((x, y) => x + y, 0);
    if (a.kind === 'main') {
      if (a.status === 'working') working++;
      if (a.status === 'waiting' || a.status === 'ask') waiting++;
    } else if (a.status === 'working') subs++;
  }
  return { working, waiting, subs, hour, calls5 };
}
export { counts };

let kpiKey = '';
function renderKpis() {
  const c = counts();
  const mains = store.mains();
  const T = ctx.cost && ctx.cost.totals;
  const key = [c.working, c.subs, c.waiting, mains.length, T ? Math.round(T.today) : '-', T ? Math.round(T.hour) : '-'].join('|');
  if (key !== kpiKey) {
    kpiKey = key;
    const workTip = msg('kpi.workTip', { w: c.working, s: c.subs, m: mains.length, tok: fmtTok(c.hour) });
    const costTip = T ? msg('kpi.costTip', { today: fmtUsd(T.today), hour: fmtUsd(T.hour), prev: fmtUsd(T.prevHour) }) : msg('kpi.costScanning');
    document.getElementById('kpis').innerHTML =
      `<div class="kpi" title="${esc(workTip)}"><span class="dot" style="background:${STATUS.working.color}"></span><b>${c.working + c.subs}</b>${esc(msg('kpi.working'))}</div>` +
      (c.waiting ? `<div class="kpi warn" title="${esc(msg('kpi.waitingTip'))}"><span class="dot" style="background:${STATUS.waiting.color}"></span><b>${c.waiting}</b>${esc(msg('kpi.yourTurn'))}</div>`
        : `<div class="kpi" title="${esc(msg('kpi.nobodyTip'))}"><span class="dot" style="background:#4a5263"></span>${esc(msg('kpi.nobody'))}</div>`) +
      `<button class="kpi cost" type="button" id="kpi-cost" title="${esc(costTip)}">${esc(msg('kpi.today'))} <b>${T ? fmtUsd(T.today) : '…'}</b></button>`;
    document.getElementById('kpi-cost').addEventListener('click', () => setView('maliyet'));
  }
  lastWaiting = c.waiting;
  renderTitle();
}

// Tab title and header brand. Standalone: "(n) <brand>". When mounted into a host site, site.js publishes
// window.__ccoSite = { section, siteName } and fires 'cco:site'; the title then follows the host's pattern
// "(n) <section> — <siteName>" and the brand shows the section name.
let lastWaiting = 0;
function renderTitle() {
  const site = window.__ccoSite;
  const name = site ? `${site.section} — ${site.siteName}` : msg('app.name');
  const n = lastWaiting + (window.__ccoPerms || 0);
  document.title = n ? `(${n}) ${name}` : name;
}
window.addEventListener('cco:perms', renderTitle);
function renderBrand() {
  const site = window.__ccoSite;
  const brand = document.querySelector('.top .brand span');
  if (brand) brand.textContent = site ? site.section : msg('app.name');
}
addEventListener('cco:site', () => { renderBrand(); renderTitle(); });

let attnKey = '';
function renderAttention() {
  const box = document.getElementById('attention');
  const t = store.now();
  const list = store.mains().filter(a => a.status === 'waiting' || a.status === 'ask').sort((a, b) => a.since - b.since);
  if (!list.length) { box.hidden = true; box.innerHTML = ''; attnKey = ''; return; }
  box.hidden = false;
  // Durations are updated by the [data-since] ticker; leave the DOM alone unless the content changed (keeps hover intact).
  const key = list.map(a => [a.id, a.since, a.project, a.title, a.color, a.lastText].join('\u0001')).join('\u0002');
  if (key === attnKey) return;
  attnKey = key;
  box.innerHTML = `<span class="lbl"><span class="dot"></span>${esc(STATUS.waiting.label)}</span>` + list.map(a =>
    `<button class="chip" data-id="${esc(a.id)}" title="${esc(a.lastText || '')}"><span class="sw" style="background:${a.color}"></span>` +
    `<b>${esc(a.project)}</b><span class="t">${esc(a.title || a.name)}</span><span class="d" data-since="${a.since}" data-fmt="short">${fmtShort(t - a.since)}</span></button>`).join('');
  box.querySelectorAll('.chip').forEach(ch => ch.addEventListener('click', () => openDrawer(ch.dataset.id)));
}

// live duration counters
setInterval(() => {
  const t = store.now();
  document.querySelectorAll('[data-since]').forEach(n => {
    const ms = t - Number(n.dataset.since);
    n.textContent = n.dataset.fmt === 'short' ? fmtShort(ms) : n.dataset.fmt === 'clock' ? clockDur(ms) : fmtDur(ms);
  });
}, 1000);

export function clockDur(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  const p = n => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(x)}` : `${m}:${p(x)}`;
}

// ---------------------------------------------------------------- cswap accounts

async function loadAccounts() {
  try {
    const d = await (await fetch('api/cswap', { cache: 'no-store' })).json();
    const box = document.getElementById('accts');
    const col = p => (p >= 90 ? '#d03b3b' : p >= 70 ? '#fab219' : '#0ca30c');
    box.innerHTML = (d.accounts || []).map(a => {
      const u = a.usage || {};
      const f = u.fiveHour || {}, s = u.sevenDay || {};
      const fp = Math.round(f.pct || 0), sp = Math.round(s.pct || 0);
      const tt = `${a.email}\n${msg('acct.five', { p: fmtPct(fp) })}${f.countdown ? ' · ' + msg('acct.resets', { c: f.countdown }) : ''}` +
        `\n${msg('acct.seven', { p: fmtPct(sp) })}${s.countdown ? ' · ' + msg('acct.in', { c: s.countdown }) : ''}`;
      return `<div class="acct ${a.active ? 'on' : ''}" title="${esc(tt)}"><span class="n">#${a.number}</span>` +
        `<span class="bar"><i style="width:${fp}%;background:${col(fp)}"></i></span>` +
        `<span class="bar"><i style="width:${sp}%;background:${col(sp)}"></i></span></div>`;
    }).join('');
  } catch { /* the cswap panel may be offline */ }
}
loadAccounts();
setInterval(loadAccounts, 30e3);

// ---------------------------------------------------------------- notifications

const bell = document.getElementById('bell');
let bellOn = false;
try { bellOn = localStorage.getItem('ajan-ofisi.bell') === '1'; } catch { /* unavailable */ }
function renderBell() {
  bell.classList.toggle('on', bellOn);
  bell.innerHTML = icon(bellOn ? 'bell' : 'bellOff');
  bell.title = msg(bellOn ? 'bell.on' : 'bell.off');
}
renderBell();
bell.addEventListener('click', () => {
  bellOn = !bellOn;
  try { localStorage.setItem('ajan-ofisi.bell', bellOn ? '1' : '0'); } catch { /* unavailable */ }
  renderBell();
  if (bellOn) {
    chime();
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
  }
});

let audio;
function chime() {
  try {
    audio = audio || new AudioContext();
    const t0 = audio.currentTime;
    [[659.25, 0], [987.77, 0.13]].forEach(([f, d]) => {
      const o = audio.createOscillator(), g = audio.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0, t0 + d);
      g.gain.linearRampToValueAtTime(0.16, t0 + d + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.55);
      o.connect(g).connect(audio.destination);
      o.start(t0 + d); o.stop(t0 + d + 0.6);
    });
  } catch { /* audio unavailable */ }
}

const prevStatus = new Map();
function watchTransitions() {
  for (const a of store.mains()) {
    const p = prevStatus.get(a.id);
    if (p === 'working' && (a.status === 'waiting' || a.status === 'ask') && bellOn) {
      chime();
      try {
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification(msg('notify.title', { p: a.project }), { body: (a.title ? a.title + '\n' : '') + (a.lastText || '').slice(0, 140), tag: a.id, silent: true });
        }
      } catch { /* notifications unavailable */ }
    }
    prevStatus.set(a.id, a.status);
  }
}

// ---------------------------------------------------------------- drawer

const drawer = document.getElementById('drawer');
const scrim = document.getElementById('scrim');
let drawerId = null;
let drawerTimer = null;

let logAll = false;
function openDrawer(id) {
  if (!store.agents.has(id)) return;
  if (drawerId !== id) logAll = false;
  drawerId = id;
  renderDrawer(true);
  drawer.classList.add('on');
  scrim.classList.add('on');
  drawer.setAttribute('aria-hidden', 'false');
  const a0 = store.agents.get(id); if (a0 && chatApi) chatApi.show(a0.kind === 'main' ? a0 : store.agents.get(a0.parent) || a0);
}
function closeDrawer() {
  drawerId = null;
  drawer.classList.remove('on');
  scrim.classList.remove('on');
  drawer.setAttribute('aria-hidden', 'true');
  if (chatApi) chatApi.hide();
}
scrim.addEventListener('click', closeDrawer);
function scheduleDrawer() {
  if (drawerTimer) return;
  drawerTimer = setTimeout(() => { drawerTimer = null; if (drawerId) renderDrawer(false); }, 700);
}

function statusPill(a, t) {
  const st = STATUS[a.status] || STATUS.working;
  return `<span class="pill ${a.status}"><span class="d"></span>${st.label}<span class="t" data-since="${a.since}" data-fmt="short">${fmtShort(t - a.since)}</span></span>`;
}
export { statusPill };

export function activityHtml(a, t) {
  if (a.status === 'waiting' || a.status === 'ask' || a.status === 'dormant') {
    const txt = a.status === 'ask' && a.act ? actText(a.act, a) : (a.lastText || a.summary || msg('act.replied'));
    return `<div class="act waiting ${a.status === 'dormant' ? 'dormant' : ''}"><div class="badge">${icon(a.status === 'dormant' ? 'zz' : 'wait')}</div>` +
      `<div class="txt"><div class="v">${esc(STATUS[a.status].label)}<span class="el" data-since="${a.since}" data-fmt="clock">${clockDur(t - a.since)}</span></div>` +
      `<div class="l">${esc(txt)}</div></div></div>`;
  }
  if (a.status === 'done' || a.status === 'stale' || a.status === 'ready') { // 'ready' = pinned room, awake and idle: neutral, not "your turn"
    return `<div class="act quiet"><div class="badge">${icon(a.status === 'stale' ? 'zz' : 'check')}</div>` +
      `<div class="txt"><div class="v">${esc(a.status === 'ready' ? msg('status.ready') : msg(a.status === 'done' ? 'act.taskDone' : 'act.silent'))}<span class="el">${fmtClock(a.since)}</span></div>` +
      `<div class="l">${esc(a.lastText || '')}</div></div></div>`;
  }
  const act = a.act || { c: 'think', code: 'working', since: a.since };
  return `<div class="act" style="--c:${catColor(act.c)}"><div class="badge">${icon(act.c)}</div>` +
    `<div class="txt"><div class="v">${esc(verbOf(act))}${act.k > 1 ? `<span class="par">${esc(msg('act.parallel', { n: act.k }))}</span>` : ''}` +
    `<span class="el" data-since="${act.since}" data-fmt="clock">${clockDur(t - act.since)}</span></div>` +
    `<div class="l">${esc(actText(act, a))}</div></div></div>`;
}

function renderDrawer(first) {
  const a = store.agents.get(drawerId);
  if (!a) { closeDrawer(); return; }
  const t = store.now();
  const keep = first ? 0 : drawer.scrollTop;
  const parent = a.parent ? store.agents.get(a.parent) : null;
  const subs = a.kind === 'main' ? store.subsOf(a.id) : [];
  const evs = store.events(a.id);
  const ctxP = pct(a.ctx, a.ctxMax);
  const catTotal = Object.values(a.cats || {}).reduce((x, y) => x + y, 0) || 1;
  const tools = Object.entries(a.tools || {}).sort((x, y) => y[1] - x[1]).slice(0, 7);
  const toolMax = tools.length ? tools[0][1] : 1;
  const catOfTool = n => {
    for (let i = evs.length - 1; i >= 0; i--) if (evs[i].n === n) return evs[i].c;
    return 'other';
  };

  const LOG_FEW = 25;
  const logEvs = evs.filter(ev => ev.c !== 'think' || (ev.e || t) - ev.s > 4000).slice(-120).reverse();
  const log = logEvs.slice(0, logAll ? 120 : LOG_FEW).map(ev => {
    const live = ev.e == null && ev.c !== 'wait';
    const dur = ev.c === 'prompt' || ev.c === 'compact' ? '' : live ? msg('ev.ongoing') : fmtDur((ev.e || t) - ev.s);
    const name = ev.c === 'think' ? msg('log.think') : ev.c === 'wait' ? msg('log.wait') : ev.c === 'prompt' ? msg('log.prompt') : evName(ev);
    const col = ev.c === 'wait' ? '#5b6272' : ev.c === 'prompt' ? '#e6e9ef' : catColor(ev.c);
    const full = evText(ev);
    return `<div class="lrow ${ev.x === 1 ? 'err' : ''} ${live ? 'live' : ''} ${ev.c === 'prompt' ? 'prompt' : ''}">` +
      `<span class="tm">${fmtClock(ev.s, true)}</span><span class="sq" style="background:${col}"></span>` +
      `<span class="tn">${esc(name)}</span><span class="tl" title="${esc(ev.d || full)}">${esc(ev.c === 'wait' ? '' : full)}</span>` +
      `<span class="td">${ev.x === 1 ? esc(msg('ev.error')) + ' · ' : ''}${esc(dur)}</span></div>`;
  }).join('');
  const ctxCol = ctxP > 85 ? '#d03b3b' : ctxP > 65 ? '#fab219' : '#9085e9';
  const usd = a.usd;

  drawer.innerHTML = `
    <div class="dw-head">
      <div class="dw-row">
        <span class="sw" style="background:${a.color}"></span>
        <span class="dw-proj">${esc(a.kind === 'sub' ? (parent ? parent.project : a.project) : a.project)}</span>
        <span class="c-name">${esc(a.kind === 'sub' ? '↳ ' + a.atype : a.name)}</span>
        ${statusPill(a, t)}
        <button class="icon-btn x-btn" id="dw-close" title="${esc(msg('dw.close'))}">${icon('close')}</button>
      </div>
      <div class="dw-title">${esc(a.kind === 'sub' ? a.desc || a.atype : a.title || a.name)}</div>
      <div class="dw-meta">
        ${a.model ? `<span>${esc(a.model)}${a.effort ? ' · ' + esc(a.effort) : ''}</span>` : ''}
        ${a.started ? `<span>${esc(msg('dw.started', { clock: fmtClock(a.started), ago: fmtShort(t - a.started) }))}</span>` : ''}
        ${a.bg ? `<span>${esc(msg('dw.bg'))}</span>` : ''}
        <span class="path" title="${esc(a.cwd)}${a.pid ? '\npid ' + a.pid : ''}${a.version ? '\nClaude Code v' + esc(a.version) : ''}">${esc(a.cwd)}</span>
      </div>
    </div>
    <div class="dw-body">
      <div class="dw-sec">${activityHtml(a, t)}</div>
      <div class="kv">
        <div title="${esc(msg('dw.ctxTip', { a: fmtTok(a.ctx), b: fmtTok(a.ctxMax) }))}"><small>${esc(msg('dw.ctx'))}</small><b>${fmtPct(ctxP)}</b><div class="gauge" style="width:100%;margin-top:6px"><i style="width:${ctxP}%;background:${ctxCol}"></i></div></div>
        <div><small>${esc(msg('dw.lastHour'))}</small><b>${fmtTok(a.hourOut)}</b><small>${esc(msg('dw.outTok'))}</small></div>
        <div title="${esc(msg(a.kind === 'main' ? 'dw.costTipMain' : 'dw.costTipSub'))}"><small>${esc(msg('dw.cost'))}</small><b>${usd == null ? '…' : fmtUsd(usd)}</b><small>${esc(msg('dw.apiEq'))}</small></div>
        <div><small>${esc(msg(a.kind === 'main' ? 'dw.subs' : 'dw.totalTok'))}</small><b>${a.kind === 'main' ? `${a.subsWorking}<small style="display:inline"> / ${subs.length}</small>` : fmtTok(a.tokOut)}</b><small>${esc(msg(a.kind === 'main' ? 'dw.working' : 'dw.output'))}</small></div>
      </div>
      <div class="dw-sec"><h6>${esc(msg('dw.perMin'))} <span>${esc(msg('dw.last60'))}</span></h6><canvas class="spark" id="dw-spark"></canvas></div>
      ${a.lastPrompt ? `<div class="dw-sec"><h6>${esc(msg(a.kind === 'sub' ? 'dw.task' : 'dw.lastPrompt'))}</h6><div class="quote">${esc(a.lastPrompt)}</div></div>` : ''}
      ${a.summary ? `<div class="dw-sec"><h6>${esc(msg('dw.summary'))}</h6><div class="quote">${esc(a.summary)}</div></div>` : ''}
      ${a.lastText ? `<div class="dw-sec"><h6>${esc(msg('dw.lastReply'))}</h6><div class="quote">${esc(a.lastText)}</div></div>` : ''}
      ${tools.length ? `<div class="dw-sec"><h6>${esc(msg('dw.tools'))} <span>${esc(msg('dw.toolsSub', { calls: a.calls, prompts: a.prompts }))}</span></h6>
        <div class="mixbar">${Object.entries(a.cats).sort((x, y) => y[1] - x[1]).map(([c, n]) => `<i style="flex:${n};background:${catColor(c)}" title="${esc((CATS[c] || CATS.other).name)} · ${n}"></i>`).join('')}</div>
        <div class="tbars">${tools.map(([n, c]) => `<div class="tbar"><span class="nm">${esc(n)}</span><span class="tr"><i style="width:${(c / toolMax) * 100}%;background:${catColor(catOfTool(n))}"></i></span><span class="ct">${c}</span></div>`).join('')}</div></div>` : ''}
      ${subs.length ? `<div class="dw-sec subs"><h6>${esc(msg('dw.subsH'))} <span>${esc(msg('dw.subsSub', { w: a.subsWorking, n: subs.length }))}</span></h6>${subs.map(s => subRow(s, t)).join('')}</div>` : ''}
      <div class="dw-sec"><h6>${esc(msg('dw.events'))} <span>${esc(msg('dw.newest'))}</span></h6><div class="log">${log || `<div class="lrow empty-row">${esc(msg('dw.noEvents'))}</div>`}</div>
        ${logEvs.length > LOG_FEW ? `<button class="ghost-btn" id="dw-more">${esc(logAll ? msg('common.showLess') : msg('common.showAll', { n: logEvs.length }))}</button>` : ''}</div>
    </div>`;
  drawer.scrollTop = keep;
  drawer.querySelector('#dw-close').addEventListener('click', closeDrawer);
  const more = drawer.querySelector('#dw-more');
  if (more) more.addEventListener('click', () => { logAll = !logAll; renderDrawer(false); });
  drawer.querySelectorAll('[data-sub]').forEach(r => r.addEventListener('click', () => openDrawer(r.dataset.sub)));
  drawSpark(drawer.querySelector('#dw-spark'), a.spark || [], a.color);
}

export function subRow(s, t) {
  const live = s.status === 'working';
  const act = s.act;
  const col = live && act ? catColor(act.c) : '#3a4150';
  const what = live ? (act ? `${verbOf(act)} · ${actText(act, s)}` : STATUS.working.label) : (s.status === 'done' ? STATUS.done : STATUS.stale).label;
  return `<div class="srow ${live ? '' : 'done'}" data-sub="${esc(s.id)}" title="${esc(s.desc)}">` +
    `<span class="sd" style="background:${col}"></span><span class="sn">${esc(s.desc || s.atype)}</span>` +
    `<span class="sa">${esc(what)}</span>` +
    `<span class="se" ${live && act ? `data-since="${act.since}" data-fmt="short"` : ''}>${live && act ? fmtShort(t - act.since) : fmtClock(s.since)}</span></div>`;
}

// opts.tip(i, minsAgo) → tooltip HTML (optional; defaults to the token count)
export function drawSpark(cv, data, color, opts = {}) {
  if (!cv) return;
  const dpr = devicePixelRatio || 1;
  const w = cv.clientWidth, h = cv.clientHeight;
  if (!w) return;
  cv.width = w * dpr; cv.height = h * dpr;
  const g = cv.getContext('2d');
  g.scale(dpr, dpr);
  const max = Math.max(1, ...data);
  const n = data.length || 1;
  const bw = w / n;
  g.fillStyle = 'rgba(255,255,255,.07)';
  g.fillRect(0, h - 1, w, 1);
  data.forEach((v, i) => {
    if (!v) return;
    const bh = Math.max(2, (v / max) * (h - 4));
    g.fillStyle = i === n - 1 ? color : color + 'b3';
    const x = i * bw + 1, bwid = Math.max(1, bw - 2);
    g.beginPath();
    g.roundRect(x, h - bh, bwid, bh, [Math.min(3, bwid / 2), Math.min(3, bwid / 2), 0, 0]);
    g.fill();
  });
  cv.onmousemove = e => {
    const i = Math.min(n - 1, Math.floor(e.offsetX / bw));
    const minsAgo = n - 1 - i;
    tip.show(opts.tip ? opts.tip(i, minsAgo) : `<div class="h">${esc(msg('spark.tok', { t: fmtTok(data[i] || 0) }))}</div><div class="m">${esc(minsAgo ? msg('time.minAgo', { n: minsAgo }) : msg('time.thisMin'))}</div>`, e.clientX, e.clientY);
  };
  cv.onmouseleave = () => tip.hide();
}

// ---------------------------------------------------------------- keyboard / startup

addEventListener('keydown', e => {
  if (e.target.matches('input, textarea')) return;
  if (e.key === 'Escape') closeDrawer();
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === '1') setView('pano');
  if (e.key === '2') setView('ofis');
  if (e.key === '3') setView('akis');
  if (e.key === '4') setView('maliyet');
});
addEventListener('hashchange', () => { const v = location.hash.slice(1); if (views[v]) setView(v); });

let startView = location.hash.slice(1);
if (!views[startView]) { try { startView = localStorage.getItem('ajan-ofisi.view') || 'pano'; } catch { startView = 'pano'; } }
setView(startView);
connect();
