const clip = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n) + `\n…(${s.length - n} more characters)` : s; };
const textOf = c => (typeof c === 'string' ? c : Array.isArray(c) ? c.map(b => (b && b.type === 'text' ? b.text : '')).join('') : '');
// the card already shows a write's full content; the step line only needs a taste of it
const slim = o => {
  const j = JSON.stringify(o ?? {}, (k, v) => (typeof v === 'string' && v.length > 2000 ? v.slice(0, 2000) + '…' : v));
  if (j.length <= 8000) return JSON.parse(j);
  let n = 8000, t; // quotes re-escape when serialized again, so shrink until the wrapper itself stays under ~8000
  while (JSON.stringify(t = { truncated: j.slice(0, n) }).length > 8050 && n > 100) n = Math.floor(n * 0.9);
  return t;
};

// SDK message → chat events for the page. Deltas only from the main agent.
function toEvents(m) {
  const sub = !!m.parent_tool_use_id;
  if (m.type === 'stream_event') {
    const e = m.event;
    if (!sub && e && e.type === 'content_block_delta' && e.delta && e.delta.type === 'text_delta') return [{ role: 'assistant', kind: 'delta', text: e.delta.text }];
    return [];
  }
  if (m.type === 'system' && m.subtype === 'compact_boundary') {
    const pre = m.compact_metadata && m.compact_metadata.pre_tokens;
    return [{ role: 'system', kind: 'compact', text: 'Conversación compactada' + (typeof pre === 'number' ? ` (de ~${Math.round(pre / 1000)}k tokens)` : '') }];
  }
  if (m.type === 'assistant') {
    return ((m.message && m.message.content) || []).flatMap(b => {
      if (b.type === 'text' && b.text) return [{ role: 'assistant', kind: 'text', text: clip(b.text, 20000), sub }];
      if (b.type === 'thinking' && b.thinking) return [{ role: 'assistant', kind: 'thinking', text: clip(b.thinking, 8000), sub }];
      if (b.type === 'tool_use') return [{ role: 'tool', kind: 'use', id: b.id, name: b.name, input: slim(b.input), sub }];
      return [];
    });
  }
  if (m.type === 'user' && Array.isArray(m.message && m.message.content)) {
    return m.message.content.filter(b => b && b.type === 'tool_result')
      .map(b => ({ role: 'tool', kind: 'result', id: b.tool_use_id, ok: !b.is_error, text: clip(textOf(b.content), 4000), sub }));
  }
  return [];
}

module.exports = { toEvents };
