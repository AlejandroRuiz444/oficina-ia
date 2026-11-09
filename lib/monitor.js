'use strict';
// Vigilancia sin IA (0 tokens): cada N minutos revisa los proyectos con git y avisa en su sala.
// Solo mira archivos cambiados sin commitear. Nunca imprime el valor de un secreto, solo tipo y archivo:línea.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const PATTERNS = [
  ['clave de AWS', /AKIA[0-9A-Z]{16}/],
  ['clave de Anthropic/OpenAI', /sk-(?:ant-)?[A-Za-z0-9_-]{24,}/],
  ['token de GitHub', /gh[pousr]_[A-Za-z0-9]{30,}/],
  ['clave privada', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ['JWT (¿clave de Supabase?)', /eyJ[\w-]{20,}\.[\w-]{20,}\.[\w-]{20,}/],
];
const ENV_FILE = /(^|\/)\.env(\.|$)(?!example|sample|template)/i;
const MAX_FILES = 200, MAX_BYTES = 200 * 1024;

const git = (cwd, args) => new Promise(res => execFile('git', args, { cwd, timeout: 8000, maxBuffer: 4e6, windowsHide: true }, (e, out) => res(e ? null : out)));

// → [{ id, text }] hallazgos de un proyecto
async function checkProject(cwd) {
  if (!fs.existsSync(path.join(cwd, '.git'))) return [];
  const out = await git(cwd, ['status', '--porcelain', '-z', '-uall']);
  if (out == null) return [];
  const files = out.split('\0').filter(s => s.length > 3).map(s => s.slice(3)).slice(0, MAX_FILES);
  const found = [];
  for (const f of files) {
    const abs = path.join(cwd, f);
    if (ENV_FILE.test(f.replace(/\\/g, '/'))) {
      const ign = await git(cwd, ['check-ignore', '-q', f]); // null = no ignorado (o error)
      if (ign == null) found.push({ id: 'env:' + f, text: `${f} no está en .gitignore: podría subirse a git con claves.` });
    }
    let st; try { st = fs.lstatSync(abs); } catch { continue; }
    if (!st.isFile() || st.size > MAX_BYTES) continue;
    let txt; try { txt = fs.readFileSync(abs, 'utf8'); } catch { continue; }
    if (txt.includes('\0')) continue; // binario
    const lines = txt.split('\n');
    for (const [name, re] of PATTERNS) {
      const i = lines.findIndex(l => re.test(l));
      if (i >= 0) found.push({ id: `sec:${name}:${f}`, text: `Posible ${name} en ${f}:${i + 1} (cambio sin commitear).` });
    }
  }
  return found;
}

/**
 * start({ dataDir, list, notify, everyMin }): list() → [cwd]; notify(cwd, text).
 * Avisa una sola vez por hallazgo (se recuerda en monitor-seen.json).
 */
function startMonitor({ dataDir, list, notify, everyMin = 30 }) {
  const seenFile = path.join(dataDir, 'monitor-seen.json');
  let seen = {}; try { seen = JSON.parse(fs.readFileSync(seenFile, 'utf8')); } catch { /* primera vez */ }
  let running = false;
  async function run() {
    if (running) return; running = true;
    try {
      for (const cwd of list()) {
        const found = await checkProject(cwd);
        const now = new Set(found.map(f => f.id));
        const k = cwd.toLowerCase();
        const prev = new Set(seen[k] || []);
        for (const f of found) if (!prev.has(f.id)) notify(cwd, '⚠ Vigilancia: ' + f.text);
        seen[k] = [...now]; // si se corrige y reaparece, vuelve a avisar
      }
      fs.writeFileSync(seenFile, JSON.stringify(seen));
    } catch (e) { console.error('monitor', e); } finally { running = false; }
  }
  setTimeout(run, 20e3).unref();
  setInterval(run, everyMin * 60e3).unref();
  return { run };
}

module.exports = { checkProject, startMonitor, PATTERNS };
