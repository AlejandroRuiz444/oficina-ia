'use strict';
// Claude Code Office — live, local visualizer for your Claude Code sessions.
// Sources: ~/.claude/sessions/*.json (live sessions) + projects/**/<sessionId>.jsonl
// (transcripts) + <sessionId>/subagents/agent-*.jsonl (subagents). Read-only.
// Single runtime dependency (@anthropic-ai/claude-agent-sdk, control panel only). Standalone it binds to 127.0.0.1 only; it can also be mounted
// into an existing Express/Connect app via createOffice().handler.

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { StringDecoder } = require('string_decoder');
const { Worker } = require('worker_threads');
const { makeGuard } = require('./lib/guard');
const projects = require('./lib/projects');
const { createPermQueue } = require('./lib/permissions');
const { createControl, cleanOpts } = require('./control');
const { createHistory } = require('./lib/history');
const { seedHistory } = require('./lib/transcript');
const { isPanelSession, pinStatus } = require('./lib/rooms');
let guard = null; // set in listen(); null when mounted into another server → no control endpoints

const HOME = os.homedir();
const HOST = '127.0.0.1';
const PUBLIC = path.join(__dirname, 'public');
const VERSION = (() => { try { return require('./package.json').version; } catch { return '0.0.0'; } })();
const expandHome = p => (p && p.startsWith('~') ? path.join(HOME, p.slice(1)) : p);

// Set by configure(); defaults match a plain `npx claude-code-office`.
let CLAUDE_DIR = path.join(HOME, '.claude');
let SESS_DIR = path.join(CLAUDE_DIR, 'sessions');
let PROJ_DIR = path.join(CLAUDE_DIR, 'projects');
let DATA_DIR = path.join(HOME, '.claude-code-office');
let COLORS_FILE = null;
let INLINE_COLORS = {};
let CSWAP_URL = null;
let DEMO = false;
let SITE = null;
let demo = null;

function readJsonFile(f) {
  try { return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, '')); } catch { return null; }
}
// Optional local settings (never committed): <app>/config.local.json, then ~/.claude-code-office/config.json.
function loadConfigFiles() {
  return Object.assign({}, readJsonFile(path.join(HOME, '.claude-code-office', 'config.json')) || {},
    readJsonFile(path.join(__dirname, 'config.local.json')) || {});
}
function configure(o) {
  CLAUDE_DIR = path.resolve(expandHome(o.claudeDir || process.env.CLAUDE_CONFIG_DIR || path.join(HOME, '.claude')));
  SESS_DIR = path.join(CLAUDE_DIR, 'sessions');
  PROJ_DIR = path.join(CLAUDE_DIR, 'projects');
  DATA_DIR = path.resolve(expandHome(o.dataDir || path.join(HOME, '.claude-code-office')));
  COLORS_FILE = o.projectColorsFile ? path.resolve(expandHome(o.projectColorsFile)) : null;
  INLINE_COLORS = o.projectColors || {};
  CSWAP_URL = o.cswapUrl || null;
  DEMO = !!o.demo;
  SITE = o.site || null;
}

const MAIN_TAIL = 6 * 1024 * 1024;     // on first read, only the last 6 MB of a main transcript
const SUB_TAIL = 3 * 1024 * 1024;
const READ_CHUNK = 16 * 1024 * 1024;
const HISTORY_MS = 6 * 3600e3;         // event history kept in memory
const SNAP_MS = 3 * 3600e3;            // history sent to a newly connected client
const SUB_KEEP_MS = 3 * 3600e3;        // subagent files older than this are ignored
const SUB_STALE_MS = 45 * 60e3;        // an unfinished subagent with no new records counts as "stale"
const MAX_EVENTS = 900;
const SPARK_MIN = 60;

// ---------------------------------------------------------------- helpers

const now = () => Date.now();
const clip = (s, n) => {
  if (s == null) return '';
  s = String(s).replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};
const baseName = p => (p ? String(p).split(/[\\/]/).filter(Boolean).pop() || String(p) : '');
const firstLine = s => (s ? String(s).split('\n').find(l => l.trim()) || '' : '');

