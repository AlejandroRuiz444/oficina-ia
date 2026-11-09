// Per-project chat history kept in memory so a page reload gets the conversation back. Deltas are not stored (the final text is).
function createHistory({ perKey = 300, maxKeys = 50 } = {}) {
  const m = new Map();
  return {
    push(ev) {
      if (ev.kind === 'delta') return;
      let a = m.get(ev.key);
      if (!a) { if (m.size >= maxKeys) m.delete(m.keys().next().value); a = []; m.set(ev.key, a); }
      a.push(ev);
      if (a.length > perKey) a.splice(0, a.length - perKey);
    },
    all() { return Object.fromEntries(m); },
  };
}

module.exports = { createHistory };
