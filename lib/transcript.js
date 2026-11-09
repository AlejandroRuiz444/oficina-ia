// Rebuilds chat history from Claude's own session transcripts (~/.claude/projects/*/<sid>.jsonl) so a server restart does not blank the rooms.
const fs = require('fs');
const path = require('path');
const { toEvents } = require('./events');

const CAP = 300;
const SKIP_TEXT = /^\s*<(system-reminder|local-command|command-)/;
const COMPACT = key => ({ key, role: 'system', kind: 'compact', text: 'Conversación compactada' });

function transcriptToEvents(lines, key) {
  const out = [];
  let afterBoundary = false; // a boundary and its summary message are one compaction: show one notice
  for (const line of lines) {
    let m;
    try { m = JSON.parse(line); } catch { continue; }
    if (!m || typeof m !== 'object' || m.isSidechain || m.isMeta) continue;
    if (m.type === 'system') {
      if (m.subtype === 'compact_boundary') { out.push(COMPACT(key)); afterBoundary = true; }
      continue;
    }
    if (m.type === 'user' && m.isCompactSummary) { if (!afterBoundary) out.push(COMPACT(key)); afterBoundary = false; continue; }
    if (m.type !== 'user' && m.type !== 'assistant') continue;
    afterBoundary = false;
    const c = m.message && m.message.content;
    if (m.type === 'user') {
      const text = typeof c === 'string' ? c : Array.isArray(c) ? c.filter(b => b && b.type === 'text').map(b => b.text).join('\n') : '';
      if (Array.isArray(c) && c.some(b => b && b.type === 'tool_result')) { for (const e of toEvents(m)) out.push({ key, ...e }); continue; }
      if (text && !SKIP_TEXT.test(text)) out.push({ key, role: 'user', text: text.length > 20000 ? text.slice(0, 20000) + '\n…(' + (text.length - 20000) + ' more characters)' : text }); // same clip as assistant text, so a huge old prompt cannot bloat memory or every chatlog frame
    } else for (const e of toEvents(m)) out.push({ key, ...e });
  }
  return out.slice(-CAP);
}

function readTail(file, maxBytes = 2 * 1024 * 1024) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size, start = Math.max(0, size - maxBytes);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    const lines = buf.toString('utf8').split(/\r?\n/);
    if (start > 0) lines.shift(); // started mid-file: first line is partial
    return lines.filter(Boolean);
  } finally { fs.closeSync(fd); }
}

function findTranscript(projDir, sid) {
  if (typeof sid !== 'string' || !/^[\w-]+$/.test(sid)) return null;
  let dirs;
  try { dirs = fs.readdirSync(projDir); } catch { return null; }
  for (const d of dirs) {
    const f = path.join(projDir, d, sid + '.jsonl');
    try { if (fs.statSync(f).isFile()) return f; } catch { /* next */ }
  }
  return null;
}

function seedHistory({ stateFile, projDir, history }) {
  let state;
  try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { return; }
  if (!state || typeof state !== 'object') return;
  for (const [key, sid] of Object.entries(state)) {
    try {
      const f = findTranscript(projDir, sid);
      if (f) for (const ev of transcriptToEvents(readTail(f), key)) history.push(ev);
    } catch { /* one bad transcript must not block the others */ }
  }
}

module.exports = { transcriptToEvents, readTail, findTranscript, seedHistory };
