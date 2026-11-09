'use strict';
// Demo mode: a self-contained, fictional office. Nothing is read from ~/.claude.
// Synthetic Claude Code transcript records are generated and fed through the same
// ingest() pipeline the real server uses, so every view behaves exactly as in real use.

const path = require('path');

const PROJECTS = [
  { project: 'nebula-web', title: 'Checkout redesign + A/B test', mode: 'working', subs: 2, model: 'claude-opus-5-5' },
  { project: 'atlas-api', title: 'Rate limiter & auth middleware', mode: 'working', subs: 4, model: 'claude-opus-5-5' },
  { project: 'pixel-forge', title: 'Isometric level editor', mode: 'working', subs: 5, model: 'claude-opus-5-5' },
  { project: 'docs-hub', title: 'Migrate docs to Astro', mode: 'waiting', subs: 0, model: 'claude-sonnet-5' },
  { project: 'orbit-mobile', title: 'Offline sync for iOS', mode: 'working', subs: 1, model: 'claude-opus-5-5' },
  { project: 'data-lake', title: 'Nightly ETL cost audit', mode: 'waiting', subs: 0, model: 'claude-fable-5-1' },
  { project: 'ml-lab', title: 'Eval harness for fine-tunes', mode: 'dormant', subs: 0, model: 'claude-opus-5-5' },
];

const FILES = ['src/app/router.ts', 'src/components/Cart.tsx', 'src/lib/rateLimit.ts', 'src/server/auth.ts', 'README.md', 'package.json',
  'src/editor/Grid.tsx', 'src/editor/tiles.ts', 'docs/getting-started.mdx', 'src/sync/queue.swift', 'etl/jobs/nightly.py', 'tests/checkout.spec.ts',
  'src/api/middleware.ts', 'astro.config.mjs', 'src/shaders/iso.wgsl', 'infra/terraform/main.tf'];
const PATTERNS = ['useCart', 'TODO', 'rateLimit(', 'export async function', 'retryPolicy', 'onConflict', 'z.object', 'TileLayer'];
const CMDS = [
  ['npm run build', 'Build the production bundle'], ['npm test -- --run', 'Run unit tests'], ['git status --short', 'Check working tree'],
  ['pnpm lint --fix', 'Lint and autofix'], ['pytest -q tests/etl', 'Run ETL tests'], ['docker compose up -d db', 'Start local database'],
  ['npx playwright test checkout', 'Run checkout e2e tests'], ['cargo check', 'Type-check the Rust crate'], ['git diff --stat', 'Review the diff'],
  ['xcodebuild test -scheme Orbit', 'Run iOS test suite'], ['npm run bench:limiter', 'Benchmark the rate limiter'],
];
const URLS = ['https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API', 'https://docs.astro.build/en/guides/content-collections/',
  'https://www.rfc-editor.org/rfc/rfc6585', 'https://threejs.org/docs/'];
const QUERIES = ['astro content collections migration', 'token bucket vs sliding window', 'CoreData conflict resolution', 'webgpu isometric shader'];
const THOUGHTS = [
  'Checking how the router handles nested layouts before touching the cart.',
  'The limiter needs a per-key burst; a sliding window avoids the edge spike.',
  'Tests pass locally, verifying the flaky one twice before moving on.',
  'Splitting the editor grid into chunks should keep the frame time under 8 ms.',
  'The sync queue must be idempotent; adding a client-generated operation id.',
  'Cost spikes line up with the nightly backfill; comparing the last seven runs.',
  'Reading the existing middleware order so auth runs before rate limiting.',
];
const REPLIES = [
  'Done. Tests pass (142/142) and the bundle shrank by 38 KB. Want me to open a PR?',
  'I migrated 41 of 44 pages. The last three use custom MDX components; how should I handle them?',
  'The audit is ready: 72% of the cost comes from one backfill job. Should I schedule it off-peak?',
  'Offline queue works end-to-end on the simulator. Next step: conflict UI. Continue?',
];
const SUB_DESCS = ['Audit bundle size', 'E2E tests for checkout', 'Profile slow queries', 'Draft migration guide', 'Review auth edge cases',
  'Generate sprite atlas', 'Port shader to WebGPU', 'Fix flaky test', 'Benchmark rate limiter', 'Update API docs', 'Tile palette tool',
  'Accessibility sweep', 'Load test the API', 'Dark mode tokens', 'Refactor cart state', 'Write changelog', 'Trace memory leak',
  'Snapshot tests for editor', 'Retry policy for sync', 'Seed demo data', 'Lint config cleanup', 'Index hot queries', 'Split vendor chunk',
  'Localize error messages', 'Cache headers audit', 'Undo/redo for editor', 'Webhook signature check', 'Queue backpressure test'];