const PALETTE = ['#5B9BD5', '#4FB3BF', '#6DBE73', '#E0B04E', '#B8C25A', '#5CC8A8', '#9B87D4', '#D080B8', '#8AA4D6', '#E08A6E'];
let projectColors = {};
let colorsReadAt = 0;
function loadColors() {
  if (now() - colorsReadAt < 30e3) return;
  colorsReadAt = now();
  projectColors = Object.assign({}, INLINE_COLORS, (COLORS_FILE && readJsonFile(COLORS_FILE)) || {});
}
function colorFor(project) {
  loadColors();
  if (projectColors[project]) return projectColors[project];
  let h = 0;
  for (const ch of project) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

// ---------------------------------------------------------------- tool classification

const CAT_BY_TOOL = {
  Bash: 'shell', PowerShell: 'shell', Monitor: 'shell', TaskStop: 'shell', KillShell: 'shell', BashOutput: 'shell',
  Read: 'read', Grep: 'read', Glob: 'read', LSP: 'read', NotebookRead: 'read',
  ReadMcpResourceTool: 'read', ListMcpResourcesTool: 'read', ReadMcpResourceDirTool: 'read',
  Edit: 'edit', Write: 'edit', MultiEdit: 'edit', NotebookEdit: 'edit',
  WebFetch: 'web', WebSearch: 'web',
  Agent: 'agent', Task: 'agent', SendMessage: 'agent', Workflow: 'agent', ListAgents: 'agent',
  AskUserQuestion: 'ask', ExitPlanMode: 'ask',
};

function categorize(name, input) {
  if (name.startsWith('mcp__')) return 'web';
  const c = CAT_BY_TOOL[name];
  if (c === 'shell' && input && typeof input.command === 'string' &&
      /browser-harness|\bcurl\b|\bwget\b|Invoke-WebRequest/.test(input.command)) return 'web';
  return c || 'other';
}

function toolName(name) {
  if (name.startsWith('mcp__')) {
    const srv = name.split('__')[1] || 'mcp';
    return 'mcp:' + srv.replace(/^claude_ai_/, '').replace(/^plugin_[^_]+_/, '');
  }
  return name;
}

function toolLabel(name, inp) {
  inp = inp || {};
  try {
    switch (name) {
      case 'Bash': case 'PowerShell': return inp.description || firstLine(inp.command);
      case 'Monitor': return inp.description || firstLine(inp.command) || 'İzleniyor';
      case 'Read': return baseName(inp.file_path);
      case 'Edit': case 'MultiEdit': case 'Write': return baseName(inp.file_path);
      case 'NotebookEdit': return baseName(inp.notebook_path);
      case 'Grep': return `"${inp.pattern}"` + (inp.path ? ' · ' + baseName(inp.path) : '');
      case 'Glob': return inp.pattern;
      case 'WebFetch': try { return new URL(inp.url).hostname; } catch { return inp.url; }
      case 'WebSearch': return inp.query;
      case 'Agent': case 'Task': return inp.description || inp.subagent_type || 'Alt ajan';
      case 'Skill': return inp.skill;
      case 'ToolSearch': return inp.query;
      case 'SendMessage': return '→ ' + (inp.to || '');
      case 'AskUserQuestion': return (inp.questions && inp.questions[0] && inp.questions[0].question) || 'Soru';
      case 'ExitPlanMode': return 'Plan onayı';
      case 'TodoWrite': return 'Görev listesi';
      case 'ScheduleWakeup': return inp.reason || 'Uyanma planı';
      case 'Artifact': return inp.action || 'Artifact';
    }
  } catch { /* unexpected input shape */ }
  if (name.startsWith('mcp__')) return name.split('__').slice(2).join('__');
  return name;
}

function toolDetail(name, inp) {
  inp = inp || {};
  if (inp.command) return clip(inp.command, 320);
  if (inp.file_path) return clip(inp.file_path, 320);
  if (inp.url) return clip(inp.url, 320);
  if (inp.prompt) return clip(inp.prompt, 320);
  if (inp.pattern) return clip(`${inp.pattern} ${inp.path || ''}`, 320);
  if (inp.query) return clip(inp.query, 320);
  try { return clip(JSON.stringify(inp), 240); } catch { return ''; }
}

function prettyModel(m) {
  if (!m) return '';
  const r = /claude-(opus|sonnet|haiku|fable)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?/.exec(m);
  if (!r) return m;
  const fam = r[1][0].toUpperCase() + r[1].slice(1);
  return `${fam} ${r[2]}${r[3] ? '.' + r[3] : ''}`;
}

function isHumanPrompt(text) {
  const t = text.trimStart();
  return !/^<(command-|local-command|task-notification|system-reminder|bash-|user-memory|teammate)/.test(t) &&
         !t.startsWith('Caveat:');
}

// ---------------------------------------------------------------- state

const agents = new Map();          // id -> Agent
const outEvents = new Map();       // events to send on this tick
const removed = new Set();
const lastSent = new Map();        // id -> JSON summary (change detection)
let sessionFiles = new Map();      // pid -> session json

class Agent {
  constructor(o) {
    Object.assign(this, {
      id: '', kind: 'main', parent: null, sid: '', pid: null, name: '', cwd: '', project: '', color: '#9A9A9A',
      title: '', desc: '', atype: '', bg: false, depth: 0,
      file: null, offset: 0, dec: new StringDecoder('utf8'), buf: '', skipFirst: false, lookedAt: 0,
      pending: new Map(), events: [], seq: 0,
      msgTok: new Map(), buckets: new Map(), tools: {}, cats: {},
      genStart: null, curThink: null, curWait: null, turnEnded: false, endAt: null,
      lastText: '', lastPrompt: '', summary: '', thought: '',
      model: '', effort: '', ctx: 0, ctxMax: 0, big: false, tokOut: 0, calls: 0, prompts: 0,
      started: null, updated: null, sess: null,
    }, o);
  }
}

function pushEvent(a, ev) {
  ev.a = a.id;
  a.events.push(ev);
  if (a.events.length > MAX_EVENTS) a.events.splice(0, a.events.length - MAX_EVENTS);
  outEvents.set(ev.id, ev);
  return ev;
}
const touch = ev => { outEvents.set(ev.id, ev); };

function bucket(a, ts) {
  const k = Math.floor(ts / 60e3);
  let b = a.buckets.get(k);
  if (!b) { b = { o: 0, t: 0 }; a.buckets.set(k, b); }
  return b;
}

function closeThink(a, ts) {
  if (a.curThink) { a.curThink.e = Math.max(a.curThink.s, ts); touch(a.curThink); a.curThink = null; }
}

function turnStart(a, ts) {
  a.turnEnded = false;
  a.endAt = null;
  a.genStart = ts;
  if (a.curWait) { a.curWait.e = ts; touch(a.curWait); a.curWait = null; }
  for (const ev of a.pending.values()) { ev.e = ts; ev.x = 2; touch(ev); } // tools left unfinished
  a.pending.clear();
}

function ingest(a, r) {
  const ts = r.timestamp ? Date.parse(r.timestamp) : null;
  if (ts) {
    if (!a.started || ts < a.started) a.started = ts;
    if (!a.updated || ts > a.updated) a.updated = ts;
  }
  switch (r.type) {
    case 'ai-title': if (r.aiTitle) a.title = r.aiTitle; return;
    case 'last-prompt': if (r.lastPrompt && a.kind === 'main') a.lastPrompt = clip(r.lastPrompt, 400); return;
    case 'system': return onSystem(a, r, ts);
    case 'attachment': {
      const at = r.attachment;
      if (at && at.type === 'model' && at.identity) a.big = /\[1m\]/.test(at.identity.modelId || '');
      return;
    }
    case 'user': return onUser(a, r, ts);
    case 'assistant': return onAssistant(a, r, ts);
  }
}

function onSystem(a, r, ts) {
  if (!ts) return;
  if (r.subtype === 'away_summary') a.summary = clip(String(r.content || '').replace(/\(disable recaps.*$/i, ''), 500);
  else if (r.subtype === 'compact_boundary') {
    pushEvent(a, { id: `${a.id}#c${++a.seq}`, c: 'compact', code: 'compact', s: ts, e: ts, n: 'Sıkıştırma', l: 'Bağlam sıkıştırıldı' });
  } else if (r.subtype === 'scheduled_task_fire') {
    turnStart(a, ts);
    pushEvent(a, { id: `${a.id}#p${++a.seq}`, c: 'prompt', code: 'scheduled', s: ts, e: ts, n: 'Zamanlı görev', l: clip(r.prompt || r.content, 160) });
  }
}

function onUser(a, r, ts) {
  if (r.isMeta || !ts) return;
  const m = r.message && r.message.content;
  if (typeof m === 'string' || (Array.isArray(m) && m.some(b => b.type === 'text') && !m.some(b => b.type === 'tool_result'))) {
    const text = typeof m === 'string' ? m : m.filter(b => b.type === 'text').map(b => b.text).join('\n');
    if (/^\[Request interrupted/.test(text)) {
      closeThink(a, ts);
      for (const ev of a.pending.values()) { ev.e = ts; ev.x = 2; touch(ev); }
      a.pending.clear();
      a.genStart = null;
      return;
    }
    turnStart(a, ts);
    if (isHumanPrompt(text)) {
      a.prompts++;
      if (a.kind === 'sub' && !a.lastPrompt) a.lastPrompt = clip(text, 400);
      else if (a.kind === 'main') a.lastPrompt = clip(text, 400);
      pushEvent(a, { id: r.uuid || `${a.id}#p${++a.seq}`, c: 'prompt', code: a.kind === 'sub' ? 'task' : 'prompt', s: ts, e: ts, n: a.kind === 'sub' ? 'Görev' : 'İstek', l: clip(firstLine(text), 160) });
    }
    return;
  }
  if (Array.isArray(m)) {
    for (const b of m) {
      if (b.type !== 'tool_result') continue;
      const ev = a.pending.get(b.tool_use_id);
      if (ev) {
        ev.e = ts;
        if (b.is_error) ev.x = 1;
        if (r.toolUseResult && r.toolUseResult.interrupted) ev.x = 2;
        touch(ev);
        a.pending.delete(b.tool_use_id);
      }
    }
    a.genStart = ts;
  }
}

function onAssistant(a, r, ts) {
  const msg = r.message;
  if (!msg || !ts) return;
  if (msg.model && msg.model !== '<synthetic>') a.model = msg.model;
  if (r.effort) a.effort = r.effort;
  const u = msg.usage;
  if (u) {
    const out = u.output_tokens || 0;
    const prev = a.msgTok.get(msg.id) || 0;
    if (out > prev) {
      a.msgTok.set(msg.id, out);
      a.tokOut += out - prev;
      bucket(a, ts).o += out - prev;
      if (a.msgTok.size > 400) a.msgTok.delete(a.msgTok.keys().next().value);
    }
    const ctx = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
    if (ctx > 0) a.ctx = ctx;
  }
  // Model generation: the "thinking" span from the last user/tool result up to this record.
  if (a.genStart != null) {
    if (!a.curThink) a.curThink = pushEvent(a, { id: `${a.id}#t${++a.seq}`, c: 'think', code: 'think', s: a.genStart, e: ts, n: 'Model', l: 'Düşünüyor' });
    else { a.curThink.e = ts; touch(a.curThink); }
  }
  let sawTool = false;
  for (const b of msg.content || []) {
    if (b.type === 'thinking' && b.thinking) {
      a.thought = clip(b.thinking, 220);
      if (a.curThink) a.curThink.l = clip(b.thinking, 120);
    } else if (b.type === 'text' && b.text && b.text.trim()) {
      a.lastText = clip(b.text, 700);
    } else if (b.type === 'tool_use') {
      sawTool = true;
      const name = b.name || '?';
      const ev = pushEvent(a, {
        id: b.id || `${a.id}#u${++a.seq}`, c: categorize(name, b.input), s: ts, e: null,
        n: toolName(name), l: clip(toolLabel(name, b.input), 110), d: toolDetail(name, b.input),
      });
      a.pending.set(ev.id, ev);
      a.tools[ev.n] = (a.tools[ev.n] || 0) + 1;
      a.cats[ev.c] = (a.cats[ev.c] || 0) + 1;
      a.calls++;
      bucket(a, ts).t++;
    }
  }
  if (sawTool) { closeThink(a, ts); a.genStart = null; }
  if (msg.stop_reason === 'end_turn' || msg.stop_reason === 'stop_sequence') {
    closeThink(a, ts);
    a.genStart = null;
    a.turnEnded = true;
    a.endAt = ts;
    if (a.kind === 'main' && !a.curWait) {
      a.curWait = pushEvent(a, { id: `${a.id}#w${++a.seq}`, c: 'wait', code: 'wait', s: ts, e: null, n: 'Bekleme', l: 'Sıra sende' });
    }
  }
}

// ---------------------------------------------------------------- file reading

function readNew(a, initialTail) {
  if (!a.file) return;
  let st;
  try { st = fs.statSync(a.file); } catch { return; }
  if (st.size < a.offset) { a.offset = 0; a.buf = ''; a.dec = new StringDecoder('utf8'); }
  if (a.offset === 0 && !a.readOnce && st.size > initialTail) {
    a.offset = st.size - initialTail;
    a.skipFirst = true;
  }
  a.readOnce = true;
  if (st.size === a.offset) return;
  let fd;
  try { fd = fs.openSync(a.file, 'r'); } catch { return; }
  try {
    while (a.offset < st.size) {
      const len = Math.min(st.size - a.offset, READ_CHUNK);
      const b = Buffer.allocUnsafe(len);
      const n = fs.readSync(fd, b, 0, len, a.offset);
      if (n <= 0) break;
      a.offset += n;
      let text = a.buf + a.dec.write(n === len ? b : b.subarray(0, n));
      if (a.skipFirst) {
        const i = text.indexOf('\n');
        if (i < 0) { a.buf = ''; continue; }
        text = text.slice(i + 1);
        a.skipFirst = false;
      }
      const lines = text.split('\n');
      a.buf = lines.pop();
      for (const line of lines) {
        if (line.length < 2) continue;
        let r;
        try { r = JSON.parse(line); } catch { continue; }
        try { ingest(a, r); } catch (e) { /* one malformed record must not stop the stream */ }
      }
    }
  } finally { fs.closeSync(fd); }
}

function findTranscript(sid, cwd) {
  const enc = String(cwd || '').replace(/[^a-zA-Z0-9]/g, '-');
  const guess = path.join(PROJ_DIR, enc, sid + '.jsonl');
  if (fs.existsSync(guess)) return guess;
  let dirs = [];
  try { dirs = fs.readdirSync(PROJ_DIR); } catch { return null; }
  for (const d of dirs) {
    const f = path.join(PROJ_DIR, d, sid + '.jsonl');
    if (fs.existsSync(f)) return f;
  }
  return null;
}

// ---------------------------------------------------------------- session discovery

function refreshSessions() {
  let files = [];
  try { files = fs.readdirSync(SESS_DIR).filter(f => /^\d+\.json$/.test(f)); } catch { /* missing */ }
  const live = new Set();
  const next = new Map();
  const panel = [];
  for (const f of files) {
    const pid = Number(f.slice(0, -5));
    let s;
    try { s = JSON.parse(fs.readFileSync(path.join(SESS_DIR, f), 'utf8')); } catch { s = sessionFiles.get(pid); }
    if (!s || !s.sessionId) continue;
    if (!pidAlive(pid)) continue;
    next.set(pid, s);
    live.add(s.sessionId);
    // the panel's own agent registers a session too: it must not get a room of its own (one room per project folder)
    if (!panelSids.has(s.sessionId) && !agents.has(s.sessionId) && isPanelSession(s, runStartOf(s.cwd), panelSids)) panelSids.add(s.sessionId);
    if (panelSids.has(s.sessionId)) { panel.push([pid, s]); continue; }
    let a = agents.get(s.sessionId);
    if (!a) {
      const project = baseName(s.cwd) || s.cwd || '?';
      a = new Agent({ id: s.sessionId, kind: 'main', sid: s.sessionId, pid, cwd: s.cwd, project, color: colorFor(project) });
      agents.set(a.id, a);
    }
    a.pid = pid;
    a.name = s.name || '';
    a.sess = s;
  }
  sessionFiles = next;
  const t0 = now();
  for (const id of panelSids) { if (live.has(id)) ended.delete(id); else if (!ended.has(id)) ended.set(id, t0); }
  const keep = id => live.has(id) || (ended.has(id) && t0 - ended.get(id) < PANEL_GRACE_MS);
  for (const id of [...superseded]) if (!live.has(id)) superseded.delete(id);
  for (const [pid, s] of panel) attachPanel(pid, s);
  for (const a of [...agents.values()]) {
    if (a.virtual) continue;
    if (a.panelSid) { if (!keep(a.panelSid) || !agents.has(a.parent)) drop(a); continue; }
    if (a.adopted) { if (!keep(a.sid)) revert(a); else a.ending = !live.has(a.sid); continue; }
    const root = a.kind === 'main' ? a.id : a.parent;
    const pa = agents.get(root);
    if (pa && pa.adopted) continue; // subs of an adopted room live and die with it (revert deletes them)
    if (!live.has(root)) drop(a);
  }
  for (const id of [...panelSids]) if (!keep(id)) { panelSids.delete(id); ended.delete(id); }
}

const PANEL_GRACE_MS = 10e3; // an ended panel session keeps its room/subs this long so short-lived subagents stay visible
const panelSids = new Set();
const ended = new Map(); // panel sid -> when its session file was first seen missing
const superseded = new Set(); // panel sessions replaced by a newer order's session in the same adopted room; ignored until their file goes
const runStartOf = cwd => (control ? control.runStart(cwd) : undefined);
const drop = a => { agents.delete(a.id); removed.add(a.id); lastSent.delete(a.id); };
const RESET = ['title', 'file', 'offset', 'dec', 'buf', 'lookedAt', 'pending', 'events', 'seq', 'msgTok', 'buckets', 'tools', 'cats', 'genStart', 'curThink', 'curWait', 'turnEnded', 'endAt', 'lastText', 'lastPrompt', 'summary', 'thought', 'model', 'effort', 'ctx', 'ctxMax', 'big', 'tokOut', 'calls', 'prompts', 'started', 'updated'];
function resetTranscript(a) {
  const d = new Agent({});
  for (const k of RESET) a[k] = d[k];
  a.skipFirst = false; a.readOnce = false;
}
function revert(a) { // adopted room goes back to its dormant virtual self (same id)
  for (const x of [...agents.values()]) if (x.parent === a.id) drop(x);
  resetTranscript(a);
  Object.assign(a, { virtual: true, adopted: false, ending: false, sid: '', pid: null, sess: { status: 'idle', statusUpdatedAt: a.seedAt } });
  lastSent.delete(a.id);
}
// A: dormant room adopts the panel session; B: live terminal main in that folder gets a 'panel' sub; C: no room -> plain main
function attachPanel(pid, s) {
  const sid = s.sessionId, k = String(s.cwd).toLowerCase();
  if (superseded.has(sid)) return;
  const a = agents.get(sid) || agents.get('p:' + sid) || [...agents.values()].find(x => x.adopted && x.sid === sid);
  if (a) {
    a.pid = pid; a.sess = s;
    if (a.panelSub && !a.file && now() - a.lookedAt > 3000) { a.lookedAt = now(); a.file = findTranscript(sid, a.cwd); }
    return;
  }
  const rooms = [...agents.values()].filter(x => x.kind === 'main' && String(x.cwd).toLowerCase() === k);
  const main = rooms.find(x => !x.virtual && !x.adopted && !panelSids.has(x.sid));
  const virt = rooms.find(x => x.virtual) || rooms.find(x => x.adopted); // adopted room of a previous order: re-adopt it for this one
  if (main) {
    agents.set('p:' + sid, new Agent({ id: 'p:' + sid, kind: 'sub', parent: main.id, sid, pid, cwd: s.cwd, project: main.project, color: main.color,
      name: s.name || 'panel', desc: 'Panel', atype: 'panel', depth: 1, panelSub: true, panelSid: sid, sess: s, file: findTranscript(sid, s.cwd), lookedAt: now() }));
  } else if (virt) {
    if (virt.adopted) { superseded.add(virt.sid); for (const x of [...agents.values()]) if (x.parent === virt.id) drop(x); }
    resetTranscript(virt);
    Object.assign(virt, { virtual: false, adopted: true, ending: false, sid, pid, sess: s });
  } else {
    const project = baseName(s.cwd) || s.cwd || '?';
    agents.set(sid, new Agent({ id: sid, kind: 'main', sid, pid, cwd: s.cwd, project, color: colorFor(project), name: s.name || '', sess: s }));
  }
}

function locateAndRead() {
  for (const a of agents.values()) {
    if (a.kind !== 'main' || a.virtual) continue;
    if (!a.file && now() - a.lookedAt > 3000) {
      a.lookedAt = now();
      a.file = findTranscript(a.sid, a.cwd);
    }
    readNew(a, MAIN_TAIL);
  }
  for (const a of agents.values()) if (a.kind === 'sub') readNew(a, SUB_TAIL);
}

let subScanAt = 0;
function discoverSubs() {
  if (now() - subScanAt < (panelSids.size || (control && control.busyKeys().length) ? 400 : 2500)) return;
  subScanAt = now();
  for (const m of [...agents.values()]) {
    if (!((m.kind === 'main' && !m.virtual) || m.panelSub) || !m.file) continue;
    const dir = path.join(m.file.slice(0, -6), 'subagents');
    let list;
    try { list = fs.readdirSync(dir); } catch { continue; }
    for (const f of list) {
      const r = /^agent-([\w-]+)\.jsonl$/.exec(f);
      if (!r) continue;
      const id = `${m.id}:${r[1]}`;
      if (agents.has(id)) continue;
      const file = path.join(dir, f);
      let st;
      try { st = fs.statSync(file); } catch { continue; }
      if (now() - st.mtimeMs > SUB_KEEP_MS) continue;
      let meta = {};
      try { meta = JSON.parse(fs.readFileSync(path.join(dir, `agent-${r[1]}.meta.json`), 'utf8')); } catch { /* no meta file */ }
      const a = new Agent({
        id, kind: 'sub', parent: m.panelSub ? m.parent : m.id, panelSid: m.panelSub ? m.sid : undefined, sid: m.sid, cwd: m.cwd, project: m.project, color: m.color, file,
        desc: meta.description || '', atype: meta.agentType || 'ajan', bg: meta.requestShape === 'background',
        depth: meta.spawnDepth || 1, name: r[1].slice(0, 7),
      });
      agents.set(id, a);
      readNew(a, SUB_TAIL);
    }
  }
}

function prune() {
  const t = now();
  for (const a of [...agents.values()]) {
    const cut = t - HISTORY_MS;
    if (a.events.length && a.events[0].s < cut) {
      const i = a.events.findIndex(ev => (ev.e || t) >= cut);
      a.events.splice(0, i < 0 ? a.events.length : i);
    }
    for (const k of a.buckets.keys()) if (k < Math.floor(cut / 60e3)) a.buckets.delete(k);
    if (a.kind === 'sub' && !a.panelSub && (a.updated || 0) < t - SUB_KEEP_MS) {
      agents.delete(a.id); removed.add(a.id); lastSent.delete(a.id);
    }
  }
}

// ---------------------------------------------------------------- summaries

function statusOf(a, t) {
  const pend = [...a.pending.values()];
  const asking = pend.find(ev => ev.c === 'ask');
  if (a.kind === 'main') {
    if (a.ending) return ['dormant', a.endAt || t]; // ended panel session in its grace period: never the amber 'your turn'
    const s = a.sess || {};
    const sAt = Math.max(s.statusUpdatedAt || 0, a.endAt || 0);
    if (asking) return ['ask', asking.s];
    if (s.status === 'idle' || (s.status !== 'busy' && a.turnEnded)) {
      return [t - sAt > 2 * 3600e3 ? 'dormant' : 'waiting', a.endAt || s.statusUpdatedAt || t];
    }
    return ['working', a.genStart || (pend[0] && pend[0].s) || s.statusUpdatedAt || t];
  }
  if (a.turnEnded) return ['done', a.endAt];
  if (t - (a.updated || 0) > SUB_STALE_MS) return ['stale', a.updated];
  return ['working', a.started];
}

function activityOf(a, status, t, subsWorking) {
  if (status === 'waiting' || status === 'dormant' || status === 'ready' || status === 'done' || status === 'stale') return null;
  const pend = [...a.pending.values()].sort((x, y) => y.s - x.s);
  if (pend.length) {
    const ev = pend[0];
    return { c: ev.c, n: ev.n, l: ev.l, since: ev.s, k: pend.length };
  }
  if (a.kind === 'main' && subsWorking && a.genStart == null) {
    return { c: 'agent', n: 'Agent', code: 'waitSubs', m: subsWorking, l: `${subsWorking} alt ajan bekleniyor`, since: a.endAt || a.updated || t, k: 1 };
  }
  if (a.genStart != null) return { c: 'think', n: 'Model', code: 'thinking', l: a.thought || 'Düşünüyor', since: a.genStart, k: 1 };
  return { c: 'think', n: 'Model', code: 'working', l: 'Çalışıyor', since: a.updated || t, k: 1 };
}

function summarize(a, t) {
  const subs = [...agents.values()].filter(x => x.parent === a.id);
  const subsWorking = subs.filter(x => statusOf(x, t)[0] === 'working').length;
  const [rawStatus, since] = statusOf(a, t);
  const pinned = a.kind === 'main' && pinnedSet.has(String(a.cwd).toLowerCase());
  const status = a.kind === 'main' ? pinStatus(rawStatus, pinned) : rawStatus;
  const nowMin = Math.floor(t / 60e3);
  const spark = [], sparkT = [];
  let hourOut = 0;
  for (let i = SPARK_MIN - 1; i >= 0; i--) {
    const b = a.buckets.get(nowMin - i);
    spark.push(b ? b.o : 0);
    sparkT.push(b ? b.t : 0);
    if (b) hourOut += b.o;
  }
  const s = a.sess || {};
  const ctxMax = a.big || a.ctx > 200e3 ? 1e6 : 200e3;
  return {
    id: a.id, kind: a.kind, parent: a.parent, pid: a.pid, name: a.name, cwd: a.cwd, project: a.project, group: a.group || projects.groupOf(a.cwd, HOME), virtual: !!a.virtual, pinned, color: a.color,
    title: a.title, desc: a.desc, atype: a.atype, bg: a.bg, depth: a.depth,
    status, since: since || t, act: activityOf(a, status, t, subsWorking),
    model: prettyModel(a.model), effort: a.effort, ctx: a.ctx, ctxMax,
    lastText: a.lastText, lastPrompt: a.lastPrompt, summary: a.summary, thought: a.thought,
    tools: a.tools, cats: a.cats, calls: a.calls, prompts: a.prompts,
    spark, sparkT, hourOut, tokOut: a.tokOut,
    started: a.kind === 'main' ? (s.startedAt || a.started) : a.started, updated: a.updated,
    version: s.version || '', entry: s.kind || '', remote: !!s.bridgeSessionId,
    subs: subs.map(x => x.id), subsWorking, usd: usdOf(a),
  };
}

// ---------------------------------------------------------------- cost

const cost = { summary: null, progress: null, scannedAt: 0, ver: 0 };
function sessionUsd(a) {
  const files = cost.summary && cost.summary.files;
  if (!files || !a.file) return null;
  if (a.kind === 'sub') return files[a.file] || 0;
  let usd = files[a.file] || 0;
  const dir = a.file.slice(0, -6) + path.sep;
  for (const [f, v] of Object.entries(files)) if (f.startsWith(dir)) usd += v;
  return usd;
}
const usdCache = new Map();
function usdOf(a) {
  const k = a.id + '|' + cost.ver;
  if (!usdCache.has(k)) { usdCache.set(k, sessionUsd(a)); if (usdCache.size > 2000) usdCache.clear(); }
  return usdCache.get(k);
}

const pad2 = n => String(n).padStart(2, '0');
const dayKey = ts => { const d = new Date(ts); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
function costTotals() {
  const s = cost.summary;
  if (!s) return null;
  const t = now();
  const sumDay = k => Object.values(s.days[k] || {}).reduce((x, v) => x + v[5], 0);
  const today = sumDay(dayKey(t));
  let week = 0;
  for (let i = 0; i < 7; i++) week += sumDay(dayKey(t - i * 86400e3));
  const mk = dayKey(t).slice(0, 7);
  let month = 0;
  for (const k of Object.keys(s.days)) if (k.startsWith(mk)) month += sumDay(k);
  const d = new Date(t);
  const hk = `${dayKey(t)}T${pad2(d.getHours())}`;
  const phk = `${dayKey(t - 3600e3)}T${pad2(new Date(t - 3600e3).getHours())}`;
  return { today, week, month, all: s.total, hour: s.hours[hk] || 0, prevHour: s.hours[phk] || 0 };
}
function costPayload() {
  return { progress: cost.progress, scannedAt: cost.scannedAt, totals: costTotals() };
}

function startCostWorker() {
  const w = new Worker(path.join(__dirname, 'cost-worker.js'), {
    workerData: { projDir: PROJ_DIR, cacheFile: path.join(DATA_DIR, 'cost-cache.json') },
  });
  w.on('message', m => {
    if (m.type === 'progress') cost.progress = m;
    else if (m.type === 'summary') {
      cost.summary = m.data;
      cost.ver++;
      if (!m.cached) { cost.scannedAt = m.scannedAt; cost.progress = null; }
      for (const a of agents.values()) lastSent.delete(a.id);
    } else if (m.type === 'log') console.error('[cost]', m.msg);
    for (const res of clients) send(res, 'cost', costPayload());
  });
  w.on('error', e => console.error('[cost] worker error', e));
  w.on('exit', code => { if (code) setTimeout(startCostWorker, 10e3); });
}

// ---------------------------------------------------------------- broadcast

const clients = new Set();

function snapshot() {
  const t = now();
  const cut = t - SNAP_MS;
  const list = [...agents.values()].sort((x, y) => String(x.group || '').localeCompare(String(y.group || '')));
  const events = [];
  for (const a of list) for (const ev of a.events) if ((ev.e || t) >= cut) events.push(ev);
  return { now: t, agents: list.map(a => summarize(a, t)), events };
}

function send(res, type, data) {
  try { res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`); } catch { clients.delete(res); }
}

const broadcast = (type, data) => { for (const res of clients) if (res.authed || (type !== 'chat' && type !== 'perm')) send(res, type, data); };
const perms = createPermQueue({ onChange: list => broadcast('perm', list) });
let control = null; // created lazily so --demo never touches the SDK
const history = createHistory();
const emitChat = (type, data) => { if (type === 'chat') history.push(data); broadcast(type, data); };
const getControl = () => control || (control = createControl({ perms, emit: emitChat, stateFile: path.join(DATA_DIR, 'agents.json') }));
let pinnedSet = new Set(); // lowercased absolute folders from pinned.json
const knownCwd = cwd => knownProjects.some(p => p.cwd === cwd) || pinnedSet.has(String(cwd).toLowerCase()) || [...agents.values()].some(a => a.kind === 'main' && !a.virtual && a.cwd === cwd);

// ---------------------------------------------------------------- recent projects (rooms for projects with no live session)
let projScanAt = 0;
let knownProjects = []; // [{ cwd, project, group, last }] as of the last scan (also the allow-list for control)
function syncProjects() {
  if (DEMO) return;
  // every tick: drop a dormant room as soon as a live session starts in the same project
  const live = new Set([...agents.values()].filter(a => a.kind === 'main' && !a.virtual).map(a => String(a.cwd).toLowerCase()));
  for (const a of [...agents.values()]) if (a.virtual && live.has(String(a.cwd).toLowerCase())) { agents.delete(a.id); removed.add(a.id); lastSent.delete(a.id); }
  if (now() - projScanAt < 60e3) return;
  projScanAt = now();
  knownProjects = projects.scanProjects(PROJ_DIR, { days: 14, home: HOME });
  const hidden = projects.readHidden(DATA_DIR);
  pinnedSet = projects.readPinned(DATA_DIR);
  const liveCwd = new Set([...agents.values()].filter(a => a.kind === 'main' && !a.virtual).map(a => String(a.cwd).toLowerCase()));
  const want = new Map(knownProjects.filter(p => !hidden.has(p.cwd.toLowerCase()) && !liveCwd.has(p.cwd.toLowerCase())).map(p => ['proj:' + p.cwd.toLowerCase(), p]));
  // pinned folders on disk always get a room (even hidden / old / unscanned)
  for (const k of pinnedSet) {
    if (liveCwd.has(k) || want.has('proj:' + k)) continue;
    const real = knownProjects.find(p => p.cwd.toLowerCase() === k);
    let cwd = real ? real.cwd : null;
    if (!cwd) { try { if (fs.statSync(k).isDirectory()) cwd = k; } catch { /* missing: no room */ } }
    if (!cwd) continue;
    want.set('proj:' + k, real || { cwd, project: path.basename(cwd), group: projects.groupOf(cwd, HOME), last: 0 });
  }
  for (const a of [...agents.values()]) if (a.virtual && !want.has(a.id)) { agents.delete(a.id); removed.add(a.id); lastSent.delete(a.id); }
  for (const [id, p] of want) {
    if (agents.has(id)) continue;
    // seed from the project's last activity (stable `since`), clamped so it is always >2h old → 'dormant', never "your turn"
    const seedAt = Math.min(p.last || 0, now() - 2 * 3600e3 - 60e3);
    agents.set(id, new Agent({ id, kind: 'main', virtual: true, seedAt, cwd: p.cwd, project: p.project, group: p.group, color: colorFor(p.project), name: p.project, sess: { status: 'idle', statusUpdatedAt: seedAt } }));
  }
}

let minuteMark = 0;
function tick() {
  try {
    if (demo) demo.step(now());
    else { refreshSessions(); syncProjects(); locateAndRead(); discoverSubs(); }
  } catch (e) { console.error('tick', e); }
  const t = now();
  const forceAll = Math.floor(t / 60e3) !== minuteMark;
  if (forceAll) { minuteMark = Math.floor(t / 60e3); prune(); }
  const changed = [];
  for (const a of agents.values()) {
    const sum = summarize(a, t);
    const key = JSON.stringify(sum);
    if (forceAll || lastSent.get(a.id) !== key) { lastSent.set(a.id, key); changed.push(sum); }
  }
  const events = [...outEvents.values()];
  outEvents.clear();
  const gone = [...removed];
  removed.clear();
  if (changed.length || events.length || gone.length) {
    for (const res of clients) send(res, 'tick', { now: t, agents: changed, events, removed: gone });
  }
}

// ---------------------------------------------------------------- optional account-usage proxy (cswapUrl)

let cswapCache = { at: 0, body: null };
function cswap(cb) {
  if (!CSWAP_URL || DEMO) return cb('{"accounts":[]}');
  if (now() - cswapCache.at < 25e3 && cswapCache.body) return cb(cswapCache.body);
  const req = http.get(CSWAP_URL, { timeout: 2500 }, res => {
    let body = '';
    res.setEncoding('utf8');
    res.on('data', d => { body += d; });
    res.on('end', () => { cswapCache = { at: now(), body }; cb(body); });
  });
  req.on('timeout', () => req.destroy());
  req.on('error', () => cb(cswapCache.body || '{"accounts":[]}'));
}

// ---------------------------------------------------------------- http

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};
const json = (res, body) => {
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
};

function readBody(req, res, cb) {
  let s = '', over = false;
  req.setEncoding('utf8');
  req.on('data', d => {
    if (over) return;
    s += d;
    if (s.length > 65536) { over = true; res.writeHead(413); res.end(); req.destroy(); }
  });
  req.on('end', () => {
    if (over) return;
    let b = {}; try { b = JSON.parse(s || '{}') || {}; } catch { /* bad json -> empty */ }
    Promise.resolve().then(() => cb(b)).catch(() => { if (!res.headersSent) json(res, { ok: false, error: 'bad request' }); });
  });
}

// Works standalone (http.createServer) and mounted (Express/Connect strip the mount path from req.url).
function handler(req, res, next) {
  const url = new URL(req.url, 'http://local');
  if (guard) {
    const g = guard.check(req);
    if (!g.ok) { res.writeHead(403); return res.end('forbidden'); }
    req.control = g.control;
  }
  const mountedAt = req.originalUrl && req.originalUrl !== req.url ? req.originalUrl.split('?')[0] : null;
  if (mountedAt && url.pathname === '/' && !mountedAt.endsWith('/')) {
    res.writeHead(301, { Location: mountedAt + '/' + (url.search || '') });
    return res.end();
  }
  if (url.pathname === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 2000\n\n');
    send(res, 'snap', snapshot());
    send(res, 'cost', costPayload());
    res.authed = guard ? guard.tokenOk(url.searchParams.get('t') || '') : false;
    if (res.authed) { send(res, 'perm', perms.pending()); send(res, 'chatlog', history.all()); send(res, 'chatstate', control ? control.busyKeys() : []); }
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (url.pathname === '/api/config') return json(res, { version: VERSION, demo: DEMO, site: SITE, cswap: !!CSWAP_URL && !DEMO });
  if (url.pathname === '/api/state') return json(res, snapshot());
  if (url.pathname === '/api/cost') {
    const s = cost.summary || { days: {}, hours: {}, projects: {}, models: {}, total: 0, unpriced: [] };
    const { files, ...rest } = s;
    return json(res, { ...rest, ...costPayload() });
  }
  if (url.pathname === '/api/hide' && req.method === 'POST') {
    if (!req.control) { res.writeHead(403); return res.end(); }
    return readBody(req, res, b => {
      if (pinnedSet.has(String(b.cwd).toLowerCase())) return json(res, { ok: false, error: 'pinned' });
      if (!knownProjects.some(p => p.cwd === b.cwd)) return json(res, { ok: false });
      projects.setHidden(DATA_DIR, b.cwd, !!b.hidden); projScanAt = 0; json(res, { ok: true });
    });
  }
  if (url.pathname === '/api/pin' && req.method === 'POST') { // manual per-room switch: pinned = always awake ('ready')
    if (!req.control || DEMO) { res.writeHead(403); return res.end(); }
    return readBody(req, res, b => {
      if (typeof b.cwd !== 'string' || !knownCwd(b.cwd)) return json(res, { ok: false, error: 'unknown project' });
      const on = b.pinned === true;
      projects.setPinned(DATA_DIR, b.cwd, on);
      if (on) projects.setHidden(DATA_DIR, b.cwd, false); // turning a room on also brings it back if it was hidden
      pinnedSet = projects.readPinned(DATA_DIR); projScanAt = 0;
      json(res, { ok: true, pinned: on });
    });
  }
  if (req.method === 'POST' && /^\/api\/(agent\/(send|stop)|perm)$/.test(url.pathname)) {
    if (!req.control || DEMO) { res.writeHead(403); return res.end(); }
    return readBody(req, res, async b => {
      if (url.pathname === '/api/perm') return json(res, { ok: perms.answer(b.id, b.allow === true) });
      if (!knownCwd(b.cwd)) return json(res, { ok: false, error: 'unknown project' });
      if (url.pathname === '/api/agent/stop') return json(res, { ok: getControl().stop(b.cwd) });
      if (typeof b.text !== 'string' || !b.text.trim() || b.text.length > 8000) return json(res, { ok: false, error: 'empty or too long' });
      json(res, await getControl().send(b.cwd, b.text.trim(), b));
    });
  }
  if (url.pathname === '/api/cswap') return cswap(body => json(res, body || '{"accounts":[]}'));
  // Optional private decorations live in public/local/ (git-ignored) and are never served in demo mode.
  if (DEMO && url.pathname.startsWith('/local/')) { res.writeHead(404); return res.end(); }
  let p;
  try { p = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname); } catch { res.writeHead(400); return res.end(); }
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) {
      if (typeof next === 'function') return next();
      res.writeHead(404); return res.end('not found');
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(buf);
  });
}

let started = false;
function start() {
  if (started) return;
  started = true;
  if (DEMO) {
    demo = require('./demo.js')({ Agent, agents, ingest, colorFor });
    cost.summary = demo.costSummary(); cost.ver++; cost.scannedAt = now();
  } else {
    projects.initPinned(DATA_DIR, path.resolve(__dirname, '..'));
    pinnedSet = projects.readPinned(DATA_DIR);
    seedHistory({ stateFile: path.join(DATA_DIR, 'agents.json'), projDir: PROJ_DIR, history });
    startCostWorker();
    require('./lib/monitor').startMonitor({
      dataDir: DATA_DIR,
      everyMin: Number(process.env.OFFICE_MONITOR_MIN) || 30,
      list: () => { const hid = projects.readHidden(DATA_DIR); return [...new Set([...knownProjects.map(p => p.cwd), ...pinnedSet].filter(c => !hid.has(String(c).toLowerCase())))]; },
      notify: (cwd, text) => emitChat('chat', { key: path.resolve(cwd).toLowerCase(), role: 'system', text }),
    });
  }
  tick();
  setInterval(tick, 1000).unref();
  setInterval(() => { for (const res of clients) { try { res.write(': ping\n\n'); } catch { clients.delete(res); } } }, 20e3).unref();
}

/**
 * Create the office. Options (all optional; local config files are merged underneath):
 *   claudeDir, dataDir, demo, cswapUrl, projectColorsFile, projectColors,
 *   site: { name, home, links: [{ label, href }] }  – shown in the header when mounted into another site
 * Returns { handler(req, res, next), start(), listen(port, host, cb) }.
 */
function createOffice(opts = {}) {
  const given = Object.fromEntries(Object.entries(opts).filter(([, v]) => v !== undefined));
  const merged = Object.assign({}, opts.loadConfigFiles === false ? {} : loadConfigFiles(), given);
  configure(merged);
  return {
    handler,
    start,
    config: merged,
    listen(port, host = HOST, cb) {
      guard = makeGuard(port);
      start();
      const srv = http.createServer((req, res) => handler(req, res));
      srv.on('error', e => {
        if (e.code === 'EADDRINUSE') { console.error(`Port ${port} is busy. Is Claude Code Office already running? Try --port.`); process.exit(1); }
        throw e;
      });
      srv.listen(port, host, () => cb && cb(`http://${host}:${port}/`, guard.token));
      return srv;
    },
  };
}

function openBrowser(url) {
  const { spawn } = require('child_process');
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true }).unref(); } catch { /* no browser */ }
}

