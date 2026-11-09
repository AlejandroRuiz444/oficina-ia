// Dashboard: a calm summary strip + session cards. Details on hover and in the drawer.
import { CATS, CAT_ORDER, catColor, fmtTok, fmtShort, fmtUsd, pct, esc, icon } from './util.js';
import { t as msg, fmtNum, fmtPct } from './i18n.js';

const STRIP_MIN = 30;
const SUB_ROWS = 4;

let hatchCache = null;
export function hatch(g) {
  if (!hatchCache) {
    const c = document.createElement('canvas');
    c.width = c.height = 6;
    const x = c.getContext('2d');
    x.strokeStyle = 'rgba(138,147,165,.45)';
    x.lineWidth = 1.1;
    x.beginPath(); x.moveTo(0, 6); x.lineTo(6, 0); x.moveTo(-3, 3); x.lineTo(3, -3); x.moveTo(3, 9); x.lineTo(9, 3); x.stroke();
    hatchCache = c;
  }
  return g.createPattern(hatchCache, 'repeat');
}

export function createPano(root, ctx) {
  const { store } = ctx;
  root.innerHTML = `<div class="pano">
      <div class="hero" id="hero"></div>
      <div class="cards" id="cards"></div>
      <div id="sleepers"></div>
    </div>`;
  const heroEl = root.querySelector('#hero');
  const cardsEl = root.querySelector('#cards');
  const sleepEl = root.querySelector('#sleepers');
  const cards = new Map();
  let visible = false;
  let timer = null;

  // ------------------------------------------------------------ summary

  heroEl.innerHTML = `
    <div class="tile rate"><h4>${esc(msg('pano.last60'))}</h4><div class="big" id="h-tok"></div><div class="sub" id="h-call"></div><canvas id="h-tok-c"></canvas></div>
    <div class="tile mix"><h4>${esc(msg('pano.now'))}</h4><div class="mixbar" id="h-mix"></div><div class="mixleg" id="h-mixleg"></div></div>
    <div class="tile link cost" id="h-cost" role="button" tabindex="0" title="${esc(msg('pano.costOpen'))}"><h4>${esc(msg('pano.today'))}<span class="faint">· ${esc(msg('dw.apiEq'))}</span></h4><div class="big" id="h-usd"></div><div class="sub" id="h-usd-s"></div></div>`;
  const $ = id => heroEl.querySelector(id);
  const goCost = () => ctx.setView && ctx.setView('maliyet');
  $('#h-cost').addEventListener('click', goCost);
  $('#h-cost').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goCost(); } });

  function renderCost() {
    const T = ctx.cost && ctx.cost.totals;
    $('#h-usd').textContent = T ? fmtUsd(T.today) : '…';
    $('#h-usd-s').innerHTML = T
      ? msg('pano.hourLine', { a: `<b>${fmtUsd(T.hour)}</b>`, b: `<b>${fmtUsd(T.prevHour)}</b>` })
      : esc(msg(ctx.cost && ctx.cost.progress ? 'pano.scanning' : 'pano.calculating'));
  }

  function renderHero() {
    const all = [...store.agents.values()];
    const tok = new Array(60).fill(0), calls = new Array(60).fill(0);
    let hour = 0;
    for (const a of all) {
      (a.spark || []).forEach((v, i) => { tok[i] += v; });
      (a.sparkT || []).forEach((v, i) => { calls[i] += v; });
      hour += a.hourOut || 0;
    }
    $('#h-tok').innerHTML = `${fmtTok(hour)}<small>${esc(msg('dw.outTok'))}</small>`;
    const last5 = calls.slice(-5).reduce((x, y) => x + y, 0);
    const callSum = calls.reduce((x, y) => x + y, 0);
    const perMin = Math.round(last5 / 5);
    $('#h-call').innerHTML = msg('pano.calls', { n: perMin, a: `<b>${perMin}</b>`, b: `<b>${fmtNum(callSum)}</b>` });
    ctx.drawSpark($('#h-tok-c'), tok, '#8f9bb3', {
      tip: (i, ago) => `<div class="h">${esc(msg('spark.tok', { t: fmtTok(tok[i] || 0) }))}</div>` +
        `<div class="m">${esc(msg('pano.sparkCalls', { n: calls[i] || 0 }))} · ${esc(ago ? msg('time.minAgo', { n: ago }) : msg('time.thisMin'))}</div>`,
    });

    const mix = {};
    for (const a of all) {
      if (a.status !== 'working' || !a.act) continue;
      const c = a.act.c === 'ask' ? 'other' : a.act.c;
      mix[c] = (mix[c] || 0) + 1;
    }
    const keys = CAT_ORDER.filter(c => mix[c]);
    $('#h-mix').innerHTML = keys.map(c => `<i style="flex:${mix[c]};background:${catColor(c)}" title="${esc(msg('pano.mixTip', { cat: CATS[c].name, n: mix[c] }))}"></i>`).join('');
    $('#h-mixleg').innerHTML = keys.length
      ? keys.map(c => `<span><i class="sq" style="background:${catColor(c)}"></i>${esc(CATS[c].name)} <b>${mix[c]}</b></span>`).join('')
      : `<span>${esc(msg('pano.noneWorking'))}</span>`;
    renderCost();
  }

  // ------------------------------------------------------------ cards

  function makeCard() {
    const el = document.createElement('article');
    el.className = 'card';
    el.tabIndex = 0;
    el.innerHTML = `
      <div class="c-head"></div>
      <div class="c-title"></div>
      <div class="c-act"></div>
      <div class="strip"><canvas></canvas><div class="ax"><span>${esc(msg('time.minAgo', { n: STRIP_MIN }))}</span><span>${esc(msg('time.now'))}</span></div></div>
      <div class="stats"></div>
      <div class="subs" hidden></div>
      <div class="foot" hidden></div>`;
    el.addEventListener('click', e => {
      const sub = e.target.closest('[data-sub]');
      ctx.openDrawer(sub ? sub.dataset.sub : el.dataset.id);
    });
    el.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target === el) ctx.openDrawer(el.dataset.id); });
    const cv = el.querySelector('canvas');
    cv.addEventListener('mousemove', e => stripHover(el.dataset.id, cv, e));
    cv.addEventListener('mouseleave', () => ctx.tip.hide());
    return { el, cv, parts: {
      head: el.querySelector('.c-head'), title: el.querySelector('.c-title'), act: el.querySelector('.c-act'),
      stats: el.querySelector('.stats'), subs: el.querySelector('.subs'), foot: el.querySelector('.foot'),
    } };
  }

  function fillCard(c, a, t) {
    const { parts } = c;
    c.el.dataset.id = a.id;
    c.el.className = `card ${a.status}`;
    parts.head.innerHTML = `<span class="c-dot" style="background:${a.color}"></span><span class="c-proj">${esc(a.project)}</span>${ctx.statusPill(a, t)}`;
    parts.title.textContent = a.title || msg('pano.untitled');
    parts.title.title = `${a.title || ''}\n${a.name}`.trim();
    parts.act.innerHTML = ctx.activityHtml(a, t);

    const subs = store.subsOf(a.id);
    const ctxP = pct(a.ctx, a.ctxMax);
    const gcol = ctxP > 85 ? '#d03b3b' : ctxP > 65 ? '#fab219' : '#9085e9';
    parts.stats.innerHTML =
      `<span title="${esc(msg('dw.ctxTip', { a: fmtTok(a.ctx), b: fmtTok(a.ctxMax) }))}"><span class="gauge"><i style="width:${ctxP}%;background:${gcol}"></i></span><b>${fmtPct(ctxP)}</b>${esc(msg('pano.ctx'))}</span>` +
      `<span title="${esc(msg('pano.tokTip', { n: a.calls }))}"><b>${fmtTok(a.hourOut)}</b>${esc(msg('pano.tokPerH'))}</span>` +
      (a.usd != null ? `<span title="${esc(msg('pano.costTip', { subs: subs.length > 0 }))}"><b>${fmtUsd(a.usd)}</b></span>` : '') +
      (a.model ? `<span class="mdl">${esc(a.model)}${a.effort ? ' · ' + esc(a.effort) : ''}</span>` : '');

    const shown = subs.filter(s => s.status === 'working');
    if (shown.length) {
      parts.subs.hidden = false;
      const rest = shown.length - SUB_ROWS;
      parts.subs.innerHTML = `<h5>${esc(msg('pano.subsWorking', { n: shown.length }))}${subs.length > shown.length ? ` <span>${esc(msg('pano.subsTotal', { n: subs.length }))}</span>` : ''}</h5>` +
        shown.slice(0, SUB_ROWS).map(s => ctx.subRow(s, t)).join('') +
        (rest > 0 ? `<div class="more">${esc(msg('pano.moreSubs', { n: rest }))}</div>` : '');
    } else parts.subs.hidden = true;

    const foot = a.status === 'working' ? (a.lastText ? `<b>${esc(msg('pano.lastWords'))}</b>${esc(a.lastText)}` : a.summary ? `<b>${esc(msg('pano.summary'))}</b>${esc(a.summary)}` : '') : '';
    parts.foot.hidden = !foot;
    parts.foot.innerHTML = foot;
  }

  function renderCards() {
    const t = store.now();
    const mains = store.mains();
    // Sessions waiting on you come first (longest wait first); the rest keep a stable order.
    const isWait = a => a.status === 'waiting' || a.status === 'ask';
    const awake = [
      ...mains.filter(isWait).sort((x, y) => x.since - y.since),
      ...mains.filter(a => a.status !== 'dormant' && !isWait(a)),
    ];
    const seen = new Set();
    awake.forEach((a, i) => {
      let c = cards.get(a.id);
      if (!c) { c = makeCard(); cards.set(a.id, c); }
      seen.add(a.id);
      fillCard(c, a, t);
      if (cardsEl.children[i] !== c.el) cardsEl.insertBefore(c.el, cardsEl.children[i] || null);
    });
    for (const [id, c] of cards) if (!seen.has(id)) { c.el.remove(); cards.delete(id); }
    if (!mains.length) cardsEl.innerHTML = `<div class="empty">${esc(msg('pano.empty'))}</div>`;
    else cardsEl.querySelector('.empty')?.remove();

    const sleepers = mains.filter(a => a.status === 'dormant');
    sleepEl.innerHTML = sleepers.length ? `<div class="section-h">${esc(msg('pano.asleep', { n: sleepers.length }))}</div><div class="sleepers">` +
      sleepers.map(a => `<button class="sleeper" data-id="${esc(a.id)}" title="${esc(a.title || a.name)}"><span class="sq" style="background:${a.color}"></span><b>${esc(a.project)}</b><span>${esc(a.title || a.name)}</span><span class="faint">${fmtShort(t - a.since)}</span></button>`).join('') + '</div>' : '';
    sleepEl.querySelectorAll('.sleeper').forEach(b => b.addEventListener('click', () => ctx.openDrawer(b.dataset.id)));
    drawStrips();
  }

  // ------------------------------------------------------------ time strip

  function drawStrips() {
    if (!visible) return;
    for (const c of cards.values()) drawStrip(c.el.dataset.id, c.cv);
  }

  function spansOf(sub, t) {
    const evs = store.events(sub.id);
    if (!evs.length) return null;
    const s = evs[0].s;
    const e = sub.status === 'working' ? t : Math.max(...evs.slice(-6).map(ev => ev.e || ev.s));
    return [s, e];
  }

  const BAR_Y = 3, BAR_H = 8;

  function drawStrip(id, cv) {
    const a = store.agents.get(id);
    if (!a) return;
    const dpr = devicePixelRatio || 1;
    const w = cv.clientWidth, h = cv.clientHeight;
    if (!w) return;
    if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const t = store.now();
    const t0 = t - STRIP_MIN * 60e3;
    const X = ts => ((ts - t0) / (t - t0)) * w;

    // background
    g.fillStyle = 'rgba(255,255,255,.045)';
    g.beginPath(); g.roundRect(0, BAR_Y, w, BAR_H, BAR_H / 2); g.fill();

    g.save();
    g.beginPath(); g.roundRect(0, BAR_Y, w, BAR_H, BAR_H / 2); g.clip();
    const prompts = [];
    for (const ev of store.events(id)) {
      const e = ev.e == null ? t : ev.e;
      if (e < t0) continue;
      if (ev.c === 'prompt') { prompts.push(ev); continue; }
      if (ev.c === 'compact') continue;
      const x1 = Math.max(0, X(ev.s)), x2 = X(e);
      const bw = Math.max(1.5, x2 - x1);
      if (ev.c === 'wait') {
        // only the ongoing wait is colored; past waits stay as background
        if (ev.e == null && (a.status === 'waiting' || a.status === 'ask')) { g.fillStyle = 'rgba(250,178,25,.55)'; g.fillRect(x1, BAR_Y, bw, BAR_H); }
        continue;
      }
      g.fillStyle = catColor(ev.c);
      g.globalAlpha = ev.c === 'think' ? 0.7 : 1;
      g.fillRect(x1, BAR_Y, bw, BAR_H);
      g.globalAlpha = 1;
      if (ev.x === 1) { g.fillStyle = '#e5484d'; g.fillRect(x2 - 1.5, BAR_Y, 2, BAR_H); }
    }
    g.restore();
    // prompt markers: small dots above the strip
    g.fillStyle = 'rgba(230,233,239,.85)';
    for (const ev of prompts) { g.beginPath(); g.arc(X(ev.s), 1.6, 1.6, 0, Math.PI * 2); g.fill(); }

    // subagent concurrency: a thin, soft area below the strip
    const subs = store.subsOf(id);
    if (subs.length) {
      const spans = subs.map(s => spansOf(s, t)).filter(Boolean).filter(([, e]) => e >= t0);
      if (spans.length) {
        const cols = Math.ceil(w / 2);
        const vals = new Array(cols).fill(0);
        for (let i = 0; i < cols; i++) {
          const ts = t0 + (i / cols) * (t - t0);
          for (const [s, e] of spans) if (ts >= s && ts <= e) vals[i]++;
        }
        const max = Math.max(1, ...vals);
        const base = h, room = h - (BAR_Y + BAR_H + 3);
        g.fillStyle = 'rgba(213,81,129,.32)';
        g.beginPath();
        g.moveTo(0, base);
        vals.forEach((v, i) => g.lineTo(i * 2, base - (v / max) * room));
        g.lineTo(w, base);
        g.closePath();
        g.fill();
      }
    }
  }

  function stripHover(id, cv, e) {
    const t = store.now();
    const w = cv.clientWidth;
    const t0 = t - STRIP_MIN * 60e3;
    const ts = t0 + (e.offsetX / w) * (t - t0);
    const tol = ((t - t0) / w) * 3;
    const a = store.agents.get(id);
    if (e.offsetY > BAR_Y + BAR_H + 2) {
      const n = store.subsOf(id).map(s => spansOf(s, t)).filter(sp => sp && ts >= sp[0] && ts <= sp[1]).length;
      ctx.tip.show(`<div class="h"><span class="sq" style="background:#d55181"></span>${esc(msg('pano.subsWere', { n }))}</div><div class="m">${esc(msg('time.minAgo', { n: Math.round((t - ts) / 60e3) }))}</div>`, e.clientX, e.clientY);
      return;
    }
    let best = null;
    for (const ev of store.events(id)) {
      const end = ev.e == null ? t : ev.e;
      if (ts >= ev.s - tol && ts <= end + tol) {
        if (!best || (ev.c !== 'think' && ev.c !== 'wait') || (end - ev.s) < ((best.e || t) - best.s)) best = ev;
      }
    }
    if (best) ctx.tip.show(ctx.evTipHtml(best, a), e.clientX, e.clientY);
    else ctx.tip.hide();
  }

  return {
    show() { visible = true; renderHero(); renderCards(); timer = setInterval(() => { drawStrips(); }, 2000); },
    hide() { visible = false; clearInterval(timer); },
    update(full, d) {
      if (!visible) return;
      if (d && d.cost) { renderCost(); return; }
      renderHero(); renderCards();
    },
  };
}
