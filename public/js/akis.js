// Timeline: a swimlane chart with a lane for every session and subagent.
import { CATS, CAT_ORDER, catColor, fmtClock, esc } from './util.js';
import { hatch } from './pano.js';
import { t as msg } from './i18n.js';

const MAIN_H = 34, SUB_H = 20, GROUP_GAP = 14, TOP_PAD = 8;

export function createAkis(root, ctx) {
  const { store } = ctx;
  const scroll = root.querySelector('#akis-scroll');
  const cv = root.querySelector('#akis');
  const axis = root.querySelector('#akis-axis');
  const subsBox = root.querySelector('#akis-subs');
  const dormBox = root.querySelector('#akis-dormant');
  let rangeMin = 60;
  try { rangeMin = Number(localStorage.getItem('ajan-ofisi.range')) || 60; } catch { /* unavailable */ }
  let visible = false, timer = null, lanes = [], hoverLane = null;

  root.querySelector('#akis-legend').innerHTML =
    CAT_ORDER.map(c => `<span><i class="sq" style="background:${catColor(c)}"></i>${esc(CATS[c].name)}</span>`).join('') +
    `<span><i class="waitnow"></i>${esc(msg('akis.waitNow'))}</span><span><i class="hatch"></i>${esc(msg('akis.wait'))}</span>` +
    `<span><i class="sq" style="background:#e6e9ef;border-radius:50%;width:6px;height:6px"></i>${esc(msg('akis.prompt'))}</span>`;

  const rangeBtns = root.querySelectorAll('#akis-range button');
  const markRange = () => rangeBtns.forEach(b => b.classList.toggle('on', Number(b.dataset.r) === rangeMin));
  rangeBtns.forEach(b => b.addEventListener('click', () => {
    rangeMin = Number(b.dataset.r);
    try { localStorage.setItem('ajan-ofisi.range', rangeMin); } catch { /* unavailable */ }
    markRange(); draw();
  }));
  markRange();
  subsBox.addEventListener('change', draw);
  dormBox.addEventListener('change', draw);

  const labelW = () => (root.clientWidth < 520 ? 130 : root.clientWidth < 700 ? 150 : 250);

  function buildLanes(t0, t) {
    const out = [];
    let y = TOP_PAD;
    for (const m of store.mains()) {
      if (m.status === 'dormant' && !dormBox.checked) continue;
      out.push({ a: m, y, h: MAIN_H, main: true });
      y += MAIN_H;
      if (subsBox.checked) {
        for (const s of store.subsOf(m.id)) {
          const evs = store.events(s.id);
          if (!evs.length) continue;
          const last = evs[evs.length - 1];
          if ((s.status !== 'working') && (last.e || last.s) < t0) continue;
          out.push({ a: s, y, h: SUB_H, main: false });
          y += SUB_H;
        }
      }
      y += GROUP_GAP;
    }
    return { lanes: out, height: y + 10 };
  }

  function niceStep(min) {
    if (min <= 15) return [1, 5];
    if (min <= 60) return [5, 10];
    if (min <= 180) return [15, 30];
    return [30, 60];
  }

  function draw() {
    if (!visible) return;
    const dpr = devicePixelRatio || 1;
    const W = scroll.clientWidth;
    const t = store.now();
    const t0 = t - rangeMin * 60e3;
    const LW = labelW();
    const PW = W - LW - 16;
    const X = ts => LW + ((ts - t0) / (t - t0)) * PW;
    const built = buildLanes(t0, t);
    lanes = built.lanes;
    const H = Math.max(built.height, scroll.clientHeight);
    const [minor, major] = niceStep(rangeMin);

    // axis
    axis.width = W * dpr; axis.height = 26 * dpr; axis.style.width = W + 'px'; axis.style.height = '26px';
    const ga = axis.getContext('2d');
    ga.setTransform(dpr, 0, 0, dpr, 0, 0);
    ga.clearRect(0, 0, W, 26);
    // the width of the "now" label on the right depends on the language; keep clock labels clear of it
    const nowTxt = msg('time.now');
    ga.font = '500 11px "Segoe UI Variable Text", "Segoe UI", sans-serif';
    const nowW = ga.measureText(nowTxt).width;
    ga.font = '11px "Segoe UI Variable Text", "Segoe UI", sans-serif';
    ga.textBaseline = 'middle';
    const tickMax = Math.min(LW + PW - 30, LW + PW + 2 - nowW - ga.measureText('00:00').width / 2 - 6);
    const firstTick = Math.ceil(t0 / (minor * 60e3)) * minor * 60e3;
    for (let ts = firstTick; ts <= t; ts += minor * 60e3) {
      const isMajor = Math.round(ts / 60e3) % major === 0;
      if (!isMajor) continue;
      const x = X(ts);
      ga.fillStyle = '#646c7c';
      ga.textAlign = 'center';
      if (x > LW + 16 && x < tickMax) ga.fillText(fmtClock(ts), x, 13);
    }
    ga.fillStyle = '#b3bac7';
    ga.textAlign = 'right';
    ga.font = '500 11px "Segoe UI Variable Text", "Segoe UI", sans-serif';
    ga.fillText(nowTxt, LW + PW + 2, 13);
    ga.textAlign = 'left';
    ga.fillStyle = '#8b93a3';
    ga.font = '500 11.5px "Segoe UI Variable Text", "Segoe UI", sans-serif';
    ga.fillText(msg('akis.sessions', { min: rangeMin }), 20, 13);

    // lanes
    cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);

    for (let ts = firstTick; ts <= t; ts += minor * 60e3) {
      const isMajor = Math.round(ts / 60e3) % major === 0;
      if (!isMajor) continue;
      g.fillStyle = 'rgba(255,255,255,.035)';
      g.fillRect(Math.round(X(ts)), 0, 1, H);
    }

    let prevMain = null;
    for (const ln of lanes) {
      const a = ln.a;
      if (ln.main) {
        if (prevMain) { g.fillStyle = 'rgba(255,255,255,.035)'; g.fillRect(16, ln.y - GROUP_GAP / 2 - 0.5, W - 32, 1); }
        prevMain = ln;
      }
      if (hoverLane === ln) { g.fillStyle = 'rgba(255,255,255,.03)'; g.beginPath(); g.roundRect(8, ln.y, W - 16, ln.h, 8); g.fill(); }

      // label
      g.textBaseline = 'middle';
      g.textAlign = 'left';
      if (ln.main) {
        g.fillStyle = a.color;
        g.beginPath(); g.arc(24, ln.y + 11, 3.5, 0, Math.PI * 2); g.fill();
        g.fillStyle = a.status === 'dormant' ? '#8b93a3' : '#e6e9ef';
        g.font = '600 12.5px "Segoe UI Variable Text", "Segoe UI", sans-serif';
        const pw = fitText(g, a.project, LW - 56);
        g.fillText(pw, 34, ln.y + 11);
        g.font = '11.5px "Segoe UI Variable Text", "Segoe UI", sans-serif';
        g.fillStyle = '#8b93a3';
        g.fillText(fitText(g, a.title || a.name, LW - 56), 34, ln.y + 25);
        const st = a.status;
        const dot = st === 'working' || st === 'ready' ? '#22c55e' : st === 'waiting' || st === 'ask' ? '#fab219' : '#4a5263';
        g.fillStyle = dot;
        g.beginPath(); g.arc(LW - 14, ln.y + 11, 3, 0, Math.PI * 2); g.fill();
      } else {
        g.fillStyle = 'rgba(255,255,255,.07)';
        g.fillRect(24, ln.y, 1, ln.h);
        g.font = '11px "Segoe UI Variable Text", "Segoe UI", sans-serif';
        g.fillStyle = a.status === 'working' ? '#b3bac7' : '#646c7c';
        g.fillText(fitText(g, a.desc || a.atype, LW - 56), 36, ln.y + ln.h / 2);
      }

      // events
      const barH = ln.main ? 12 : 7;
      const by = ln.y + (ln.h - barH) / 2;
      g.fillStyle = 'rgba(255,255,255,.03)';
      g.beginPath(); g.roundRect(LW, by, PW, barH, barH / 2); g.fill();
      for (const ev of store.events(a.id)) {
        const e = ev.e == null ? t : ev.e;
        if (e < t0 || ev.s > t) continue;
        if (ev.c === 'prompt') {
          const x = X(ev.s);
          g.fillStyle = 'rgba(230,233,239,.85)';
          g.beginPath(); g.arc(x, by - 4, 2, 0, Math.PI * 2); g.fill();
          continue;
        }
        const x1 = Math.max(LW, X(ev.s)), x2 = Math.min(LW + PW, X(e));
        if (ev.c === 'compact') {
          g.strokeStyle = 'rgba(139,147,163,.6)'; g.setLineDash([2, 2]);
          g.beginPath(); g.moveTo(x1 + .5, ln.y + 2); g.lineTo(x1 + .5, ln.y + ln.h - 2); g.stroke(); g.setLineDash([]);
          continue;
        }
        const bw = Math.max(1.5, x2 - x1);
        if (ev.c === 'wait') {
          // the ongoing wait is soft yellow; past waits are nearly invisible
          const nowWait = ev.e == null && (a.status === 'waiting' || a.status === 'ask');
          g.fillStyle = nowWait ? 'rgba(250,178,25,.5)' : 'rgba(255,255,255,.06)';
          g.beginPath(); g.roundRect(x1, by, bw, barH, Math.min(3, bw / 2)); g.fill();
          if (nowWait && bw > 70 && ln.main) {
            g.fillStyle = '#fde7b0'; g.font = '500 10.5px "Segoe UI Variable Text", "Segoe UI", sans-serif';
            g.fillText(fitText(g, msg('log.wait'), bw - 10), x1 + 6, by + barH / 2 + 0.5);
          }
          continue;
        }
        g.fillStyle = catColor(ev.c);
        g.globalAlpha = ev.c === 'think' ? 0.7 : 0.92;
        g.beginPath(); g.roundRect(x1, by, bw, barH, Math.min(3, bw / 2)); g.fill();
        g.globalAlpha = 1;
        if (bw > 3) { g.fillStyle = '#0e1015'; g.fillRect(x2 - 0.5, by, 1, barH); }
        if (ev.x === 1) { g.fillStyle = '#e5484d'; g.fillRect(x2 - 2, by - 1, 2, barH + 2); }
        if (ev.e == null && ev.c !== 'think') {
          const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 250);
          g.fillStyle = `rgba(255,255,255,${0.2 + pulse * 0.35})`;
          g.fillRect(x2 - 2, by, 2, barH);
        }
      }
    }
    // "now" line
    g.fillStyle = 'rgba(230,233,239,.35)';
    g.fillRect(LW + PW - 1, 0, 1, H);
  }

  const fitCache = new Map();
  function fitText(g, s, max) {
    s = s || '';
    const key = g.font + '|' + max + '|' + s;
    let r = fitCache.get(key);
    if (r != null) return r;
    r = s;
    if (g.measureText(r).width > max) {
      let lo = 0, hi = s.length;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (g.measureText(s.slice(0, mid) + '…').width <= max) lo = mid; else hi = mid - 1;
      }
      r = s.slice(0, lo) + '…';
    }
    if (fitCache.size > 3000) fitCache.clear();
    fitCache.set(key, r);
    return r;
  }

  function laneAt(y) { return lanes.find(l => y >= l.y && y < l.y + l.h) || null; }

  cv.addEventListener('mousemove', e => {
    const r = cv.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const ln = laneAt(y);
    if (ln !== hoverLane) { hoverLane = ln; draw(); }
    cv.style.cursor = ln ? 'pointer' : 'default';
    if (!ln) return ctx.tip.hide();
    const LW = labelW();
    if (x < LW) {
      const a = ln.a;
      ctx.tip.show(`<div class="h"><span class="sq" style="background:${a.color}"></span>${esc(ln.main ? a.project + ' · ' + a.name : a.desc || a.atype)}</div>` +
        `<div class="m">${esc(ln.main ? a.title : a.atype)}</div>`, e.clientX, e.clientY);
      return;
    }
    const t = store.now();
    const t0 = t - rangeMin * 60e3;
    const PW = cv.clientWidth - LW - 16;
    const ts = t0 + ((x - LW) / PW) * (t - t0);
    const tol = ((t - t0) / PW) * 3;
    let best = null;
    for (const ev of store.events(ln.a.id)) {
      const end = ev.e == null ? t : ev.e;
      if (ts < ev.s - tol || ts > end + tol) continue;
      const pri = ev.c === 'prompt' ? 0 : ev.c === 'wait' ? 3 : ev.c === 'think' ? 2 : 1;
      if (!best || pri < best.pri || (pri === best.pri && end - ev.s < best.d)) best = { ev, pri, d: end - ev.s };
    }
    if (best) ctx.tip.show(ctx.evTipHtml(best.ev, ln.a), e.clientX, e.clientY);
    else ctx.tip.hide();
  });
  cv.addEventListener('mouseleave', () => { hoverLane = null; ctx.tip.hide(); draw(); });
  cv.addEventListener('click', e => {
    const r = cv.getBoundingClientRect();
    const ln = laneAt(e.clientY - r.top);
    if (ln) ctx.openDrawer(ln.a.id);
  });
  addEventListener('resize', () => draw());

  return {
    show() { visible = true; draw(); timer = setInterval(draw, 1000); },
    hide() { visible = false; clearInterval(timer); },
    update() { draw(); },
  };
}