function pick(arr, rnd) { return arr[Math.floor(rnd() * arr.length)]; }
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

module.exports = function createDemo({ Agent, agents, ingest, colorFor }) {
  const rnd = mulberry32(20260927);
  const sims = new Map();       // agent id -> sim state
  let msgN = 0, toolN = 0;
  const iso = ts => new Date(ts).toISOString();
  const spawnAfter = Date.now() - 80 * 60e3; // helpers only appear in the last ~80 minutes of history
  function emit(a, rec) {
    ingest(a, rec);
    const sim = sims.get(a.id);
    if (sim && rec.timestamp) sim.lastTs = Math.max(sim.lastTs || 0, Date.parse(rec.timestamp));
  }

  function toolCall() {
    const r = rnd();
    if (r < 0.2) return ['Read', { file_path: pick(FILES, rnd) }, 300 + rnd() * 1500];
    if (r < 0.32) return ['Grep', { pattern: pick(PATTERNS, rnd), path: 'src' }, 400 + rnd() * 2500];
    if (r < 0.52) return ['Edit', { file_path: pick(FILES, rnd) }, 400 + rnd() * 1500];
    if (r < 0.56) return ['Write', { file_path: pick(FILES, rnd) }, 500 + rnd() * 1500];
    if (r < 0.82) { const [command, description] = pick(CMDS, rnd); return ['Bash', { command, description }, 2500 + rnd() * rnd() * 90000]; }
    if (r < 0.88) return ['WebFetch', { url: pick(URLS, rnd) }, 1500 + rnd() * 6000];
    if (r < 0.93) return ['WebSearch', { query: pick(QUERIES, rnd) }, 1500 + rnd() * 4000];
    if (r < 0.96) return ['mcp__github__create_pull_request', { title: 'Demo PR' }, 1500 + rnd() * 3000];
    return ['TodoWrite', { todos: [] }, 200];
  }

  function assistant(a, ts, content, stop, out) {
    const sim = sims.get(a.id);
    sim.ctx += 300 + rnd() * 2200;
    if (sim.ctx > sim.ctxCap) {
      // context full: compact like Claude Code does, then keep growing from a small summary
      emit(a, { type: 'system', subtype: 'compact_boundary', timestamp: iso(ts - 1) });
      sim.ctx = 40000 + rnd() * 30000;
    }
    emit(a, {
      type: 'assistant', timestamp: iso(ts), effort: 'xhigh',
      message: {
        id: `msg_demo_${++msgN}`, model: sim.model, content, stop_reason: stop,
        usage: { input_tokens: 2, cache_read_input_tokens: Math.round(sim.ctx), cache_creation_input_tokens: 900, output_tokens: out || Math.round(150 + rnd() * 2400) },
      },
    });
  }

  function makeAgent(o) {
    const a = new Agent(o);
    a.big = true;
    agents.set(a.id, a);
    return a;
  }

  function startSim(a, model, from, opts = {}) {
    sims.set(a.id, {
      phase: 'think', next: from + 2000 + rnd() * 8000, model, ctx: 30000 + rnd() * 60000, ctxCap: 180000 + rnd() * 520000,
      steps: 0, maxSteps: opts.maxSteps || Infinity, pending: null, ...opts,
    });
  }

  function spawnSub(m, ts) {
    const sim = sims.get(m.id);
    const n = (sim.subN = (sim.subN || 0) + 1);
    // each lead delegates distinct tasks: draw from its own shuffled deck
    if (!sim.deck || !sim.deck.length) sim.deck = SUB_DESCS.map(d => [rnd(), d]).sort((x, y) => x[0] - y[0]).map(x => x[1]);
    const desc = sim.deck.pop();
    const id = `${m.id}:sub${n}`;
    const s = makeAgent({
      id, kind: 'sub', parent: m.id, sid: m.sid, cwd: m.cwd, project: m.project, color: m.color,
      file: path.join('demo', m.id, `sub${n}.jsonl`), desc, atype: rnd() < 0.8 ? 'general-purpose' : 'Explore', bg: true, depth: 1, name: `a${n}`,
    });
    sims.set(s.id, {});
    emit(s, { type: 'user', timestamp: iso(ts), uuid: `${id}-task`, message: { content: `${desc}. Report back with a short summary.` } });
    startSim(s, sim.model, ts, { maxSteps: 25 + Math.floor(rnd() * 45) });
    return s;
  }

  // One step of the state machine; returns false when the agent has nothing scheduled.
  function advance(a, sim) {
    const ts = sim.next;
    switch (sim.phase) {
      case 'think': {
        if (a.kind === 'sub' && sim.steps >= sim.maxSteps) {
          assistant(a, ts, [{ type: 'text', text: `Finished: ${a.desc.toLowerCase()}. All checks green.` }], 'end_turn');
          sim.phase = 'done';
          return false;
        }
        if (a.kind === 'main' && sim.endAfter != null && sim.steps >= sim.endAfter) {
          assistant(a, ts, [{ type: 'text', text: pick(REPLIES, rnd) }], 'end_turn');
          a.sess.status = 'idle'; a.sess.statusUpdatedAt = ts;
          sim.phase = 'waitUser'; sim.next = ts + (sim.userDelay || (4 + rnd() * 10) * 60e3); sim.endAfter = null;
          return true;
        }
        let call = toolCall();
        const wantSubs = a.kind === 'main' ? (sim.targetSubs || 0) : 0;
        const liveSubs = [...agents.values()].filter(x => x.parent === a.id && sims.get(x.id) && sims.get(x.id).phase !== 'done').length;
        if (liveSubs < wantSubs && ts > spawnAfter && rnd() < 0.12) call = ['Agent', { description: 'Delegate subtask', subagent_type: 'general-purpose' }, 900];
        const [name, input, dur] = call;
        const id = `toolu_demo_${++toolN}`;
        assistant(a, ts, [{ type: 'thinking', thinking: pick(THOUGHTS, rnd) }, { type: 'tool_use', id, name, input }], 'tool_use');
        if (name === 'Agent') spawnSub(a, ts + 300);
        sim.pending = id; sim.phase = 'tool'; sim.next = ts + dur; sim.steps++;
        return true;
      }
      case 'tool': {
        emit(a, { type: 'user', timestamp: iso(ts), message: { content: [{ type: 'tool_result', tool_use_id: sim.pending, is_error: rnd() < 0.04 }] } });
        sim.pending = null; sim.phase = 'think'; sim.next = ts + 1500 + rnd() * rnd() * 30000;
        return true;
      }
      case 'waitUser': {
        if (sim.hold) return false;
        emit(a, { type: 'user', timestamp: iso(ts), uuid: `${a.id}-p${ts}`, message: { content: pick(['Yes, go ahead.', 'Looks good, continue with the next step.', 'Please also add tests for the edge cases.'], rnd) } });
        a.sess.status = 'busy'; a.sess.statusUpdatedAt = ts;
        sim.phase = 'think'; sim.next = ts + 2000 + rnd() * 6000; sim.steps = 0;
        sim.endAfter = 12 + Math.floor(rnd() * 30);
        return true;
      }
      default: return false;
    }
  }

  const subsOf = a => [...agents.values()].filter(x => x.parent === a.id);
  function run(a, until) {
    const sim = sims.get(a.id);
    if (!sim || sim.next == null) return;
    let guard = 0;
    while (sim.next <= until && guard++ < 5000) {
      if (a.kind === 'main') for (const s of subsOf(a)) run(s, sim.next);
      if (!advance(a, sim)) break;
    }
    if (a.kind === 'main') for (const s of subsOf(a)) run(s, until);
  }

  // End the turn at `at`: finish a pending tool first, then hand the turn back to the user.
  function endTurnAt(a, sim, at) {
    if (sim.phase === 'waitUser') return;
    if (sim.phase === 'tool') { sim.next = Math.max(sim.lastTs + 200, Math.min(sim.next, at - 800)); advance(a, sim); }
    at = Math.max(at, (sim.lastTs || 0) + 400);
    sim.endAfter = 0; sim.phase = 'think'; sim.next = at;
    advance(a, sim);
  }

  // ---------------------------------------------------------------- initial office (3 h backfill)

  const t0 = Date.now();
  PROJECTS.forEach((p, i) => {
    const id = `demo-${p.project}`;
    const started = t0 - (3.2 + rnd() * 3) * 3600e3;
    const a = makeAgent({
      id, kind: 'main', sid: id, pid: 41000 + i * 137, cwd: `~/code/${p.project}`, project: p.project, color: colorFor(p.project),
      name: `${p.project}-${(0x10 + i * 23).toString(16)}`, file: path.join('demo', `${id}.jsonl`),
    });
    a.sess = { status: 'busy', statusUpdatedAt: started, startedAt: started, name: a.name, version: '2.1.283', kind: 'interactive', bridgeSessionId: null };
    startSim(a, p.model, started, { targetSubs: p.subs, endAfter: 20 + Math.floor(rnd() * 25) });
    emit(a, { type: 'ai-title', aiTitle: p.title });
    emit(a, { type: 'user', timestamp: iso(started), uuid: `${id}-p0`, message: { content: `${p.title}. Plan it, then implement it step by step.` } });
    const sim = sims.get(id);
    if (p.mode === 'dormant') {
      run(a, t0 - 2.7 * 3600e3);
      endTurnAt(a, sim, t0 - 2.6 * 3600e3);
      sim.hold = true;
      for (const s of subsOf(a)) { const ss = sims.get(s.id); if (ss.phase !== 'done') endTurnAt(s, ss, t0 - 2.6 * 3600e3); }
    } else if (p.mode === 'waiting') {
      const endAt = t0 - (3 + rnd() * 20) * 60e3;
      run(a, endAt - 60e3);
      if (sim.phase === 'waitUser') { sim.next = Math.max(sim.lastTs + 1000, endAt - 50e3); advance(a, sim); }
      run(a, endAt - 5e3);
      endTurnAt(a, sim, endAt);
      for (const s of subsOf(a)) { const ss = sims.get(s.id); if (ss.phase !== 'done') endTurnAt(s, ss, endAt - 2e3); }
      sim.next = t0 + (6 + rnd() * 8) * 60e3;
      sim.targetSubs = 0;
    } else {
      run(a, t0 - 90e3);
      if (sim.phase === 'waitUser') { sim.next = Math.max(sim.lastTs + 1000, t0 - 60e3); advance(a, sim); }
      sim.endAfter = null;
      run(a, t0);
      const live = subsOf(a).filter(x => sims.get(x.id).phase !== 'done').length;
      for (let k = live; k < p.subs; k++) { const s = spawnSub(a, t0 - (1 + rnd() * 9) * 60e3); run(s, t0); }
    }
  });

  // ---------------------------------------------------------------- live
  let lastRebalance = t0;
  function step(t) {
    for (const a of [...agents.values()]) run(a, t);
    if (t - lastRebalance > 20e3) {
      lastRebalance = t;
      const mains = [...agents.values()].filter(a => a.kind === 'main' && !sims.get(a.id).hold);
      const waiting = mains.filter(a => a.sess.status === 'idle');
      // keep roughly two rooms waiting for the user, so the demo always shows both states
      if (waiting.length < 2) {
        const w = mains.filter(a => a.sess.status === 'busy' && sims.get(a.id).endAfter == null);
        if (w.length && rnd() < 0.15) { const s = sims.get(pick(w, rnd).id); s.endAfter = s.steps + 2 + Math.floor(rnd() * 5); }
      }
      for (const a of mains) {
        const sim = sims.get(a.id);
        const p = PROJECTS.find(x => `demo-${x.project}` === a.id);
        const live = [...agents.values()].filter(x => x.parent === a.id && sims.get(x.id) && sims.get(x.id).phase !== 'done').length;
        sim.targetSubs = a.sess.status === 'busy' ? Math.max(p.subs, live) : 0;
      }
    }
  }

  // ---------------------------------------------------------------- cost history
  function costSummary() {
    const r = mulberry32(99);
    const pad = n => String(n).padStart(2, '0');
    const dk = ts => { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
    const MODELS = [['claude-opus-5-5', 0.74, 20], ['claude-sonnet-5', 0.14, 10], ['claude-fable-5-1', 0.1, 50], ['claude-haiku-4-5', 0.02, 5]];
    const days = {}, models = {}, hours = {}, files = {};
    let total = 0;
    const now = Date.now();
    for (let i = 59; i >= 0; i--) {
      const ts = now - i * 86400e3;
      const wd = new Date(ts).getDay();
      let usd = (wd === 0 || wd === 6 ? 35 : 90) + r() * 150 + (59 - i) * 1.6;
      if (i === 0) usd *= new Date().getHours() / 24 + 0.05;
      const d = (days[dk(ts)] = {});
      for (const [m, share, outPrice] of MODELS) {
        const v = usd * share * (0.7 + r() * 0.6);
        const out = Math.round((v * 0.35 / outPrice) * 1e6), cr = Math.round((v * 0.5) / 0.2 * 1e6);
        const row = [Math.round(out * 0.004), out, Math.round(out * 0.9), 0, cr, v, Math.round(out / 900)];
        d[m] = row;
        const mm = models[m] || (models[m] = [0, 0, 0, 0, 0, 0, 0]);
        row.forEach((x, k) => { mm[k] += x; });
        total += v;
      }
    }
    const today = dk(now);
    const todayUsd = Object.values(days[today]).reduce((s, v) => s + v[5], 0);
    const hNow = new Date().getHours();
    const weights = [];
    for (let h = 0; h <= hNow; h++) weights.push(h < 9 ? 0.05 : 0.6 + r());
    const wsum = weights.reduce((s, x) => s + x, 0) || 1;
    weights.forEach((w, h) => { hours[`${today}T${pad(h)}`] = (todayUsd * w) / wsum; });
    const yesterday = dk(now - 86400e3);
    const yUsd = Object.values(days[yesterday]).reduce((s, v) => s + v[5], 0);
    for (let h = 0; h < 24; h++) hours[`${yesterday}T${pad(h)}`] = (yUsd * (h < 9 ? 0.05 : 1)) / 15.45;
    const projects = {};
    const shares = [0.24, 0.2, 0.18, 0.12, 0.1, 0.09, 0.07];
    PROJECTS.forEach((p, i) => {
      projects[p.project] = { usd: total * shares[i], out: 0, inp: 0, cr: 0, msgs: 0, last: now - i * 3600e3, sessions: 3 + ((i * 7) % 11), cwd: `~/code/${p.project}` };
    });
    for (const a of agents.values()) files[a.file] = a.kind === 'main' ? 6 + r() * 70 : 0.4 + r() * 5;
    return { total, days, hours, projects, models, files, unpriced: [] };
  }

  return { step, costSummary };
};
