const fs = require('fs');
const path = require('path');
const { toEvents } = require('./lib/events');
const { readProjectInstructions, instructionsAppend } = require('./lib/instructions');
const { loadRoomAgents } = require('./lib/roomagents');

// Read/Glob/Grep are auto-allowed only when every path stays inside the project folder; everything else asks the panel.
function insideCwd(tool, input, cwd) {
  const i = input || {};
  const inside = p => {
    if (typeof p !== 'string' || !p) return false;
    const r = path.relative(path.resolve(cwd), path.resolve(cwd, p));
    return r !== '..' && !r.startsWith('..' + path.sep) && !path.isAbsolute(r);
  };
  const opt = v => v === undefined || v === null || inside(v);
  const pat = v => typeof v === 'string' && v && !path.isAbsolute(v) && !/^[a-z]:/i.test(v) && !v.split(/[\\/]/).includes('..');
  if (tool === 'Read') return inside(i.file_path);
  if (tool === 'Glob') return pat(i.pattern) && opt(i.path);
  if (tool === 'Grep') return opt(i.path) && (i.glob === undefined || i.glob === null || pat(i.glob));
  return false;
}
const MODES = ['default', 'plan', 'acceptEdits', 'auto']; // dontAsk is never reachable from the page; bypassPermissions only with confirmed === true (checked in cleanOpts)
const MODE_LABEL = { default: 'Pedir permiso', plan: 'Plan', acceptEdits: 'Aceptar ediciones', auto: 'Auto', bypassPermissions: 'SIN PREGUNTAR' };
const MODELS = ['sonnet', 'opus', 'haiku'];
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
function cleanOpts(o) {
  o = o || {};
  const mode = o.mode === 'bypassPermissions' ? (o.confirmed === true ? o.mode : 'default') : MODES.includes(o.mode) ? o.mode : 'default';
  return { mode, model: MODELS.includes(o.model) ? o.model : undefined, effort: EFFORTS.includes(o.effort) ? o.effort : undefined };
}
const MAX_TURNS = 30;

function createControl({ perms, emit, stateFile }) {
  const runs = new Map(); // key → { ac }
  let state = {};         // key → last session id, so a project's conversation resumes
  try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { /* first run */ }
  const save = () => { fs.mkdirSync(path.dirname(stateFile), { recursive: true }); fs.writeFileSync(stateFile, JSON.stringify(state)); };
  const keyOf = cwd => path.resolve(cwd).toLowerCase();

  async function send(cwd, text, opts) {
    const key = keyOf(cwd);
    const o = cleanOpts(opts);
    if (runs.has(key)) return { ok: false, error: 'busy' };
    if (!fs.existsSync(cwd)) return { ok: false, error: 'folder missing' };
    if (String(text).trim() === '/compact' && !state[key]) return { ok: false, error: 'no hay conversación que compactar' };
    const ac = new AbortController();
    runs.set(key, { ac, startedAt: Date.now() });
    let query;
    try { ({ query } = await import('@anthropic-ai/claude-agent-sdk')); } catch (e) { runs.delete(key); return { ok: false, error: 'SDK not installed: ' + e.message }; }
    emit('chat', { key, role: 'user', text });
    emit('chat', { key, role: 'system', text: 'modo: ' + MODE_LABEL[o.mode] + (opts && opts.mode === 'bypassPermissions' && o.mode !== 'bypassPermissions' ? ' (se pidió SIN PREGUNTAR sin confirmación; se usó Pedir permiso)' : '') });
    if (o.mode === 'auto' || o.mode === 'bypassPermissions') console.log('[control] ' + cwd + ' modo ' + o.mode);
    // the project's CLAUDE.md goes into the system prompt as plain text (settings files stay ignored, see settingSources below)
    const proj = readProjectInstructions(cwd);
    if (proj) emit('chat', { key, role: 'system', text: 'instrucciones del proyecto cargadas: ' + proj.file + (proj.clipped ? ' (recortado)' : '') });
    // specialist subagents of this room (rooms.json in the data dir); their tool calls still go through canUseTool like everything else
    const room = loadRoomAgents({ dataDir: path.dirname(stateFile), cwd });
    if (room) emit('chat', { key, role: 'system', text: 'agentes de la sala cargados: ' + room.names.length });
    (async () => {
      let got = false;
      try {
        const q = query({ prompt: text, options: {
          cwd, resume: state[key], abortController: ac, maxTurns: MAX_TURNS,
          permissionMode: o.mode, ...(o.mode === 'bypassPermissions' && { allowDangerouslySkipPermissions: true }), includePartialMessages: true, ...(o.model && { model: o.model }), ...(o.effort && { effort: o.effort }),
          ...(proj && { systemPrompt: { type: 'preset', preset: 'claude_code', append: instructionsAppend(proj), snapshot: false } }), // snapshot:false → also applies when resuming an older conversation
          ...(room && { agents: room.agents }),
          settingSources: [], // Task 1 finding: allow rules in the user's settings files can shadow canUseTool; ignore them so every non-read tool reaches the panel
          canUseTool: async (tool, input) => {
            if (insideCwd(tool, input, cwd)) return { behavior: 'allow', updatedInput: input };
            const r = await perms.ask({ key, cwd, tool, input });
            return r.allow ? { behavior: 'allow', updatedInput: input }
                           : { behavior: 'deny', message: `The user rejected this action in the panel (${r.why}).` };
          },
        } });
        for await (const m of q) {
          if (m.session_id && state[key] !== m.session_id) { state[key] = m.session_id; save(); }
          if (m.type === 'assistant') got = true;
          for (const ev of toEvents(m)) emit('chat', { key, ...ev });
          if (m.type === 'result') emit('chat', { key, role: 'system', text: m.subtype === 'success' ? 'listo' : 'terminó: ' + m.subtype });
        }
      } catch (e) {
        if (!got && !ac.signal.aborted && state[key]) { delete state[key]; save(); emit('chat', { key, role: 'system', text: 'No se pudo reanudar la conversación anterior; la próxima orden empieza una conversación nueva.' }); }
        emit('chat', { key, role: 'system', text: ac.signal.aborted ? 'detenido' : 'error: ' + e.message });
      } finally {
        perms.abortProject(cwd);
        runs.delete(key);
        emit('chat', { key, role: 'idle' });
      }
    })();
    return { ok: true };
  }

  const stop = cwd => { const r = runs.get(keyOf(cwd)); if (r) { r.ac.abort(); perms.abortProject(cwd); } return !!r; };
  return { send, stop, busy: cwd => runs.has(keyOf(cwd)), busyKeys: () => [...runs.keys()], keyOf, runStart: cwd => cwd ? (runs.get(keyOf(cwd)) || {}).startedAt : undefined };
}

module.exports = { createControl, insideCwd, cleanOpts };
