const norm = c => String(c).split(String.fromCharCode(92)).join('/').replace(/\/+$/, '').toLowerCase();
function createPermQueue({ timeoutMs = 600000, onChange = () => {} } = {}) {
  const items = new Map();
  let seq = 0;
  const pending = () => [...items.values()].map(({ resolve, timer, ...pub }) => pub);
  function finish(id, allow, why) {
    const it = items.get(id);
    if (!it) return false;
    clearTimeout(it.timer);
    items.delete(id);
    it.resolve({ allow, why });
    onChange(pending());
    return true;
  }
  return {
    ask(info) {
      return new Promise(resolve => {
        const id = String(++seq);
        const timer = setTimeout(() => finish(id, false, 'timeout'), timeoutMs);
        items.set(id, { id, ...info, at: Date.now(), resolve, timer });
        onChange(pending());
      });
    },
    answer: (id, allow) => finish(String(id), !!allow, allow ? 'approved' : 'rejected'),
    pending,
    abortProject(cwd) { for (const it of [...items.values()]) if (norm(it.cwd) === norm(cwd)) finish(it.id, false, 'aborted'); },
  };
}

module.exports = { createPermQueue };
