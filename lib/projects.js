const fs = require('fs');
const path = require('path');

const baseName = p => String(p).split(/[\\/]/).filter(Boolean).pop() || String(p);

function groupOf(cwd, home) {
  const parts = String(cwd).split(/[\\/]/).filter(Boolean);
  const parent = (parts[parts.length - 2] || '').toLowerCase();
  const generic = new Set(['desktop', 'documents', 'escritorio', baseName(home).toLowerCase()]);
  return parts.length < 3 || generic.has(parent) ? 'Otros' : parts[parts.length - 2];
}

// real folder of a project dir: the "cwd" the transcripts carry (the dir name itself is lossy)
function cwdOf(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(65536);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    const m = /"cwd":"((?:[^"\\]|\\.)*)"/.exec(buf.toString('utf8', 0, n));
    return m ? JSON.parse('"' + m[1] + '"') : null;
  } finally { fs.closeSync(fd); }
}

function scanProjects(projDir, { days = 14, now = Date.now(), home = require('os').homedir() } = {}) {
  const out = [];
  const generic = new Set(['desktop', 'documents', 'escritorio', baseName(home).toLowerCase()]);
  let dirs = [];
  try { dirs = fs.readdirSync(projDir); } catch { return out; }
  for (const d of dirs) {
    try {
      const full = path.join(projDir, d);
      const files = fs.readdirSync(full).filter(f => f.endsWith('.jsonl')).map(f => ({ f: path.join(full, f), t: fs.statSync(path.join(full, f)).mtimeMs }));
      if (!files.length) continue;
      const newest = files.sort((a, b) => b.t - a.t)[0];
      if (now - newest.t > days * 864e5) continue;
      const cwd = cwdOf(newest.f);
      if (!cwd || !fs.existsSync(cwd)) continue;
      if (generic.has(baseName(cwd).toLowerCase())) continue;
      out.push({ cwd, project: baseName(cwd), group: groupOf(cwd, home), last: newest.t });
    } catch { /* unreadable dir: skip */ }
  }
  return out.sort((a, b) => a.group.localeCompare(b.group) || a.project.localeCompare(b.project));
}

const hiddenFile = dataDir => path.join(dataDir, 'hidden.json');
function readHidden(dataDir) {
  try { return new Set(JSON.parse(fs.readFileSync(hiddenFile(dataDir), 'utf8')).map(s => String(s).toLowerCase())); } catch { return new Set(); }
}
function setHidden(dataDir, cwd, hidden) {
  const s = readHidden(dataDir); const k = String(cwd).toLowerCase();
  hidden ? s.add(k) : s.delete(k);
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(hiddenFile(dataDir), JSON.stringify([...s]));
}

const pinnedFile = dataDir => path.join(dataDir, 'pinned.json');
// pinned.json = JSON array of absolute project folders that always get a room. Lowercased, bad file -> empty.
function readPinned(dataDir) {
  try { return new Set(JSON.parse(fs.readFileSync(pinnedFile(dataDir), 'utf8')).map(s => String(s).toLowerCase())); } catch { return new Set(); }
}
// manual on/off switch of a room: pinned = always awake ('ready'). Errors propagate (the endpoint's try/catch answers).
function setPinned(dataDir, cwd, pinned) {
  const s = readPinned(dataDir); const k = String(cwd).toLowerCase();
  pinned ? s.add(k) : s.delete(k);
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(pinnedFile(dataDir), JSON.stringify([...s], null, 2));
}
// first start: create the file with the given default folder (never overwrites)
function initPinned(dataDir, def) {
  try { if (fs.existsSync(pinnedFile(dataDir))) return; fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(pinnedFile(dataDir), JSON.stringify([def], null, 2)); } catch { /* read-only dir: no pinned rooms */ }
}

module.exports = { groupOf, scanProjects, readHidden, setHidden, readPinned, setPinned, initPinned };
