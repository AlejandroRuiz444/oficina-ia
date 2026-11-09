const assert = require('assert');
const { makeGuard } = require('./lib/guard');
const req = (headers) => ({ headers });
{ // guard
  const g = makeGuard(7321, 'a'.repeat(48));
  assert.deepStrictEqual(g.check(req({ host: '127.0.0.1:7321' })), { ok: true, control: false });
  assert.strictEqual(g.check(req({ host: 'localhost:7321', 'x-office-token': 'a'.repeat(48) })).control, true);
  assert.strictEqual(g.check(req({ host: 'evil.com' })).ok, false, 'host falso');
  assert.strictEqual(g.check(req({ host: '127.0.0.1:7321', origin: 'https://evil.com' })).ok, false, 'origin ajeno');
  assert.strictEqual(g.check(req({ host: '127.0.0.1:7321', origin: 'http://localhost:7321' })).ok, true);
  assert.strictEqual(g.check(req({ host: '127.0.0.1:7321', 'x-office-token': 'b'.repeat(48) })).control, false, 'token malo');
  assert.strictEqual(g.check(req({ host: '127.0.0.1:7321', 'x-office-token': 'corto' })).control, false, 'token corto');
  assert.strictEqual(g.check(req({ host: '127.0.0.1:7321', 'x-office-token': 'é'.repeat(48) })).control, false, 'token multibyte');
  assert.strictEqual(g.tokenOk('a'.repeat(48)), true);
  assert.strictEqual(g.tokenOk('a'.repeat(47)), false);
  assert.strictEqual(g.tokenOk('é'.repeat(24)), false);
  assert.strictEqual(g.tokenOk(undefined), false);
}
const fs = require('fs'), os = require('os'), path = require('path');
const { groupOf, scanProjects, readHidden, setHidden } = require('./lib/projects');
{ // projects
  const home = 'C:\\Users\\user';
  assert.strictEqual(groupOf('C:\\Users\\user\\Desktop\\ProjectA\\app1', home), 'ProjectA');
  assert.strictEqual(groupOf('C:\\Users\\user\\Desktop\\Tools\\tool1', home), 'Tools');
  assert.strictEqual(groupOf('C:\\Users\\user\\Desktop\\bot1', home), 'Otros');
  assert.strictEqual(groupOf('C:\\Users\\user\\Desktop', home), 'Otros');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cco-'));
  const mk = (dir, cwd, ageDays) => { // fake ~/.claude/projects/<dir>/s.jsonl with a cwd line
    const d = path.join(tmp, 'projects', dir); fs.mkdirSync(d, { recursive: true });
    const f = path.join(d, 's.jsonl'); fs.writeFileSync(f, JSON.stringify({ type: 'user', cwd }) + '\n');
    const t = new Date(Date.now() - ageDays * 864e5); fs.utimesSync(f, t, t);
  };
  const real = path.join(tmp, 'work', 'GRP', 'proyecto-a'); fs.mkdirSync(real, { recursive: true });
  mk('a', real, 1);
  mk('old', real + '-viejo', 30);               // fuera de 14 días
  mk('gone', path.join(tmp, 'no-existe'), 1);   // carpeta inexistente
  const desk = path.join(tmp, 'Desktop'); fs.mkdirSync(desk, { recursive: true });
  mk('desk', desk, 1);                          // carpeta genérica, no es proyecto
  const got = scanProjects(path.join(tmp, 'projects'), { days: 14 });
  assert.strictEqual(got.length, 1);
  assert.strictEqual(got[0].project, 'proyecto-a'); assert.strictEqual(got[0].group, 'GRP');
  assert.strictEqual(readHidden(tmp).size, 0);
  setHidden(tmp, real, true); assert.ok(readHidden(tmp).has(real.toLowerCase()));
  setHidden(tmp, real, false); assert.strictEqual(readHidden(tmp).size, 0);
}
const { createPermQueue } = require('./lib/permissions');
(async () => { // permissions
  let changes = 0;
  const q = createPermQueue({ timeoutMs: 40, onChange: () => changes++ });
  const p1 = q.ask({ key: 'k', cwd: 'C:\\x', tool: 'Write', input: { file_path: 'a' } });
  assert.strictEqual(q.pending().length, 1);
  assert.strictEqual(q.answer(q.pending()[0].id, true), true);
  assert.deepStrictEqual(await p1, { allow: true, why: 'approved' });
  const p2 = q.ask({ key: 'k', cwd: 'C:\\x', tool: 'Bash', input: { command: 'ls' } });
  q.answer(q.pending()[0].id, false);
  assert.strictEqual((await p2).allow, false);
  const p3 = q.ask({ key: 'k', cwd: 'C:\\x', tool: 'Bash', input: {} });
  assert.deepStrictEqual(await p3, { allow: false, why: 'timeout' });      // se rechaza sola
  const q2 = createPermQueue({ timeoutMs: 5000 });
  const p4 = q2.ask({ key: 'k', cwd: 'C:\\x', tool: 'Edit', input: {} });
  q2.abortProject("c:/X/"); assert.strictEqual((await p4).why, 'aborted');
  assert.strictEqual(q.answer('999', true), false);                          // id desconocido
  assert.ok(changes >= 4);
  console.log('permissions OK');
})().catch(e => { console.error(e); process.exit(1); });
const { insideCwd } = require("./control");
{ // insideCwd
  const B = String.fromCharCode(92), c = "C:" + B + "proj", ok = (t, i) => insideCwd(t, i, c);
  assert.ok(ok("Read", { file_path: "src" + B + "a.js" })); assert.ok(ok("Read", { file_path: c + B + "a.js" }));
  assert.ok(!ok("Read", { file_path: ".." + B + "secret" })); assert.ok(!ok("Read", { file_path: "C:" + B + "Windows" + B + "win.ini" }));
  assert.ok(!ok("Read", {})); assert.ok(!ok("Write", { file_path: "a" }));
  assert.ok(ok("Glob", { pattern: "**/*.js" })); assert.ok(!ok("Glob", { pattern: "C:" + B + "Windows" + B + "*" })); assert.ok(!ok("Glob", { pattern: "../*" }));
  assert.ok(ok("Grep", { pattern: "x" })); assert.ok(!ok("Grep", { pattern: "x", path: "C:" + B + "Windows" })); assert.ok(!ok("Grep", { pattern: "x", glob: ".." + B + "*" }));
}
const { toEvents } = require('./lib/events');
const { createHistory } = require('./lib/history');
const { cleanOpts } = require('./control');
{ // events / history / opts
  const A = (content, extra = {}) => ({ type: 'assistant', message: { content }, ...extra });
  assert.deepStrictEqual(toEvents({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'ho' } } }), [{ role: 'assistant', kind: 'delta', text: 'ho' }]);
  assert.deepStrictEqual(toEvents({ type: 'stream_event', parent_tool_use_id: 'x', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'a' } } }), [], 'sub-agent deltas ignored');
  assert.deepStrictEqual(toEvents({ type: 'stream_event', event: { type: 'message_start' } }), []);
  const ev = toEvents(A([{ type: 'text', text: 'hola' }, { type: 'thinking', thinking: 'mm' }, { type: 'tool_use', id: 't1', name: 'Write', input: { file_path: 'a', content: 'x'.repeat(5000) } }]));
  assert.deepStrictEqual(ev.map(e => e.kind), ['text', 'thinking', 'use']);
  assert.ok(ev[2].input.content.length < 2100, 'tool input clipped');
  assert.strictEqual(ev[2].name, 'Write'); assert.strictEqual(ev[0].sub, false);
  assert.strictEqual(toEvents(A([{ type: 'text', text: 'x' }], { parent_tool_use_id: 'p' }))[0].sub, true);
  const res = toEvents({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'ok!' }], is_error: false }, { type: 'text', text: 'ignored' }] } });
  assert.deepStrictEqual(res, [{ role: 'tool', kind: 'result', id: 't1', ok: true, text: 'ok!', sub: false }]);
  assert.strictEqual(toEvents({ type: 'user', message: { content: 'plain string' } }).length, 0);
  assert.strictEqual(toEvents({ type: 'result', subtype: 'success' }).length, 0);
  assert.ok(toEvents(A([{ type: 'text', text: 'y'.repeat(100000) }]))[0].text.length < 20100, 'assistant text clipped');
  { const big = {}; for (let i = 0; i < 3000; i++) big['k' + i] = i; assert.ok(JSON.stringify(toEvents(A([{ type: 'tool_use', id: 'b', name: 'X', input: big }]))[0].input).length < 8100, 'huge tool input truncated'); }

  const h = createHistory({ perKey: 3, maxKeys: 2 });
  h.push({ key: 'a', role: 'user', text: '1' }); h.push({ key: 'a', kind: 'delta', text: 'x' });
  for (let i = 2; i <= 5; i++) h.push({ key: 'a', role: 'user', text: String(i) });
  assert.deepStrictEqual(h.all().a.map(e => e.text), ['3', '4', '5'], 'cap per key, deltas skipped');
  h.push({ key: 'b', role: 'user', text: 'b' }); h.push({ key: 'c', role: 'user', text: 'c' });
  assert.deepStrictEqual(Object.keys(h.all()), ['b', 'c'], 'cap on keys');

  assert.deepStrictEqual(cleanOpts({ mode: 'plan', model: 'opus', effort: 'max' }), { mode: 'plan', model: 'opus', effort: 'max' });
  for (const bad of ['dontAsk', '', undefined, 7]) assert.strictEqual(cleanOpts({ mode: bad }).mode, 'default', 'blocked mode ' + bad);
  assert.strictEqual(cleanOpts({ mode: 'auto' }).mode, 'auto');
  for (const c of [undefined, false, 'true', 1]) assert.strictEqual(cleanOpts({ mode: 'bypassPermissions', confirmed: c }).mode, 'default', 'bypass unconfirmed ' + c);
  assert.strictEqual(cleanOpts({ mode: 'bypassPermissions', confirmed: true }).mode, 'bypassPermissions');
  assert.deepStrictEqual(cleanOpts({ model: 'gpt', effort: 'ultra' }), { mode: 'default', model: undefined, effort: undefined });
  assert.deepStrictEqual(cleanOpts(), { mode: 'default', model: undefined, effort: undefined });
}
const { renderMd } = require('./public/js/md');
{ // md
  const r = renderMd;
  assert.ok(!/<script/i.test(r('<script>alert(1)</script>')), 'script escaped');
  assert.ok(!/<img/i.test(r('<img src=x onerror=alert(1)>')), 'img escaped');
  assert.ok(!/href="javascript/i.test(r('[x](javascript:alert(1))')), 'javascript: link refused');
  assert.ok(!/"onmouseover/i.test(r('[x](https://a.com/"onmouseover="alert(1))')), 'attribute break-out refused');
  assert.ok(!/<a [^>]*'/.test(r("[x](https://a.com/'onmouseover='alert(1))")), 'single quote refused');
  assert.strictEqual(r('**hola**'), '<p><strong>hola</strong></p>');
  assert.ok(r('usa `x<b>` aquí').includes('<code>x&lt;b&gt;</code>'));
  assert.ok(r('```js\nlet a = "<b>";\n```').includes('<pre><code>let a = &quot;&lt;b&gt;&quot;;</code></pre>'));
  assert.ok(r('```\nsin cerrar <i>').includes('<pre><code>sin cerrar &lt;i&gt;'), 'unclosed fence renders as code while streaming');
  assert.strictEqual(r('- a\n- b'), '<ul><li>a</li><li>b</li></ul>');
  assert.strictEqual(r('1. a\n2. b'), '<ol><li>a</li><li>b</li></ol>');
  assert.ok(r('# Título').includes('<h4>Título</h4>'));
  assert.ok(r('[doc](https://example.com/a?b=1&c=2)').includes('href="https://example.com/a?b=1&amp;c=2"'));
  assert.ok(r('[doc](https://example.com)').includes('rel="noopener noreferrer"'));
  assert.strictEqual(r('a\nb'), '<p>a<br>b</p>');
  assert.strictEqual(r(''), ''); assert.strictEqual(r(null), '');
  for (const [name, inp] of [['[', '['.repeat(200000)], ['a[', 'a['.repeat(100000)], ['`', '`'.repeat(200000)], ['[a(', '[a('.repeat(70000)], ['*a', '*a'.repeat(100000)], ['fences', '```\n'.repeat(50000)]]) {
    const t0 = Date.now(); r(inp); const dt = Date.now() - t0;
    assert.ok(dt < 500, 'renderMd too slow on ' + name + ': ' + dt + ' ms');
  }
}
{ // pinned rooms: pinStatus + pinned.json helpers
  const { pinStatus: ps } = require('./lib/rooms');
  assert.strictEqual(ps('dormant', true), 'ready'); assert.strictEqual(ps('waiting', true), 'ready');
  for (const s of ['working', 'ask', 'done', 'stale']) assert.strictEqual(ps(s, true), s, s + ' stays');
  assert.strictEqual(ps('dormant', false), 'dormant'); assert.strictEqual(ps('waiting', false), 'waiting');
  const { readPinned, initPinned } = require('./lib/projects');
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pin-'));
  assert.strictEqual(readPinned(d).size, 0, 'missing file -> empty');
  initPinned(d, 'C:/Foo/Bar'); assert.ok(readPinned(d).has('c:/foo/bar'), 'default created, lowercased');
  fs.writeFileSync(path.join(d, 'pinned.json'), '[]'); initPinned(d, 'X'); assert.strictEqual(readPinned(d).size, 0, 'never overwrites');
  fs.writeFileSync(path.join(d, 'pinned.json'), '{bad'); assert.strictEqual(readPinned(d).size, 0, 'bad file -> empty');
  fs.rmSync(d, { recursive: true, force: true });
}
{ // rooms: panel-session detection
  const { isPanelSession: ip } = require('./lib/rooms');
  const s = { sessionId: 'x', startedAt: 100000 }, none = new Set();
  assert.strictEqual(ip(s, 100000, none), true, 'inside window');
  assert.strictEqual(ip(s, 95000, none), true, 'edge of window');
  assert.strictEqual(ip(s, 120000, none), false, 'session too old (terminal started before the run)');
  assert.strictEqual(ip(s, undefined, none), false, 'no run for that cwd / cwd mismatch');
  assert.strictEqual(ip(s, 120000, new Set(['x'])), true, 'known sid');
  assert.strictEqual(ip({ sessionId: 'y', startedAt: 100000 }, undefined, new Set(['x'])), false, 'other sid, no run');
}
{ // transcript → events, tail, seed, compact
  const T = require('./lib/transcript');
  const J = o => JSON.stringify(o);
  const U = (c, x = {}) => J({ type: 'user', message: { content: c }, ...x });
  const lines = [
    U('hola'), U([{ type: 'text', text: 'bloques' }]),
    U('<system-reminder>x</system-reminder>'), U('<local-command-stdout>x'), U('<command-name>/x'),
    U('meta', { isMeta: true }), U('side', { isSidechain: true }),
    J({ type: 'assistant', message: { content: [{ type: 'text', text: 'resp' }, { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }] } }),
    U([{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'out' }] }]),
    J({ type: 'system', subtype: 'compact_boundary' }), U('resumen secreto', { isCompactSummary: true }),
    U('resumen suelto', { isCompactSummary: true }),
    'basura {', J({ type: 'summary' }),
  ];
  const ev = T.transcriptToEvents(lines, 'k');
  assert.deepStrictEqual(ev.map(e => e.role + '/' + (e.kind || '')), ['user/', 'user/', 'assistant/text', 'tool/use', 'tool/result', 'system/compact', 'system/compact']);
  assert.ok(ev.every(e => e.key === 'k') && ev[0].text === 'hola' && ev[1].text === 'bloques');
  assert.ok(!JSON.stringify(ev).includes('secreto'), 'summary text not shown');
  const many = Array.from({ length: 400 }, (_, i) => U('m' + i));
  const cut = T.transcriptToEvents(many, 'k'); assert.strictEqual(cut.length, 300); assert.strictEqual(cut[299].text, 'm399'); assert.strictEqual(cut[0].text, 'm100');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cco-tr-'));
  try {
    const f = path.join(tmp, 'big.jsonl');
    fs.writeFileSync(f, Array.from({ length: 50 }, (_, i) => J({ n: i, pad: 'x'.repeat(100) })).join('\n') + '\n');
    const tail = T.readTail(f, 1000);
    assert.ok(tail.length > 0 && tail.length < 50 && tail.every(l => JSON.parse(l).n >= 0), 'partial first line dropped');
    assert.strictEqual(JSON.parse(tail[tail.length - 1]).n, 49);
    assert.strictEqual(T.readTail(f).length, 50);
    const proj = path.join(tmp, 'proj'), sid = 'abc-123';
    fs.mkdirSync(path.join(proj, 'enc-dir'), { recursive: true });
    const tf = path.join(proj, 'enc-dir', sid + '.jsonl');
    fs.writeFileSync(tf, [U('pregunta'), J({ type: 'assistant', message: { content: [{ type: 'text', text: 'respuesta' }] } })].join('\n'));
    assert.strictEqual(T.findTranscript(proj, sid), tf); assert.strictEqual(T.findTranscript(proj, 'nope'), null); assert.strictEqual(T.findTranscript(path.join(tmp, 'x'), sid), null);
    const state = path.join(tmp, 'agents.json');
    fs.writeFileSync(state, J({ 'c:/some/dir': sid, 'c:/other': 'missing' }));
    const h = createHistory(); T.seedHistory({ stateFile: state, projDir: proj, history: h });
    assert.deepStrictEqual(Object.keys(h.all()), ['c:/some/dir']); assert.deepStrictEqual(h.all()['c:/some/dir'].map(e => e.role), ['user', 'assistant']);
    T.seedHistory({ stateFile: path.join(tmp, 'none.json'), projDir: proj, history: createHistory() });
    fs.writeFileSync(state, 'garbage'); T.seedHistory({ stateFile: state, projDir: proj, history: createHistory() });
    assert.deepStrictEqual(toEvents({ type: 'system', subtype: 'compact_boundary', compact_metadata: { trigger: 'manual', pre_tokens: 45200 } }), [{ role: 'system', kind: 'compact', text: 'Conversación compactada (de ~45k tokens)' }]);
    assert.strictEqual(toEvents({ type: 'system', subtype: 'compact_boundary' })[0].text, 'Conversación compactada');
    const ctl = require('./control').createControl({ perms: {}, emit() {}, stateFile: path.join(tmp, 'empty.json') });
    ctl.send(tmp, '/compact').then(r => assert.deepStrictEqual(r, { ok: false, error: 'no hay conversación que compactar' }), e => { throw e; });
  } finally { setTimeout(() => fs.rmSync(tmp, { recursive: true, force: true }), 500).unref(); }
}
{ // setPinned (manual per-room switch)
  const P = require("./lib/projects"), os2 = require("os"), fs2 = require("fs"), path2 = require("path");
  const B = String.fromCharCode(92), w = (...p) => "C:" + B + p.join(B);
  const d = fs2.mkdtempSync(path2.join(os2.tmpdir(), "cco-pin-"));
  assert.strictEqual(P.readPinned(d).size, 0);
  P.setPinned(d, w("Work", "Alpha"), true);
  assert.ok(P.readPinned(d).has(w("Work", "Alpha").toLowerCase()), "pinned is stored lowercased");
  P.setPinned(d, w("Work", "Beta"), true); assert.strictEqual(P.readPinned(d).size, 2);
  P.setPinned(d, w("WORK", "alpha"), false);
  assert.deepStrictEqual([...P.readPinned(d)], [w("work", "beta").toLowerCase()], "unpin is case-insensitive");
  P.setPinned(d, w("work", "beta"), true); assert.strictEqual(P.readPinned(d).size, 1, "pinning twice does not duplicate");
  fs2.rmSync(d, { recursive: true, force: true });
}
{ // readProjectInstructions / instructionsAppend (project CLAUDE.md appended to the system prompt)
  const { readProjectInstructions: rpi, instructionsAppend: ia } = require("./lib/instructions");
  const os3 = require("os"), fs3 = require("fs"), path3 = require("path");
  const mk = () => fs3.mkdtempSync(path3.join(os3.tmpdir(), "cco-instr-"));
  let d = mk();
  assert.strictEqual(rpi(d), null, "no file -> null");
  fs3.writeFileSync(path3.join(d, "Claude.md"), "\uFEFFreglas del proyecto");
  let r = rpi(d); assert.ok(r && r.file === "Claude.md" && r.text === "reglas del proyecto" && r.clipped === false, "any capitalisation, BOM stripped");
  const a = ia(r); assert.ok(a.includes("Claude.md") && a.includes("reglas del proyecto") && a.includes("permisos del panel"), "append is labelled and states priority");
  fs3.writeFileSync(path3.join(d, "Claude.md"), "   \n  "); assert.strictEqual(rpi(d), null, "blank file -> null");
  fs3.writeFileSync(path3.join(d, "Claude.md"), "x".repeat(50000)); r = rpi(d);
  assert.ok(r.clipped && r.text.length < 40100, "huge file is clipped");
  fs3.rmSync(d, { recursive: true, force: true });
  d = mk(); fs3.mkdirSync(path3.join(d, "CLAUDE.md")); assert.strictEqual(rpi(d), null, "a directory named CLAUDE.md is not read");
  fs3.rmSync(d, { recursive: true, force: true });
  assert.strictEqual(rpi(path3.join(os3.tmpdir(), "cco-does-not-exist-" + Date.now())), null, "missing folder -> null");
}
{ // roomagents (specialist agents per room: only text becomes agents)
  const { parseAgent: pa, loadRoomAgents: lra } = require("./lib/roomagents");
  const os4 = require("os"), fs4 = require("fs"), path4 = require("path");
  const a1 = pa("---\nname: sec-auditor\ndescription: Audits code\n  for vulnerabilities\nmodel: opus\ntools: Read, Grep, Bash(git:*), mcp__x__y\npermissionMode: bypassPermissions\nhooks: x\nmcpServers: y\n---\n\nYou are an auditor.");
  assert.ok(a1 && a1.name === "sec-auditor" && a1.def.description === "Audits code for vulnerabilities" && a1.def.prompt === "You are an auditor.");
  assert.strictEqual(a1.def.model, "inherit", "the file's model is ignored");
  assert.deepStrictEqual(a1.def.tools, ["Read", "Grep", "Bash"], "only built-in tool names survive, Bash(git:*) becomes Bash");
  for (const bad of ["permissionMode", "hooks", "mcpServers", "memory", "background", "skills"]) assert.ok(!(bad in a1.def), bad + " is never copied");
  assert.strictEqual(pa("no frontmatter"), null); assert.strictEqual(pa("---\nname: x\n---\nbody"), null, "needs a description");
  assert.strictEqual(pa("---\nname: ../evil\ndescription: d\n---\nbody"), null, "bad name rejected");
  assert.strictEqual(pa("---\ndescription: d\n---\nbody", "from-file").name, "from-file", "name falls back to the file name");
  assert.strictEqual(pa("---\nname: n\ndescription: d\ntools: mcp__a__b\n---\nbody").def.tools, undefined, "no built-in tool left -> not restricted");
  const d = fs4.mkdtempSync(path4.join(os4.tmpdir(), "cco-room-"));
  const B = String.fromCharCode(92), room = "C:" + B + "Work" + B + "Seguridad";
  assert.strictEqual(lra({ dataDir: d, cwd: room }), null, "no rooms.json -> null");
  fs4.mkdirSync(path4.join(d, "ra", "sec"), { recursive: true });
  const ag = (n, extra) => "---\nname: " + n + "\ndescription: d " + n + "\n" + (extra || "") + "---\nprompt " + n;
  fs4.writeFileSync(path4.join(d, "ra", "sec", "a.md"), ag("alpha")); fs4.writeFileSync(path4.join(d, "ra", "sec", "b.md"), ag("alpha")); // duplicate name: first wins
  fs4.writeFileSync(path4.join(d, "ra", "sec", "c.md"), ag("gamma", "tools: Read\n")); fs4.writeFileSync(path4.join(d, "ra", "sec", "broken.md"), "garbage"); fs4.writeFileSync(path4.join(d, "ra", "sec", "notes.txt"), "x");
  fs4.writeFileSync(path4.join(d, "rooms.json"), JSON.stringify({ [room.toLowerCase()]: { agentsDir: "ra/sec" }, [B + "etc"]: { agentsDir: ".." + B + "outside" } }));
  const r = lra({ dataDir: d, cwd: room.toUpperCase() });
  assert.ok(r, "folder match is case-insensitive"); assert.deepStrictEqual(r.names, ["alpha", "gamma"], "broken, non-md and duplicate files are skipped");
  assert.strictEqual(r.agents.alpha.prompt, "prompt alpha"); assert.deepStrictEqual(r.agents.gamma.tools, ["Read"]);
  assert.strictEqual(lra({ dataDir: d, cwd: B + "etc" }), null, "agentsDir outside the data dir is refused");
  fs4.writeFileSync(path4.join(d, "rooms.json"), JSON.stringify({ [room]: { agentsDir: "C:" + B + "Windows" } })); assert.strictEqual(lra({ dataDir: d, cwd: room }), null, "absolute agentsDir refused");
  fs4.writeFileSync(path4.join(d, "rooms.json"), "not json"); assert.strictEqual(lra({ dataDir: d, cwd: room }), null, "bad rooms.json -> null");
  fs4.rmSync(d, { recursive: true, force: true });
}
console.log('check.js OK');
