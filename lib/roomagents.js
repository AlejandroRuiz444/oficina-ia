const fs = require('fs');
const path = require('path');

// Per-room specialist agents. ~/.claude-code-office/rooms.json (the user's own data dir, never a project folder: a cloned repo must not be able to
// hand itself agents) maps a project folder to a directory of agent .md files:  { "<folder>": { "agentsDir": "room-agents/seguridad" } }.
// Only text becomes agents: description, prompt and a tool allow-list from the built-in names. permissionMode, hooks, mcpServers, memory,
// background, skills and model in the file are IGNORED, so an agent file can never widen what the approval cards guard.
const BUILTIN_TOOLS = new Set(['Read', 'Write', 'Edit', 'MultiEdit', 'Bash', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'NotebookEdit', 'TodoWrite']);
const MAX_AGENTS = 60;
const MAX_FILE = 200 * 1024;
const MAX_PROMPT = 60000;
const NAME = /^[a-z0-9][a-z0-9_-]{0,79}$/i;

const unquote = s => String(s).trim().replace(/^(>|\|)[+-]?\s*/, '').replace(/^"(.*)"$/s, '$1').replace(/^'(.*)'$/s, '$1').trim();

function parseAgent(text, fallbackName) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n([\s\S]*))?$/.exec(String(text).replace(/^﻿/, ''));
  if (!m) return null;
  const fm = {};
  let k = null;
  for (const l of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(l);
    if (kv) { k = kv[1]; fm[k] = kv[2]; } else if (k && /^\s+\S/.test(l)) fm[k] += ' ' + l.trim();
  }
  const name = unquote(fm.name || fallbackName || '');
  const description = unquote(fm.description || '');
  const prompt = (m[2] || '').trim();
  if (!NAME.test(name) || !description || !prompt) return null;
  const def = { description, prompt: prompt.length > MAX_PROMPT ? prompt.slice(0, MAX_PROMPT) : prompt, model: 'inherit' };
  if (fm.tools !== undefined) {
    const tools = unquote(fm.tools).replace(/[\[\]]/g, '').split(/[,\s]+/).map(t => t.replace(/\(.*$/, '')).filter(t => BUILTIN_TOOLS.has(t));
    if (tools.length) def.tools = [...new Set(tools)];
  }
  return { name, def };
}

const norm = p => path.resolve(String(p)).toLowerCase();

// → { agents: { name: AgentDefinition }, names: [...], dir } or null when the room has no agent set
function loadRoomAgents({ dataDir, cwd }) {
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(path.join(dataDir, 'rooms.json'), 'utf8')); } catch { return null; }
  if (!cfg || typeof cfg !== 'object') return null;
  const key = norm(cwd);
  const entry = Object.entries(cfg).find(([k]) => { try { return norm(k) === key; } catch { return false; } });
  if (!entry || !entry[1] || typeof entry[1].agentsDir !== 'string') return null;
  const base = path.resolve(dataDir);
  const dir = path.resolve(base, entry[1].agentsDir);
  const rel = path.relative(base, dir);
  if (!rel || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) return null; // the folder must live inside the data dir
  let files;
  try { files = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.md')).sort(); } catch { return null; }
  const agents = {};
  for (const f of files) {
    if (Object.keys(agents).length >= MAX_AGENTS) break;
    try {
      const full = path.join(dir, f);
      const st = fs.lstatSync(full);
      if (!st.isFile() || st.size > MAX_FILE) continue;
      const a = parseAgent(fs.readFileSync(full, 'utf8'), f.replace(/\.md$/i, ''));
      if (a && !agents[a.name]) agents[a.name] = a.def;
    } catch { /* unreadable file: skip */ }
  }
  const names = Object.keys(agents);
  return names.length ? { agents, names, dir } : null;
}

module.exports = { parseAgent, loadRoomAgents };
