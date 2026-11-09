'use strict';
// Cost worker: scans every transcript under ~/.claude/projects and converts each assistant
// message's usage into dollars at API list prices. Results are kept per file, broken down by
// day and model, in <dataDir>/cost-cache.json; later scans only read the part of a file that
// grew. With a subscription this is not your bill: it is the API-price equivalent of your usage.

const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const { StringDecoder } = require('string_decoder');

const PROJ_DIR = workerData.projDir;
const CACHE = workerData.cacheFile;
const RESCAN_MS = 45e3;
const VERSION = 3;

// $ per million tokens: [input, output, cache read]. Cache writes: 5 min = 1.25x input, 1 h = 2x input.
// Source: Anthropic's published list prices (June 2026) and prompt-caching multipliers.
// Pre-4.5 models use their historical list prices.
const PRICES = [
  [/fable-5-1|mythos-5-1/, 10, 50, 0.25],
  [/fable-5|mythos-5/, 10, 50, 1.0],
  [/opus-5-5/, 4, 20, 0.20],
  [/opus-5/, 5, 25, 0.5],
  [/opus-4-[5-9]/, 5, 25, 0.5],
  [/opus-4|opus-3/, 15, 75, 1.5],
  [/sonnet-5/, 2, 10, 0.2],
  [/sonnet/, 3, 15, 0.3],
  [/haiku-4/, 1, 5, 0.1],
  [/haiku-3-5/, 0.8, 4, 0.08],
  [/haiku/, 0.25, 1.25, 0.03],
];
function priceOf(model) {
  for (const [re, i, o, cr] of PRICES) if (re.test(model)) return { i, o, cr };
  return null;
}

let cache = { version: VERSION, files: {} };
try {
  const c = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
  if (c.version === VERSION) cache = c;
} catch { /* first run */ }

const pad = n => String(n).padStart(2, '0');
function dayKey(ts) { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function hourKey(ts) { const d = new Date(ts); return `${dayKey(ts)}T${pad(d.getHours())}`; }

function listFiles() {
  const out = [];
  const walk = dir => {
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'memory' && e.name !== 'tool-results') walk(p); }
      else if (e.name.endsWith('.jsonl')) out.push(p);
    }
  };
  walk(PROJ_DIR);
  return out;
}

// [input, output, cacheWrite5m, cacheWrite1h, cacheRead, usd, messages]
function add(bucket, key, model, v) {
  const d = bucket[key] || (bucket[key] = {});
  const r = d[model] || (d[model] = [0, 0, 0, 0, 0, 0, 0]);
  for (let i = 0; i < 7; i++) r[i] += v[i];
}

function costOf(model, u, outDelta, first) {
  const p = priceOf(model);
  const fast = u.speed === 'fast' ? 2 : 1;
  let inp = 0, cw5 = 0, cw1 = 0, cr = 0, web = 0;
  if (first) {
    inp = u.input_tokens || 0;
    cr = u.cache_read_input_tokens || 0;
    const cc = u.cache_creation || {};
    cw1 = cc.ephemeral_1h_input_tokens || 0;
    cw5 = cc.ephemeral_5m_input_tokens != null ? cc.ephemeral_5m_input_tokens : Math.max(0, (u.cache_creation_input_tokens || 0) - cw1);
    web = (u.server_tool_use && u.server_tool_use.web_search_requests) || 0;
  }
  const out = outDelta;
  if (!p) return [inp, out, cw5, cw1, cr, 0, first ? 1 : 0];
  const usd = fast * (inp * p.i + out * p.o + cw5 * p.i * 1.25 + cw1 * p.i * 2 + cr * p.cr) / 1e6 + web * 0.01;
  return [inp, out, cw5, cw1, cr, usd, first ? 1 : 0];
}

function scanFile(file, st) {
  let f = cache.files[file];
  if (!f || st.size < f.offset) {
    f = cache.files[file] = { size: 0, mtime: 0, offset: 0, cwd: '', recent: [], days: {}, hours: {}, first: 0, last: 0, total: 0 };
  }
  if (st.size === f.offset) { f.mtime = st.mtimeMs; return false; }
  const fd = fs.openSync(file, 'r');
  const dec = new StringDecoder('utf8');
  const recent = new Map(f.recent);
  const chunk = Buffer.allocUnsafe(4 * 1024 * 1024);
  let carry = '';
  let pos = f.offset;
  const handle = line => {
    if (!f.cwd) {
      const m = /"cwd":"((?:[^"\\]|\\.)*)"/.exec(line.length > 4000 ? line.slice(0, 4000) : line);
      if (m) { try { f.cwd = JSON.parse('"' + m[1] + '"'); } catch { /* bozuk */ } }
    }
    if (line.indexOf('"type":"assistant"') < 0 || line.indexOf('"usage"') < 0) return;
    let r;
    try { r = JSON.parse(line); } catch { return; }
    if (r.type !== 'assistant' || !r.message || !r.message.usage) return;
    const msg = r.message;
    const model = msg.model;
    if (!model || model === '<synthetic>') return;
    const ts = Date.parse(r.timestamp) || 0;
    const id = msg.id || r.uuid;
    const out = msg.usage.output_tokens || 0;
    const prev = recent.get(id);
    let v;
    if (prev == null) v = costOf(model, msg.usage, out, true);
    else if (out > prev) v = costOf(model, msg.usage, out - prev, false);
    else return;
    recent.set(id, Math.max(out, prev || 0));
    if (recent.size > 60) recent.delete(recent.keys().next().value);
    add(f.days, dayKey(ts), model, v);
    if (Date.now() - ts < 8 * 86400e3) add(f.hours, hourKey(ts), model, v);
    f.total += v[5];
    if (!f.first || ts < f.first) f.first = ts;
    if (ts > f.last) f.last = ts;
  };
  try {
    while (pos < st.size) {
      const n = fs.readSync(fd, chunk, 0, Math.min(chunk.length, st.size - pos), pos);
      if (n <= 0) break;
      pos += n;
      const text = carry + dec.write(chunk.subarray(0, n));
      let start = 0, nl;
      while ((nl = text.indexOf('\n', start)) >= 0) {
        handle(text.slice(start, nl));
        start = nl + 1;
      }
      carry = text.slice(start);
    }
  } finally { fs.closeSync(fd); }
  // leave a trailing partial line for the next scan
  f.offset = pos - Buffer.byteLength(carry, 'utf8');
  f.size = st.size;
  f.mtime = st.mtimeMs;
  f.recent = [...recent.entries()];
  const cut = hourKey(Date.now() - 8 * 86400e3);
  for (const k of Object.keys(f.hours)) if (k < cut) delete f.hours[k];
  return true;
}

