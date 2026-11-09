// Chat panel: a Claude-Code-like conversation per project room (live text, tool steps, approvals, mode/model/effort).
// Control needs the token the server printed (#t=...). Everything dynamic is escaped before it reaches innerHTML.
export const TOKEN = (() => {
  const m = /[#&]t=([0-9a-f]+)/.exec(location.hash);
  if (m) {
    try { sessionStorage.setItem('cco.t', m[1]); } catch {}
    try { history.replaceState(null, '', location.pathname + location.search); } catch {}
    return m[1];
  }
  try { return sessionStorage.getItem('cco.t') || ''; } catch { return ''; }
})();

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const keyOf = cwd => String(cwd).split(String.fromCharCode(92)).join('/').split('/').filter(Boolean).join('/').toLowerCase();
const projName = cwd => keyOf(cwd).split('/').pop() || String(cwd);
const md = t => (window.renderMd ? window.renderMd(t) : esc(t));
// bidi / zero-width characters made visible so a command cannot be visually disguised
const vis = t => String(t).replace(/[‪-‮⁦-⁩​-‏﻿]/g, c => '⟦U+' + c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0') + '⟧');
const cap = t => { t = String(t ?? ''); return t.length > 20000 ? t.slice(0, 20000) + '\n…(' + (t.length - 20000) + ' more characters not shown)' : t; };
const blk = (label, t) => (label ? label + '\n' : '') + cap(t);
const toolSummary = (name, i) => String((i && (i.command || i.file_path || i.path || i.pattern || i.url || i.description)) || '').slice(0, 120);

const OPT = 'cco.opts'; // per project: mode + model + effort (bypassPermissions is never stored: after a reload it comes back as the last other mode)
const loadOpts = () => { try { return JSON.parse(localStorage.getItem(OPT) || '{}'); } catch { return {}; } };
const saveOpts = o => { try { localStorage.setItem(OPT, JSON.stringify(o)); } catch {} };

async function post(path, body) {
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-office-token': TOKEN }, body: JSON.stringify(body) });
  return r.ok ? r.json() : { ok: false, error: 'HTTP ' + r.status };
}

// ---- approval cards: the full action, never just a path
function describe(p) {
  const i = p.input || {}, t = p.tool;
  let parts;
  if (t === 'Write') parts = [blk(i.file_path, i.content)];
  else if (t === 'Edit') parts = [i.file_path, blk('--- old_string', i.old_string), blk('+++ new_string', i.new_string)];
  else if (t === 'MultiEdit') parts = [i.file_path, ...(Array.isArray(i.edits) ? i.edits : []).filter(Boolean).map((e, n) => blk('--- #' + (n + 1) + ' old_string', e.old_string) + '\n' + blk('+++ #' + (n + 1) + ' new_string', e.new_string))];
  else if (t === 'NotebookEdit') parts = [blk(i.notebook_path || i.file_path, i.new_source)];
  else if (t === 'Bash') parts = [blk(i.description ? '# ' + i.description : '', i.command)];
  else parts = [cap(JSON.stringify(i, null, 2))];
  return parts.join('\n');
}
const SENSITIVE = /\.claude|\.git[\/\\]|\.env|settings(\.local)?\.json|hooks/i;
const warn = p => {
  const i = p.input || {};
  const hit = [i.file_path, i.notebook_path, i.path, i.command].some(v => SENSITIVE.test(String(v ?? '')));
  return hit ? '<div class="cwarn">⚠ toca configuración: ' + esc(vis(String(i.file_path || i.notebook_path || i.path || i.command).slice(0, 200))) + '</div>' : '';
};
const card = (p, withName) => {
  const plan = p.tool === 'ExitPlanMode';
  return '<div class="cperm"><b>' + (plan ? 'Plan propuesto' : esc(p.tool)) + '</b>' + (withName ? ' <span>' + esc(projName(p.cwd)) + '</span>' : '') + warn(p) +
    (plan ? '<div class="md plan">' + md(String((p.input && p.input.plan) || '')) + '</div>' : '<pre class="cact">' + esc(vis(describe(p))) + '</pre>') +
    '<button type="button" data-a="ok" data-id="' + esc(p.id) + '">' + (plan ? 'Aprobar plan' : 'Aprobar') + '</button>' +
    '<button type="button" data-a="no" data-id="' + esc(p.id) + '">' + (plan ? 'Rechazar plan' : 'Rechazar') + '</button></div>';
};

// ---- conversation items
function itemHtml(m) {
  const sub = m.sub ? ' sub' : '';
  if (m.role === 'user') return '<div class="cm user">' + esc(m.text) + '</div>';
  if (m.role === 'assistant' && m.kind === 'text') return '<div class="cm assistant md' + sub + '">' + md(m.text) + '</div>';
  if (m.role === 'assistant' && m.kind === 'thinking') return '<details class="cm think' + sub + '"><summary>Pensó…</summary><pre>' + esc(vis(m.text)) + '</pre></details>';
  if (m.role === 'tool' && m.kind === 'use') return '<details class="cm tool' + sub + '"><summary>' + esc(m.name) + ' <span>' + esc(vis(toolSummary(m.name, m.input))) + '</span></summary><pre>' + esc(vis(JSON.stringify(m.input, null, 2))) + '</pre></details>';
  if (m.role === 'tool' && m.kind === 'result') return '<details class="cm tres ' + (m.ok ? 'ok' : 'err') + sub + '"><summary>' + (m.ok ? 'resultado' : 'error') + '</summary><pre>' + esc(vis(m.text)) + '</pre></details>';
  if (m.kind === 'compact') return '<div class="cm compact">— ' + esc(m.text || 'Conversación compactada') + ' —</div>';
  return '<div class="cm system">' + esc(m.text || '') + '</div>';
}

export function initChat({ es }) {
  const root = document.getElementById('chat');
  root.innerHTML = '<div class="ch"></div><div class="cl"></div><div class="cap"></div>' +
    '<form class="cf"><div class="cs">' +
    '<select name="mode" title="Modo"><option value="default">Pedir permiso</option><option value="plan">Plan</option><option value="acceptEdits">Aceptar ediciones (sin tarjeta para editar archivos ni para comandos de archivos como rm/mv/cp en el proyecto)</option><option value="auto">Auto (decide solo, como en Claude Code)</option><option value="bypassPermissions">Sin preguntar (peligroso: sin permisos)</option></select>' +
    '<select name="model" title="Modelo"><option value="">Modelo: predeterminado</option><option value="sonnet">Sonnet</option><option value="opus">Opus</option><option value="haiku">Haiku</option></select>' +
    '<select name="effort" title="Esfuerzo"><option value="">Esfuerzo: predeterminado</option><option value="low">bajo</option><option value="medium">medio</option><option value="high">alto</option><option value="xhigh">muy alto</option><option value="max">máximo</option></select>' +
    '</div><div class="cr"><textarea rows="3" placeholder="Escribe una orden para este proyecto… (Enter envía, Shift+Enter salto de línea)"></textarea><button type="submit">Enviar</button></div></form>' +
    '<div class="ro cm system" hidden>Solo lectura: abre el enlace con #t=… que imprime el servidor para dar órdenes.</div>';
  const $ = s => root.querySelector(s);
  const head = $('.ch'), list = $('.cl'), cards = $('.cap'), form = $('.cf'), ta = $('textarea'), ro = $('.ro');
  const sel = n => form.elements[n];

  const msgs = new Map(), live = new Map(), modes = new Map(), confirmed = new Set(), drafts = new Map(), opened = new Map();
  let wantFocus = false;
  let perms = [], busy = new Set(), cur = null, view = 'normal';
  const opts = loadOpts();
  const curKey = () => (cur ? keyOf(cur.cwd) : null);
  const isDemo = () => String((cur && cur.id) || '').startsWith('demo-');
  const canControl = () => !!(TOKEN && cur && !isDemo());
  const push = m => { const a = msgs.get(m.key) || msgs.set(m.key, []).get(m.key); a.push(m); if (a.length > 400) a.splice(0, a.length - 400); };
  const nearBottom = () => list.scrollHeight - list.scrollTop - list.clientHeight < 80;

  function show() { root.hidden = !(cur || perms.length); root.classList.toggle('wide', view === 'wide'); root.classList.toggle('min', view === 'min'); }
  const modeOf = k => modes.get(k) || ((opts[k] || {}).mode !== 'bypassPermissions' && (opts[k] || {}).mode) || 'default';
  const isDanger = () => !!cur && modeOf(curKey()) === 'bypassPermissions';
  function paintHead() {
    root.classList.toggle('danger', isDanger());
    if (!cur) { head.innerHTML = perms.length ? '<b>Aprobaciones pendientes</b>' : ''; return; }
    const k = curKey();
    head.innerHTML = '<b>' + esc(cur.project) + '</b> <span>' + esc(cur.group || '') + '</span>' +
      (busy.has(k) || perms.some(p => keyOf(p.cwd) === k) ? '<button type="button" data-a="stop">Detener</button>' : '') +
      (canControl() && !busy.has(k) ? '<button type="button" data-a="compact" title="Resume la conversación para liberar contexto">Compactar</button>' : '') +
      (canControl() ? '<button type="button" data-a="pin" class="cswitch ' + (cur.pinned ? 'on' : 'off') + '" role="switch" aria-checked="' + (cur.pinned ? 'true' : 'false') + '" title="Interruptor manual: encendida = la sala queda despierta (Lista) aunque no haya sesión abierta">Sala ' + (cur.pinned ? 'activa' : 'inactiva') + '</button>' : '') +
      (canControl() && !cur.pinned ? '<button type="button" data-a="hide">Ocultar sala</button>' : '') +
      '<button type="button" data-a="wide">' + (view === 'wide' ? 'Estrechar' : 'Ampliar') + '</button>' +
      '<button type="button" data-a="min">' + (view === 'min' ? 'Abrir' : 'Detalles') + '</button>' +
      (isDanger() ? '<div class="cdanger">SIN PERMISOS: el agente puede hacer cualquier cosa</div>' : '');
  }
  function paintLive() { const n = list.querySelector('.live'); if (!n) return; const t = live.get(curKey()) || ''; n.innerHTML = t.length > 50000 ? esc(t) : t ? md(t) : ''; } // a runaway stream is shown as plain text
  function paintList() {
    if (!cur) { list.innerHTML = ''; return; }
    const near = nearBottom();
    list.innerHTML = (msgs.get(curKey()) || []).slice(-200).map(itemHtml).join('') + '<div class="cm assistant md live"></div>';
    const op = opened.get(curKey()); if (op) [...list.children].forEach((c, i) => { if (op.has(i) && c.tagName === 'DETAILS') c.open = true; });
    paintLive();
    if (near) list.scrollTop = list.scrollHeight;
  }
  let raf = 0;
  function liveSoon() {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; const near = nearBottom(); paintLive(); if (near) list.scrollTop = list.scrollHeight; });
  }
  function paintCards() {
    const k = curKey();
    cards.innerHTML = perms.map(p => card(p, !k || keyOf(p.cwd) !== k)).join('');
  }
  function paintForm() {
    const ctl = canControl();
    form.hidden = !ctl; ro.hidden = !cur || ctl;
    if (!cur) return;
    const k = curKey(), b = busy.has(k), o = opts[k] || {};
    ta.disabled = b; if (!b && wantFocus) { wantFocus = false; ta.focus(); } form.querySelector('button[type="submit"]').disabled = b;
    root.classList.toggle('danger', isDanger());
    sel('mode').value = modeOf(k); sel('model').value = o.model || ''; sel('effort').value = o.effort || '';
  }
  function paintAll() { show(); paintHead(); paintList(); paintCards(); paintForm(); }

  es.addEventListener('chat', e => {
    const m = JSON.parse(e.data); m.key = keyOf(m.key);
    if (m.kind === 'delta') { live.set(m.key, (live.get(m.key) || '') + m.text); if (m.key === curKey()) liveSoon(); return; }
    if (m.role === 'idle') { busy.delete(m.key); live.delete(m.key); }
    else { if (m.role === 'user') busy.add(m.key); if (m.kind === 'text' && !m.sub) live.delete(m.key); push(m); }
    if (m.key === curKey()) { paintList(); paintForm(); paintHead(); }
  });
  es.addEventListener('chatlog', e => {
    const all = JSON.parse(e.data); msgs.clear();
    for (const [k, a] of Object.entries(all)) msgs.set(keyOf(k), a.filter(m => m.role !== 'idle').map(m => ({ ...m, key: keyOf(m.key) })));
    paintList();
  });
  es.addEventListener('chatstate', e => { busy = new Set(JSON.parse(e.data).map(keyOf)); paintForm(); paintHead(); });
  es.addEventListener('perm', e => {
    perms = JSON.parse(e.data); window.__ccoPerms = perms.length; window.dispatchEvent(new Event('cco:perms'));
    show(); paintCards(); paintHead();
  });

  async function submit(forced) {
    const text = forced || ta.value.trim();
    if (!text || !canControl() || busy.has(curKey())) return;
    if (!forced) { ta.value = ''; drafts.delete(curKey()); wantFocus = document.activeElement === ta; }
    const k = curKey();
    const r = await post('/api/agent/send', { cwd: cur.cwd, text, mode: sel('mode').value, ...(sel('mode').value === 'bypassPermissions' && confirmed.has(k) && { confirmed: true }), model: sel('model').value, effort: sel('effort').value });
    if (!r.ok) { push({ key: k, role: 'system', text: 'No se pudo enviar: ' + (r.error || '?') }); paintList(); }
  }
  ta.addEventListener('input', () => { if (cur) drafts.set(curKey(), ta.value); });
  list.addEventListener('toggle', e => { if (e.target.tagName !== 'DETAILS' || !cur) return; const k = curKey(), i = [...list.children].indexOf(e.target); const s = opened.get(k) || opened.set(k, new Set()).get(k); e.target.open ? s.add(i) : s.delete(i); }, true);
  form.addEventListener('submit', e => { e.preventDefault(); submit(); });
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); } });
  form.addEventListener('change', e => {
    if (!cur || !e.target.name) return;
    const k = curKey();
    if (e.target.name === 'mode') {
      const v = e.target.value;
      if (v === 'bypassPermissions' && !confirmed.has(k)) {
        if (!confirm('MODO SIN PREGUNTAR\n\nEl agente podrá leer y escribir en cualquier lugar al que tu usuario tenga acceso y ejecutar cualquier comando, sin tarjetas de aprobación. Un archivo con instrucciones maliciosas podría hacerlo actuar sin que lo veas.\n\n¿Activar este modo para este proyecto (hasta recargar la página)?')) { e.target.value = modeOf(k); return; }
        confirmed.add(k);
      }
      modes.set(k, v);
      if (v !== 'bypassPermissions') { opts[k] = { ...(opts[k] || {}), mode: v }; saveOpts(opts); }
      paintHead(); paintForm();
    }
    else { opts[k] = { ...(opts[k] || {}), [e.target.name]: e.target.value }; saveOpts(opts); }
  });
  root.addEventListener('click', async e => {
    const b = e.target.closest('button[data-a]'); if (!b) return;
    const a = b.dataset.a;
    if (a === 'ok' || a === 'no') { await post('/api/perm', { id: b.dataset.id, allow: a === 'ok' }); return; }
    if (a === 'wide') { view = view === 'wide' ? 'normal' : 'wide'; show(); paintHead(); return; }
    if (a === 'min') { view = view === 'min' ? 'normal' : 'min'; show(); paintHead(); return; }
    if (!cur) return;
    if (a === 'compact') { await submit('/compact'); return; }
    if (a === 'pin') { // manual on/off switch of the room
      const want = !cur.pinned, k = curKey();
      const r = await post('/api/pin', { cwd: cur.cwd, pinned: want });
      if (r.ok) cur = { ...cur, pinned: r.pinned };
      else { push({ key: k, role: 'system', text: 'No se pudo cambiar el interruptor: ' + (r.error || '?') }); paintList(); }
      paintHead(); return;
    }
    if (a === 'stop') await post('/api/agent/stop', { cwd: cur.cwd });
    if (a === 'hide') { const r = await post('/api/hide', { cwd: cur.cwd, hidden: true }); if (r.ok) { cur = null; paintAll(); } }
  });

  return { show(agent) { if (cur) drafts.set(curKey(), ta.value); cur = agent; ta.value = (cur && drafts.get(curKey())) || ''; paintAll(); }, hide() { if (cur) drafts.set(curKey(), ta.value); cur = null; paintAll(); } };
}
