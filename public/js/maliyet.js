// Cost: the usage recorded in the transcripts, priced at API list prices.
// With a subscription this is not an actual bill; it is what the same usage would cost on the API.
import { fmtUsd, fmtTok, esc, MODEL_SLOTS, MODEL_OTHER, modelSlot, modelName } from './util.js';
import { t as msg, locale, fmtDate, fmtPct } from './i18n.js';

const TOTAL_COLOR = '#8f9bb3';
const SVG = 'http://www.w3.org/2000/svg';

const pad = n => String(n).padStart(2, '0');
const dayKey = ts => { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const parseDay = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
// Day labels follow the language: EN "Sunday, September 27" / "Sep 27"; TR puts the day first ("27 Eyl")
const dayLong = k => fmtDate('long', parseDay(k));
const dayShort = k => fmtDate('short', parseDay(k));
const nf0 = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });

function slotInfo(i) { return i < MODEL_SLOTS.length ? MODEL_SLOTS[i] : MODEL_OTHER; }

function niceTicks(max, want = 4) {
  if (!(max > 0)) return { step: 1, top: 1, ticks: [0, 1] };
  const raw = max / want;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) || 10 * mag;
  const top = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(v);
  return { step, top, ticks };
}

function el(tag, attrs = {}, parent) {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
}

// Bar path with a rounded top and a flat base.
function topRounded(x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h));
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

