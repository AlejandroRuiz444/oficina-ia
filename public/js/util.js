// Shared helpers: categories, statuses, formatting, icons.
// Text comes from the i18n.js dictionary; the language is fixed at page load, so it can be built at module level.
import { t, locale, dec, serverText } from './i18n.js';

// Category colors passed the dataviz validator (dark background #12161d, 6 slots, all checks PASS).
const cat = (key, color) => ({ name: t('cat.' + key), color, verb: t('verb.' + key) });
export const CATS = {
  think: cat('think', '#9085e9'),
  shell: cat('shell', '#d95926'),
  read: cat('read', '#3987e5'),
  edit: cat('edit', '#199e70'),
  web: cat('web', '#c98500'),
  agent: cat('agent', '#d55181'),
  other: cat('other', '#7d8597'),
  ask: cat('ask', '#fab219'),
};
export const CAT_ORDER = ['think', 'shell', 'read', 'edit', 'web', 'agent', 'other'];

const status = (key, color) => ({ label: t('status.' + key), color });
export const STATUS = {
  working: status('working', '#22c55e'),
  waiting: status('waiting', '#fab219'),
  ask: status('ask', '#fab219'),
  ready: status('ready', '#2dd4bf'),
  dormant: status('dormant', '#646d80'),
  done: status('done', '#8a93a6'),
  stale: status('stale', '#646d80'),
};

const VERB_TOOLS = ['Read', 'Grep', 'Glob', 'LSP', 'Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'Bash', 'PowerShell', 'Monitor', 'TaskStop',
  'WebFetch', 'WebSearch', 'Agent', 'Task', 'SendMessage', 'Workflow', 'AskUserQuestion', 'ExitPlanMode', 'TodoWrite',
  'Skill', 'ToolSearch', 'Artifact', 'ScheduleWakeup'];
const VERB_BY_TOOL = Object.fromEntries(VERB_TOOLS.map(n => [n, t('tool.' + n)]));

export function verbOf(act) {
  if (!act) return '';
  if (act.c === 'think') return t('verb.think');
  if (act.n && act.n.startsWith('mcp:')) return t('verb.mcp', { srv: act.n.slice(4) });
  if (act.c === 'web' && (act.n === 'Bash' || act.n === 'PowerShell')) return t('verb.browser');
  if (act.code === 'waitSubs') return t('verb.waitSubs');
  return VERB_BY_TOOL[act.n] || (CATS[act.c] || CATS.other).verb;
}

// Activity description. Labels synthesized by the server come with a language-neutral `code`;
// while 'thinking', the model's thought summary (a.thought) is shown if there is one. The rest is transcript content.
export function actText(act, a) {
  if (!act) return '';
  if (act.code === 'waitSubs') return t('act.waitSubs', { n: act.m });
  if (act.code === 'thinking') return (a && a.thought) || t('act.thinking');
  if (act.code === 'working') return t('act.working');
  return serverText(act.l);
}

// Event name and description (time strip tooltip, drawer log).
export function evName(ev) {
  switch (ev.code) {
    case 'compact': return t('ev.compact');
    case 'prompt': return t('ev.prompt');
    case 'task': return t('ev.task');
    case 'scheduled': return t('ev.scheduled');
    case 'wait': return t('ev.wait');
  }
  return serverText(ev.n);
}
export function evText(ev) {
  switch (ev.code) {
    case 'think': return t('act.thinking');
    case 'compact': return t('ev.compacted');
    case 'wait': return t('status.waiting');
    case 'prompt': case 'task': case 'scheduled': return ev.l || '';
  }
  return serverText(ev.l);
}

export const catColor = c => (CATS[c] || CATS.other).color;

// ---------------------------------------------------------------- formatting

// Duration units: TR sn/dk/sa/g · EN s/m/h/d
const U = { s: t('u.s'), m: t('u.m'), h: t('u.h'), d: t('u.d') };