function cli(argv) {
  const has = f => argv.includes('--' + f);
  const val = f => { const i = argv.indexOf('--' + f); return i >= 0 ? argv[i + 1] : undefined; };
  if (has('help') || argv.includes('-h')) {
    console.log(`Claude Code Office ${VERSION}

  npx claude-code-office [options]

  --port <n>          Port to listen on (default 7321)
  --open              Open the browser after start
  --demo              Fictional demo data; does not read ~/.claude
  --claude-dir <dir>  Claude config dir (default ~/.claude or $CLAUDE_CONFIG_DIR)
  --data-dir <dir>    Where the cost cache is kept (default ~/.claude-code-office)
`);
    return;
  }
  const files = loadConfigFiles();
  const opts = Object.assign({}, files, { loadConfigFiles: false });
  if (has('demo') || process.env.CCO_DEMO === '1') opts.demo = true;
  if (val('claude-dir')) opts.claudeDir = val('claude-dir');
  if (val('data-dir')) opts.dataDir = val('data-dir');
  const port = Number(val('port') || process.env.CCO_PORT || files.port) || 7321;
  const office = createOffice(opts);
  office.listen(port, HOST, (url, token) => {
    console.log(`Claude Code Office ${VERSION}${opts.demo ? ' (demo)' : ''} → ${url}`);
    console.log(`Control token (only this run): open ${url}#t=${token}`);
    if (has('open') || files.open) openBrowser(`${url}#t=${token}`);
  });
}

module.exports = { createOffice, cli };
if (require.main === module) cli(process.argv.slice(2));