export function createMaliyet(root, ctx) {
  const { store } = ctx;
  let visible = false, data = null, loading = false, loadedScan = -1, lastTotalsKey = '';
  let range = 30, projAll = false;
  const tbl = { daily: false, hourly: false };
  try { range = Number(localStorage.getItem('ajan-ofisi.mrange')) === 90 ? 90 : 30; } catch { /* unavailable */ }

  root.innerHTML = `<div class="mly">
    <div class="mly-head">
      <div>
        <h2>${esc(msg('m.title'))}</h2>
        <p class="mly-note">${msg('m.note')}</p>
      </div>
      <div class="mly-scan" id="m-scan"></div>
    </div>
    <div class="mly-tiles" id="m-tiles"></div>
    <div class="mly-filter">
      <span>${esc(msg('m.range'))}</span>
      <div class="seg small" id="m-range"><button data-r="30">${esc(msg('m.last30'))}</button><button data-r="90">${esc(msg('m.last90'))}</button></div>
      <span class="faint" id="m-range-note"></span>
    </div>
    <div class="mly-grid">
      <section class="mcard" id="c-daily">
        <header><h3>${esc(msg('m.daily'))}</h3><span class="sub">${esc(msg('m.byModel'))}</span><button class="tbl-btn" data-t="daily" aria-pressed="false">${esc(msg('m.table'))}</button></header>
        <div class="mlegend" id="m-legend"></div>
        <div class="chart" id="m-daily"></div>
        <div class="mtable-wrap" id="m-daily-tbl" hidden></div>
        <div class="foot-note" id="m-daily-note"></div>
      </section>
      <section class="mcard" id="c-models">
        <header><h3>${esc(msg('m.models'))}</h3><span class="sub" id="m-models-sub"></span></header>
        <div class="mtable-wrap" id="m-models"></div>
      </section>
      <section class="mcard" id="c-hourly">
        <header><h3>${esc(msg('m.hourly'))}</h3><span class="sub" id="m-hourly-sub"></span><button class="tbl-btn" data-t="hourly" aria-pressed="false">${esc(msg('m.table'))}</button></header>
        <div class="chart" id="m-hourly"></div>
        <div class="mtable-wrap" id="m-hourly-tbl" hidden></div>
      </section>
      <section class="mcard" id="c-proj">
        <header><h3>${esc(msg('m.projects'))}</h3><span class="sub">${esc(msg('m.allTimeSub'))}</span></header>
        <div class="plist" id="m-proj"></div>
      </section>
    </div>
  </div>`;
  const $ = s => root.querySelector(s);

  // ------------------------------------------------------------ controls

  const rangeBtns = root.querySelectorAll('#m-range button');
  const markRange = () => rangeBtns.forEach(b => b.classList.toggle('on', Number(b.dataset.r) === range));
  rangeBtns.forEach(b => b.addEventListener('click', () => {
    range = Number(b.dataset.r);
    try { localStorage.setItem('ajan-ofisi.mrange', range); } catch { /* unavailable */ }
    markRange(); renderDaily(); renderModels();
  }));
  markRange();
  root.querySelectorAll('.tbl-btn').forEach(b => b.addEventListener('click', () => {
    const k = b.dataset.t;
    tbl[k] = !tbl[k];
    b.setAttribute('aria-pressed', String(tbl[k]));
    b.textContent = msg(tbl[k] ? 'm.chart' : 'm.table');
    if (k === 'daily') renderDaily(); else renderHourly();
  }));

  // ------------------------------------------------------------ data

  const now = () => store.now();
  const totals = () => (ctx.cost && ctx.cost.totals) || (data && data.totals) || null;

  async function load() {
    if (loading) return;
    loading = true;
    root.querySelectorAll('.mcard').forEach(c => c.classList.add('stale'));
    try {
      const r = await fetch('api/cost', { cache: 'no-store' });
      data = await r.json();
      loadedScan = data.scannedAt || 0;
    } catch { /* server unreachable: the previous drawing stays */ }
    loading = false;
    root.querySelectorAll('.mcard').forEach(c => c.classList.remove('stale'));
    if (visible) renderAll();
  }

  const dayTotal = k => Object.values((data && data.days[k]) || {}).reduce((x, v) => x + v[5], 0);
  function firstDay() {
    const ks = Object.keys((data && data.days) || {}).filter(k => dayTotal(k) > 0).sort();
    return ks[0] || null;
  }
  function lastDays(n) {
    const out = [];
    const t = now();
    for (let i = n - 1; i >= 0; i--) out.push(dayKey(t - i * 86400e3));
    // A DST change can produce the same day twice; dedupe.
    return [...new Set(out)];
  }
  // Group the models in range by color slot.
  function slotLabels(days) {
    const names = new Map();
    for (const k of days) for (const m of Object.keys((data.days[k]) || {})) {
      const s = modelSlot(m);
      if (!names.has(s)) names.set(s, new Set());
      names.get(s).add(modelName(m));
    }
    const lab = new Map();
    for (const [s, set] of names) lab.set(s, set.size === 1 ? [...set][0] : slotInfo(s).name);
    return lab;
  }

  // ------------------------------------------------------------ top section

  function renderScan() {
    const c = ctx.cost || (data && { progress: data.progress, scannedAt: data.scannedAt });
    const box = $('#m-scan');
    if (!c) { box.innerHTML = esc(msg('m.preparing')); return; }
    const p = c.progress;
    if (p && p.total) {
      const q = Math.round(((p.totalBytes ? p.bytes / p.totalBytes : p.done / p.total) || 0) * 100);
      box.innerHTML = `<span>${esc(msg('m.scanning'))}</span><span class="track"><i style="width:${q}%"></i></span><b>${fmtPct(q)}</b>` +
        `<span>${esc(msg('m.files', { a: nf0.format(p.done), b: nf0.format(p.total) }))}</span>`;
      box.title = msg('m.scanTip');
    } else if (c.scannedAt) {
      const d = new Date(c.scannedAt);
      box.innerHTML = `<span class="dot" style="background:var(--ok)"></span><span>${esc(msg('m.upToDate', { t: `${pad(d.getHours())}:${pad(d.getMinutes())}` }))}</span>`;
      box.title = msg('m.rescanTip');
    } else box.innerHTML = esc(msg('m.preparing'));
  }

  function renderTiles() {
    const T = totals();
    const t = now();
    const key = JSON.stringify(T) + '|' + (data ? data.scannedAt : '') + '|' + dayKey(t);
    if (key === lastTotalsKey) return;
    lastTotalsKey = key;
    const box = $('#m-tiles');
    if (!T) { box.innerHTML = `<div class="tile"><h4>${esc(msg('m.today'))}</h4><div class="big">…</div><div class="sub">${esc(msg('m.waitScan'))}</div></div>`; return; }
    const yest = data ? dayTotal(dayKey(t - 86400e3)) : null;
    const d = new Date(t);
    const fd = data && firstDay();
    const fdTxt = esc(fd ? fmtDate('since', parseDay(fd)) : msg('m.recorded'));
    const tile = (label, v, sub, cls = '', title = '') =>
      `<div class="tile ${cls}" ${title ? `title="${esc(title)}"` : ''}><h4>${esc(label)}</h4><div class="big">${fmtUsd(v)}</div><div class="sub">${sub}</div></div>`;
    box.innerHTML =
      tile(msg('m.today'), T.today, yest != null ? msg('m.yesterdayV', { v: `<b>${fmtUsd(yest)}</b>` }) : esc(msg('m.soFar')), 'hero-t') +
      tile(msg('m.thisHour'), T.hour, msg('m.prevHourV', { v: `<b>${fmtUsd(T.prevHour)}</b>` }), '', msg('m.hourTip', { h: pad(d.getHours()) })) +
      tile(msg('m.last7'), T.week, msg('m.avgDay', { v: `<b>${fmtUsd(T.week / 7)}</b>` })) +
      tile(msg('m.thisMonth'), T.month, esc(fmtDate('monthDays', d, { n: d.getDate() }))) +
      tile(msg('m.allTime'), T.all, fdTxt);
  }

  // ------------------------------------------------------------ daily chart

  function renderDaily() {
    const host = $('#m-daily'), tblBox = $('#m-daily-tbl'), leg = $('#m-legend'), note = $('#m-daily-note');
    if (!data) { host.innerHTML = `<div class="m-empty">${esc(msg('m.loading'))}</div>`; return; }
    const days = lastDays(range);
    const today = dayKey(now());
    const labels = slotLabels(days);
    const slots = [...labels.keys()].sort((a, b) => a - b);
    const rows = days.map(k => {
      const by = data.days[k] || {};
      const seg = new Array(MODEL_SLOTS.length + 1).fill(0);
      for (const [m, v] of Object.entries(by)) seg[modelSlot(m)] += v[5];
      const msgs = Object.values(by).reduce((x, v) => x + (v[6] || 0), 0);
      return { k, seg, total: seg.reduce((x, y) => x + y, 0), msgs };
    });
    const sumBySlot = new Array(MODEL_SLOTS.length + 1).fill(0);
    rows.forEach(r => r.seg.forEach((v, i) => { sumBySlot[i] += v; }));
    const rangeTotal = rows.reduce((x, r) => x + r.total, 0);
    const fd = firstDay();
    const activeDays = rows.filter(r => r.total > 0).length;

    $('#m-range-note').textContent = fd && fd > days[0] ? msg('m.recordsStart', { d: dayShort(fd) }) : '';
    leg.innerHTML = slots.map(s => `<span><i class="sq" style="background:${slotInfo(s).color}"></i>${esc(labels.get(s))} <b>${fmtUsd(sumBySlot[s])}</b></span>`).join('');
    const maxRow = rows.reduce((a, r) => (r.total > (a ? a.total : 0) ? r : a), null);
    note.innerHTML = rangeTotal ? msg('m.dailyNote', {
      a: `<b>${fmtUsd(rangeTotal)}</b>`, b: `<b>${fmtUsd(rangeTotal / Math.max(1, activeDays))}</b>`, c: `<b>${esc(dayShort(maxRow.k))}</b>`,
    }) : '';

    host.hidden = tbl.daily;
    tblBox.hidden = !tbl.daily;
    if (tbl.daily) {
      tblBox.innerHTML = `<table class="mtable"><thead><tr><th>${esc(msg('m.day'))}</th>${slots.map(s => `<th>${esc(labels.get(s))}</th>`).join('')}<th>${esc(msg('m.total'))}</th></tr></thead><tbody>` +
        rows.slice().reverse().filter(r => r.total > 0 || r.k === today).map(r =>
          `<tr><td>${esc(dayShort(r.k))}${r.k === today ? ` <span class="faint">${esc(msg('m.todayLc'))}</span>` : ''}</td>${slots.map(s => `<td class="muted">${r.seg[s] ? fmtUsd(r.seg[s]) : '—'}</td>`).join('')}<td class="usd">${fmtUsd(r.total)}</td></tr>`).join('') +
        '</tbody></table>';
      return;
    }

    const W = host.clientWidth;
    if (!W) return;
    const H = W < 520 ? 190 : 230;
    const M = { l: 50, r: 6, t: 20, b: 24 };
    const pw = W - M.l - M.r, ph = H - M.t - M.b;
    const { top, ticks } = niceTicks(maxRow ? maxRow.total : 0, W < 520 ? 3 : 4);
    const Y = v => M.t + ph - (v / top) * ph;
    const slotW = pw / rows.length;
    const bw = Math.max(2, Math.min(24, slotW * (rows.length > 45 ? 0.72 : 0.62)));
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, height: H, role: 'img', 'aria-label': msg('m.dailyAria', { n: range }) });
    const grid = el('g', { class: 'grid' }, svg);
    for (const v of ticks) {
      el('line', { x1: M.l, x2: W - M.r, y1: Math.round(Y(v)) + 0.5, y2: Math.round(Y(v)) + 0.5 }, grid);
      const tx = el('text', { x: M.l - 8, y: Y(v) + 4, 'text-anchor': 'end' }, svg);
      tx.textContent = fmtUsd(v, { digits: 0 });
    }
    // start of records
    if (fd && fd > days[0]) {
      const i0 = days.indexOf(fd);
      if (i0 > 0) {
        const x = M.l + i0 * slotW;
        if (x - M.l > 130) {
          const t = el('text', { x: M.l + (x - M.l) / 2, y: M.t + ph / 2, 'text-anchor': 'middle' }, svg);
          t.textContent = msg('m.noBefore', { d: dayShort(fd) });
        }
      }
    }
    const bars = el('g', {}, svg);
    rows.forEach((r, i) => {
      const g = el('g', { class: 'col' }, bars);
      const cx = M.l + i * slotW;
      el('rect', { class: 'wash', x: cx, y: M.t, width: slotW, height: ph, rx: 4 }, g);
      const x = cx + (slotW - bw) / 2;
      let yb = M.t + ph;
      const present = [];
      r.seg.forEach((v, s) => { if (v > 0) present.push(s); });
      present.forEach((s, j) => {
        const h = (r.seg[s] / top) * ph;
        const isTop = j === present.length - 1;
        const gap = isTop ? 0 : 2;
        const yt = yb - h;
        if (h - gap >= 0.6) {
          if (isTop) el('path', { class: 'seg', d: topRounded(x, yt, bw, h, 4), fill: slotInfo(s).color }, g);
          else el('rect', { class: 'seg', x, y: yt + gap, width: bw, height: h - gap, fill: slotInfo(s).color }, g);
        }
        yb = yt;
      });
      const hit = el('rect', { class: 'hit', x: cx, y: M.t, width: slotW, height: ph + M.b, tabindex: 0, 'aria-label': `${dayLong(r.k)}: ${fmtUsd(r.total)}` }, g);
      const show = (px, py) => {
        svg.classList.add('dim');
        bars.querySelectorAll('.col.on').forEach(n => n.classList.remove('on'));
        g.classList.add('on');
        ctx.tip.show(dailyTip(r, labels, today), px, py);
      };
      hit.addEventListener('pointermove', e => show(e.clientX, e.clientY));
      hit.addEventListener('focus', () => { const b = hit.getBoundingClientRect(); show(b.left + b.width / 2, b.top + 30); });
      const off = () => { svg.classList.remove('dim'); g.classList.remove('on'); ctx.tip.hide(); };
      hit.addEventListener('pointerleave', off);
      hit.addEventListener('blur', off);
    });
    // a single label on the peak day
    if (maxRow && maxRow.total > 0) {
      const i = rows.indexOf(maxRow);
      const x = M.l + i * slotW + slotW / 2;
      const t = el('text', { class: 'lbl', x: Math.min(W - M.r - 24, Math.max(M.l + 24, x)), y: Y(maxRow.total) - 7, 'text-anchor': 'middle' }, svg);
      t.textContent = fmtUsd(maxRow.total);
    }
    el('line', { class: 'base', x1: M.l, x2: W - M.r, y1: M.t + ph + 0.5, y2: M.t + ph + 0.5 }, svg);
    // x axis: evenly spaced, counting back from today
    const step = range <= 30 ? (W < 520 ? 10 : 7) : (W < 520 ? 30 : 14);
    rows.forEach((r, i) => {
      if ((rows.length - 1 - i) % step !== 0) return;
      const x = M.l + i * slotW + slotW / 2;
      if (x < M.l + 14) return;
      const t = el('text', { x, y: H - 6, 'text-anchor': i === rows.length - 1 ? 'end' : 'middle' }, svg);
      if (i === rows.length - 1) t.setAttribute('x', W - M.r);
      t.textContent = r.k === today ? msg('m.todayLc') : dayShort(r.k);
    });
    host.replaceChildren(svg);
  }

  function dailyTip(r, labels, today) {
    const order = [...r.seg.keys()].filter(s => r.seg[s] > 0).sort((a, b) => r.seg[b] - r.seg[a]);
    return `<div class="m">${esc(dayLong(r.k))}${r.k === today ? ' · ' + esc(msg('m.inProgress')) : ''}</div>` +
      `<div class="big">${fmtUsd(r.total)}</div>` +
      (order.length ? `<div class="rows">${order.map(s => `<span class="k" style="background:${slotInfo(s).color}"></span><span class="n">${esc(labels.get(s) || slotInfo(s).name)}</span><span class="v">${fmtUsd(r.seg[s])}</span><span class="p">${fmtPct(Math.round((r.seg[s] / r.total) * 100))}</span>`).join('')}</div>` : `<div class="m">${esc(msg('m.noRecords'))}</div>`) +
      (r.msgs ? `<div class="m" style="margin-top:6px">${esc(msg('m.replies', { n: r.msgs, v: nf0.format(r.msgs) }))}</div>` : '');
  }

  // ------------------------------------------------------------ hourly chart

  function renderHourly() {
    const host = $('#m-hourly'), tblBox = $('#m-hourly-tbl');
    if (!data) { host.innerHTML = `<div class="m-empty">${esc(msg('m.loading'))}</div>`; return; }
    const t = now();
    const today = dayKey(t), yest = dayKey(t - 86400e3);
    const curH = new Date(t).getHours();
    const hrs = Array.from({ length: 24 }, (_, h) => ({
      h, v: data.hours[`${today}T${pad(h)}`] || 0, y: data.hours[`${yest}T${pad(h)}`] || 0, future: h > curH,
    }));
    const sum = hrs.reduce((x, r) => x + r.v, 0);
    const ySum = hrs.filter(r => r.h <= curH).reduce((x, r) => x + r.y, 0);
    $('#m-hourly-sub').textContent = msg('m.hourlySub', { a: fmtUsd(sum), b: fmtUsd(ySum) });

    host.hidden = tbl.hourly;
    tblBox.hidden = !tbl.hourly;
    if (tbl.hourly) {
      tblBox.innerHTML = `<table class="mtable"><thead><tr><th>${esc(msg('m.hour'))}</th><th>${esc(msg('m.todayCol'))}</th><th>${esc(msg('m.yesterday'))}</th></tr></thead><tbody>` +
        hrs.filter(r => !r.future).reverse().map(r => `<tr><td>${pad(r.h)}:00${r.h === curH ? ` <span class="faint">${esc(msg('m.inProgress'))}</span>` : ''}</td><td class="usd">${fmtUsd(r.v)}</td><td class="muted">${fmtUsd(r.y)}</td></tr>`).join('') +
        '</tbody></table>';
      return;
    }
    const W = host.clientWidth;
    if (!W) return;
    const H = W < 520 ? 170 : 200;
    const M = { l: 46, r: 6, t: 20, b: 24 };
    const pw = W - M.l - M.r, ph = H - M.t - M.b;
    const max = Math.max(0, ...hrs.map(r => r.v));
    const { top, ticks } = niceTicks(max, 3);
    const Y = v => M.t + ph - (v / top) * ph;
    const slotW = pw / 24;
    const bw = Math.max(3, Math.min(24, slotW * 0.62));
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, height: H, role: 'img', 'aria-label': msg('m.hourlyAria') });
    const grid = el('g', { class: 'grid' }, svg);
    for (const v of ticks) {
      el('line', { x1: M.l, x2: W - M.r, y1: Math.round(Y(v)) + 0.5, y2: Math.round(Y(v)) + 0.5 }, grid);
      const tx = el('text', { x: M.l - 8, y: Y(v) + 4, 'text-anchor': 'end' }, svg);
      tx.textContent = fmtUsd(v, { digits: 0 });
    }
    const bars = el('g', {}, svg);
    hrs.forEach(r => {
      const g = el('g', { class: 'col' }, bars);
      const cx = M.l + r.h * slotW;
      el('rect', { class: 'wash', x: cx, y: M.t, width: slotW, height: ph, rx: 4 }, g);
      const x = cx + (slotW - bw) / 2;
      if (r.v > 0) {
        const h = Math.max(1, (r.v / top) * ph);
        el('path', { class: 'seg', d: topRounded(x, M.t + ph - h, bw, h, 4), fill: TOTAL_COLOR, 'fill-opacity': r.h === curH ? 0.6 : 1 }, g);
      }
      if (r.future) return;
      const hit = el('rect', { class: 'hit', x: cx, y: M.t, width: slotW, height: ph + M.b, tabindex: 0, 'aria-label': `${pad(r.h)}:00: ${fmtUsd(r.v)}` }, g);
      const show = (px, py) => {
        svg.classList.add('dim');
        bars.querySelectorAll('.col.on').forEach(n => n.classList.remove('on'));
        g.classList.add('on');
        ctx.tip.show(`<div class="m">${pad(r.h)}:00 – ${pad((r.h + 1) % 24)}:00${r.h === curH ? ' · ' + esc(msg('m.inProgress')) : ''}</div><div class="big">${fmtUsd(r.v)}</div>` +
          `<div class="m" style="margin-top:4px">${esc(msg('m.sameHourYest', { v: fmtUsd(r.y) }))}</div>`, px, py);
      };
      hit.addEventListener('pointermove', e => show(e.clientX, e.clientY));
      hit.addEventListener('focus', () => { const b = hit.getBoundingClientRect(); show(b.left + b.width / 2, b.top + 30); });
      const off = () => { svg.classList.remove('dim'); g.classList.remove('on'); ctx.tip.hide(); };
      hit.addEventListener('pointerleave', off);
      hit.addEventListener('blur', off);
    });
    const peak = hrs.reduce((a, r) => (r.v > (a ? a.v : 0) ? r : a), null);
    if (peak && peak.v > 0) {
      const x = M.l + peak.h * slotW + slotW / 2;
      const t2 = el('text', { class: 'lbl', x: Math.min(W - M.r - 20, Math.max(M.l + 20, x)), y: Y(peak.v) - 7, 'text-anchor': 'middle' }, svg);
      t2.textContent = fmtUsd(peak.v);
    }
    el('line', { class: 'base', x1: M.l, x2: W - M.r, y1: M.t + ph + 0.5, y2: M.t + ph + 0.5 }, svg);
    const every = W < 520 ? 6 : 3;
    for (let h = 0; h < 24; h += every) {
      const tx = el('text', { x: M.l + h * slotW + slotW / 2, y: H - 6, 'text-anchor': 'middle' }, svg);
      tx.textContent = pad(h);
    }
    host.replaceChildren(svg);
  }

  // ------------------------------------------------------------ models

  function renderModels() {
    const box = $('#m-models');
    if (!data) { box.innerHTML = `<div class="m-empty">${esc(msg('m.loading'))}</div>`; return; }
    const days = lastDays(range);
    const agg = new Map();
    for (const k of days) for (const [m, v] of Object.entries(data.days[k] || {})) {
      const a = agg.get(m) || [0, 0, 0, 0, 0, 0, 0];
      v.forEach((x, i) => { a[i] += x || 0; });
      agg.set(m, a);
    }
    $('#m-models-sub').textContent = msg('m.modelsSub', { n: range });
    const list = [...agg.entries()].sort((a, b) => b[1][5] - a[1][5]);
    if (!list.length) { box.innerHTML = `<div class="m-empty">${esc(msg('m.noRange'))}</div>`; return; }
    const tot = [0, 0, 0, 0, 0, 0, 0];
    list.forEach(([, v]) => v.forEach((x, i) => { tot[i] += x; }));
    const row = (name, sw, v, cls = '') => `<tr class="${cls}"><td>${sw}${name}</td>` +
      `<td class="opt" title="${nf0.format(v[0])}">${fmtTok(v[0])}</td>` +
      `<td title="${nf0.format(v[1])}">${fmtTok(v[1])}</td>` +
      `<td class="opt" title="${nf0.format(v[2] + v[3])}">${fmtTok(v[2] + v[3])}</td>` +
      `<td title="${nf0.format(v[4])}">${fmtTok(v[4])}</td>` +
      `<td class="usd" title="${tot[5] ? esc(msg('m.share', { p: fmtPct(Math.round((v[5] / tot[5]) * 100)) })) : ''}">${fmtUsd(v[5])}</td></tr>`;
    const th = (key, tipKey, cls = '') => `<th${cls ? ` class="${cls}"` : ''}${tipKey ? ` title="${esc(msg(tipKey))}"` : ''}>${esc(msg(key))}</th>`;
    box.innerHTML = `<table class="mtable"><thead><tr>${th('m.model')}` +
      `${th('m.in', 'm.inTip', 'opt')}${th('m.out')}` +
      `${th('m.cw', 'm.cwTip', 'opt')}${th('m.cr', 'm.crTip')}${th('m.cost')}</tr></thead><tbody>` +
      list.map(([m, v]) => row(esc(modelName(m)), `<i class="sq" style="background:${slotInfo(modelSlot(m)).color}"></i>`, v)).join('') +
      (list.length > 1 ? row(esc(msg('m.total')), '', tot, 'total') : '') +
      '</tbody></table>';
  }

  // ------------------------------------------------------------ projects

  function renderProjects() {
    const box = $('#m-proj');
    if (!data) { box.innerHTML = `<div class="m-empty">${esc(msg('m.loading'))}</div>`; return; }
    const list = Object.entries(data.projects || {}).filter(([, p]) => p.usd > 0).sort((a, b) => b[1].usd - a[1].usd);
    if (!list.length) { box.innerHTML = `<div class="m-empty">${esc(msg('m.noRecords'))}</div>`; return; }
    const max = list[0][1].usd;
    const LIMIT = 10;
    const shown = projAll ? list : list.slice(0, LIMIT);
    const t = now();
    const ago = ts => {
      if (!ts) return '';
      const m = Math.round((t - ts) / 60e3);
      if (m < 60) return msg('time.minAgo', { n: Math.max(1, m) });
      if (m < 60 * 24) return msg('time.hAgo', { n: Math.round(m / 60) });
      return msg('time.dAgo', { n: Math.round(m / 1440) });
    };
    const projTip = (name, p) => `${p.cwd || name}\n${msg('m.replies', { n: p.msgs || 0, v: nf0.format(p.msgs || 0) })} · ${fmtTok(p.out)} ${msg('dw.outTok')}` +
      `\n${msg('m.lastAct', { ago: ago(p.last) })}`;
    box.innerHTML = shown.map(([name, p]) =>
      `<div class="prow" title="${esc(projTip(name, p))}">` +
      `<div class="pn"><b>${esc(name)}</b><small>${esc(msg('m.sessions', { n: p.sessions || 0 }))}</small></div>` +
      `<div class="pb"><i style="width:${(p.usd / max) * 100}%"></i></div>` +
      `<div class="pv">${fmtUsd(p.usd)}</div></div>`).join('') +
      (list.length > LIMIT ? `<button class="ghost-btn" id="m-proj-more">${esc(projAll ? msg('common.showLess') : msg('common.showAll', { n: list.length }))}</button>` : '');
    const more = $('#m-proj-more');
    if (more) more.addEventListener('click', () => { projAll = !projAll; renderProjects(); });
  }

  function renderAll() {
    lastTotalsKey = '';
    renderScan(); renderTiles(); renderDaily(); renderModels(); renderHourly(); renderProjects();
  }

  // redraw the charts when the width changes
  let lastW = 0, rz = null;
  const ro = new ResizeObserver(() => {
    const w = root.clientWidth;
    if (!visible || w === lastW) return;
    lastW = w;
    clearTimeout(rz);
    rz = setTimeout(() => { renderDaily(); renderHourly(); }, 80);
  });
  ro.observe(root);

  let hourTimer = null;
  return {
    show() {
      visible = true;
      renderScan(); renderTiles();
      const scan = ctx.cost ? ctx.cost.scannedAt || 0 : -2;
      if (!data || scan !== loadedScan) load(); else renderAll();
      // refresh when the hour rolls over, even if no new scan arrives
      hourTimer = setInterval(() => { if (data) { renderHourly(); renderTiles(); } }, 60e3);
    },
    hide() { visible = false; clearInterval(hourTimer); ctx.tip.hide(); },
    update(full, d) {
      if (!visible) return;
      renderTiles();
      if (d && d.cost) {
        renderScan();
        const scan = ctx.cost ? ctx.cost.scannedAt || 0 : 0;
        if (scan && scan !== loadedScan) load();
      }
    },
  };
}
