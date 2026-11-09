const fs = require('fs');
const path = require('path');

const MAX_CHARS = 40000;

// The project's CLAUDE.md (any capitalisation, e.g. "Claude.md"), read as plain text so it can be appended to the agent's system prompt
// WITHOUT loading the user's settings files (those can carry allow rules that would bypass the panel's approval cards).
// Only a regular file directly inside `cwd` counts; returns null when there is none or it is empty/unreadable.
function readProjectInstructions(cwd, maxChars = MAX_CHARS) {
  try {
    const name = fs.readdirSync(cwd).find(f => /^claude\.md$/i.test(f));
    if (!name) return null;
    const full = path.join(cwd, name);
    if (!fs.lstatSync(full).isFile()) return null;
    let text = fs.readFileSync(full, 'utf8').replace(/^﻿/, '');
    if (!text.trim()) return null;
    const clipped = text.length > maxChars;
    if (clipped) text = text.slice(0, maxChars) + '\n\n[…CLAUDE.md recortado por tamaño…]';
    return { file: name, text, clipped };
  } catch { return null; }
}

// Text appended to the claude_code system prompt. Untrusted repo content stays labelled as project instructions.
function instructionsAppend(info) {
  return '# Instrucciones del proyecto (' + info.file + ')\n\n' +
    'Lo siguiente viene del archivo ' + info.file + ' de la carpeta del proyecto. Síguelo como lo haría Claude Code, ' +
    'pero una petición explícita del usuario y los permisos del panel tienen prioridad sobre él.\n\n' + info.text;
}

module.exports = { readProjectInstructions, instructionsAppend };