let dirty = false;
function save() {
  if (!dirty) return;
  try {
    fs.mkdirSync(path.dirname(CACHE), { recursive: true });
    const tmp = CACHE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(cache));
    fs.renameSync(tmp, CACHE);
    dirty = false;
  } catch (e) { parentPort.postMessage({ type: 'log', msg: 'could not write cache: ' + e.message }); }
}

function summary() {
  // Group files by project (cwd); totals per day / hour / model.
  const days = {}, hours = {}, projects = {}, models = {}, files = {};
  let total = 0;
  for (const [file, f] of Object.entries(cache.files)) {
    const proj = f.cwd ? path.basename(f.cwd) : path.basename(path.dirname(file.includes(path.sep + 'subagents' + path.sep) ? path.dirname(path.dirname(file)) : file));
    files[file] = f.total;
    total += f.total;
    const p = projects[proj] || (projects[proj] = { usd: 0, out: 0, inp: 0, cr: 0, msgs: 0, last: 0, sessions: 0, cwd: f.cwd });
    if (!file.includes(path.sep + 'subagents' + path.sep)) p.sessions++;
    p.last = Math.max(p.last, f.last);
    for (const [d, byModel] of Object.entries(f.days)) {
      for (const [m, v] of Object.entries(byModel)) {
        const dd = days[d] || (days[d] = {});
        const r = dd[m] || (dd[m] = [0, 0, 0, 0, 0, 0, 0]);
        for (let i = 0; i < 7; i++) r[i] += v[i];
        const mm = models[m] || (models[m] = [0, 0, 0, 0, 0, 0, 0]);
        for (let i = 0; i < 7; i++) mm[i] += v[i];
        p.usd += v[5]; p.out += v[1]; p.inp += v[0] + v[2] + v[3]; p.cr += v[4]; p.msgs += v[6];
      }
    }
    for (const [h, byModel] of Object.entries(f.hours)) {
      let s = 0;
      for (const v of Object.values(byModel)) s += v[5];
      hours[h] = (hours[h] || 0) + s;
    }
  }
  return { total, days, hours, projects, models, files, unpriced: Object.keys(models).filter(m => !priceOf(m)) };
}

let scanning = false;
function scan(first) {
  if (scanning) return;
  scanning = true;
  const t0 = Date.now();
  const list = listFiles();
  const todo = [];
  let totalBytes = 0;
  for (const file of list) {
    let st;
    try { st = fs.statSync(file); } catch { continue; }
    const f = cache.files[file];
    if (f && f.size === st.size && f.offset >= st.size - 1) continue;
    todo.push([file, st]);
    totalBytes += st.size - (f && st.size >= f.offset ? f.offset : 0);
  }
  const known = new Set(list);
  for (const k of Object.keys(cache.files)) if (!known.has(k) && !fs.existsSync(k)) { /* keep the historical cost of deleted files */ }
  let done = 0, bytes = 0, lastPost = 0;
  for (const [file, st] of todo) {
    const before = cache.files[file] ? cache.files[file].offset : 0;
    try { if (scanFile(file, st)) dirty = true; } catch (e) { parentPort.postMessage({ type: 'log', msg: `${file}: ${e.message}` }); }
    done++;
    bytes += st.size - (st.size >= before ? before : 0);
    if (Date.now() - lastPost > 700) {
      lastPost = Date.now();
      parentPort.postMessage({ type: 'progress', done, total: todo.length, bytes, totalBytes, first });
      if (first && done % 200 === 0) save();
    }
  }
  save();
  parentPort.postMessage({ type: 'summary', data: summary(), scannedAt: Date.now(), took: Date.now() - t0, changed: todo.length, first });
  scanning = false;
}

parentPort.postMessage({ type: 'summary', data: summary(), scannedAt: 0, took: 0, changed: 0, first: true, cached: true });
scan(true);
setInterval(() => scan(false), RESCAN_MS);