export function fmtDur(ms) {
  if (ms == null || !isFinite(ms)) return '';
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}${U.s}`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}${U.m} ${String(s % 60).padStart(2, '0')}${U.s}`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}${U.h} ${String(m % 60).padStart(2, '0')}${U.m}`;
  return `${Math.floor(h / 24)}${U.d} ${h % 24}${U.h}`;
}

export function fmtShort(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}${U.s}`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}${U.m}`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}${U.h} ${m % 60 ? (m % 60) + U.m : ''}`.trim();
  return `${Math.floor(h / 24)}${U.d}`;
}

// The clock is 24-hour in both languages (HH:MM[:SS]); no AM/PM, so it fits fixed-width columns.
export function fmtClock(ms, sec) {
  const d = new Date(ms);
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}${sec ? ':' + p(d.getSeconds()) : ''}`;
}

export function fmtTok(n) {
  if (!n) return '0';
  if (n < 1000) return String(n);
  if (n < 10e3) return dec((n / 1e3).toFixed(1)) + 'k';
  if (n < 1e6) return Math.round(n / 1e3) + 'k';
  if (n >= 1e9) return dec((n / 1e9).toFixed(n < 10e9 ? 2 : 1)) + t('num.billion');
  return dec((n / 1e6).toFixed(n < 10e6 ? 2 : 1)) + 'M';
}

// Dollars: equivalent at API list prices. Cents for small amounts, whole dollars for large ones.
// Separators follow the language: TR $1.540,50 · EN $1,540.50
const usdFmt = [0, 1, 2].map(d => new Intl.NumberFormat(locale, { minimumFractionDigits: d, maximumFractionDigits: d }));
export function fmtUsd(v, opts = {}) {
  if (v == null || !isFinite(v)) return '—';
  const a = Math.abs(v);
  const d = opts.digits != null ? opts.digits : a === 0 ? 0 : a < 10 ? 2 : a < 100 ? 1 : 0;
  if (opts.compact && a >= 10000) return '$' + usdFmt[1].format(v / 1000) + t('num.thousandUsd');
  return '$' + usdFmt[d].format(v);
}

// Model colors: separate from the category palette, in a fixed order. Dataviz validator (dark, background #14171e):
// adjacent CVD ΔE ≥ 10.9 · normal ≥ 21.4; the first three slots also pass on every pair, Opus 4 is ≥ 15 against all.
// Non-adjacent pairs can touch when a model is missing from a stack: the 2px background gap + tooltip are the secondary encoding.
// Color is tied to the model, not to its position.
export const MODEL_SLOTS = [
  { re: /opus-5(?:$|[^-\d]|-\d{8})/, name: 'Opus 5', color: '#718ce8' },
  { re: /opus-5-5/, name: 'Opus 5.5', color: '#b0486e' },
  { re: /sonnet/, name: 'Sonnet', color: '#69a45c' },
  { re: /fable|mythos/, name: 'Fable', color: '#b0540e' },
  { re: /opus-4/, name: 'Opus 4', color: '#7055b0' },
  { re: /haiku/, name: 'Haiku', color: '#179fa5' },
];
export const MODEL_OTHER = { name: t('model.other'), color: '#6b7385' };
export function modelSlot(model) {
  const i = MODEL_SLOTS.findIndex(s => s.re.test(model || ''));
  return i < 0 ? MODEL_SLOTS.length : i;
}
export function modelColor(model) {
  const i = modelSlot(model);
  return i < MODEL_SLOTS.length ? MODEL_SLOTS[i].color : MODEL_OTHER.color;
}
// "claude-opus-5-5" → "Opus 5.5", "claude-haiku-4-5-20251001" → "Haiku 4.5"
export function modelName(model) {
  const m = String(model || '').replace(/^claude-/, '').replace(/-\d{8}$/, '');
  const parts = m.split('-');
  const fam = parts.shift() || '?';
  return fam.charAt(0).toUpperCase() + fam.slice(1) + (parts.length ? ' ' + parts.join('.') : '');
}

export const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function mix(hex, other, t) {
  const a = parseHex(hex), b = parseHex(other);
  const r = a.map((v, i) => Math.round(v + (b[i] - v) * t));
  return `rgb(${r[0]},${r[1]},${r[2]})`;
}
export function parseHex(h) {
  if (h.startsWith('rgb')) return h.match(/\d+/g).slice(0, 3).map(Number);
  h = h.replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
}
export function alpha(hex, a) {
  const [r, g, b] = parseHex(hex);
  return `rgba(${r},${g},${b},${a})`;
}

// ---------------------------------------------------------------- icons (16px, currentColor)

const P = {
  think: '<circle cx="4" cy="8" r="1.3"/><circle cx="8" cy="8" r="1.3"/><circle cx="12" cy="8" r="1.3"/>',
  shell: '<path d="M3 4.5l3.5 3.5L3 11.5M8 12h5" fill="none"/>',
  read: '<path d="M3 3.5h10M3 6.5h10M3 9.5h7M3 12.5h5" fill="none"/>',
  edit: '<path d="M10.5 2.8l2.7 2.7-7.4 7.4H3.1v-2.7z" fill="none"/>',
  web: '<circle cx="8" cy="8" r="5.5" fill="none"/><path d="M2.5 8h11M8 2.5c2 2.2 2 8.8 0 11M8 2.5c-2 2.2-2 8.8 0 11" fill="none"/>',
  agent: '<circle cx="4" cy="4.5" r="1.8" fill="none"/><circle cx="12" cy="4.5" r="1.8" fill="none"/><circle cx="8" cy="12" r="1.8" fill="none"/><path d="M5.3 5.8l1.8 4.5M10.7 5.8l-1.8 4.5" fill="none"/>',
  other: '<circle cx="8" cy="8" r="2.2"/>',
  ask: '<path d="M6 6a2 2 0 1 1 2.8 1.8c-.6.3-.8.7-.8 1.3v.4" fill="none"/><circle cx="8" cy="11.8" r=".9"/>',
  wait: '<path d="M8 2.5v6M8 11.5v.5" fill="none"/>',
  close: '<path d="M4 4l8 8M12 4l-8 8" fill="none"/>',
  bell: '<path d="M4 11V7.5a4 4 0 0 1 8 0V11l1 1.2H3z M6.8 13.5a1.3 1.3 0 0 0 2.4 0" fill="none"/>',
  bellOff: '<path d="M4 11V7.5a4 4 0 0 1 8 0V11l1 1.2H3z M6.8 13.5a1.3 1.3 0 0 0 2.4 0M2.5 2.5l11 11" fill="none"/>',
  check: '<path d="M3.5 8.5l3 3 6-7" fill="none"/>',
  zz: '<path d="M4 5h4l-4 5h4M9.5 3h3l-3 3.5h3" fill="none"/>',
  clock: '<circle cx="8" cy="8" r="5.5" fill="none"/><path d="M8 5v3.2l2 1.3" fill="none"/>',
  ctx: '<rect x="2.5" y="3.5" width="11" height="9" rx="1.5" fill="none"/><path d="M5 6.5h6M5 9.5h3.5" fill="none"/>',
  bolt: '<path d="M9 2L4 9h3.5L7 14l5-7H8.5z" fill="none"/>',
  wrench: '<path d="M10.2 2.6a3.2 3.2 0 0 0-3.7 4.1l-3.9 3.9a1.3 1.3 0 0 0 1.9 1.9l3.9-3.9a3.2 3.2 0 0 0 4.1-3.7l-2 2-1.8-.5-.5-1.8z" fill="none"/>',
  people: '<circle cx="6" cy="5.5" r="2.2" fill="none"/><path d="M2.5 13c.4-2.2 1.8-3.4 3.5-3.4s3.1 1.2 3.5 3.4" fill="none"/><circle cx="11.2" cy="6.2" r="1.7" fill="none"/><path d="M10.5 9.8c1.6 0 2.7 1 3 3" fill="none"/>',
  arrow: '<path d="M6 3.5L10.5 8 6 12.5" fill="none"/>',
};
P.prompt = P.arrow;
P.compact = '<path d="M3 5h10M5 8h6M7 11h2" fill="none"/>';

export function icon(name, cls = '') {
  const body = P[name] || P.other;
  return `<svg class="ic ${cls}" viewBox="0 0 16 16" aria-hidden="true" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="currentColor">${body}</svg>`;
}

export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
