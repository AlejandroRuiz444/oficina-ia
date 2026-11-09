// Small, safe Markdown subset for chat messages. Everything is HTML-escaped BEFORE any tag is added,
// links only allow http(s), and an escaped value can never contain a quote, so attributes cannot be broken out of.
(function (root) {
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const inline = s => s.length > 2000 ? s : s // s is already escaped; long single lines stay plain (bounded regex cost)
    .replace(/`([^`\n]{1,500})`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]{1,500})\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\n]{1,500})\*(?=$|[\s).,;:!?])/g, '$1<em>$2</em>')
    .replace(/\[([^\]\n]{1,300})\]\((https?:\/\/[^\s)]{1,500})\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

  function blocks(t) {
    const out = []; let list = null, para = [];
    const flushP = () => { if (para.length) { out.push('<p>' + para.map(l => inline(esc(l))).join('<br>') + '</p>'); para = []; } };
    const flushL = () => { if (list) { out.push('<' + list.t + '>' + list.items.map(i => '<li>' + inline(esc(i)) + '</li>').join('') + '</' + list.t + '>'); list = null; } };
    for (const line of t.split('\n')) {
      let m;
      if (!line.trim()) { flushP(); flushL(); }
      else if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) { flushP(); flushL(); out.push('<h4>' + inline(esc(m[2])) + '</h4>'); }
      else if ((m = /^\s*[-*]\s+(.*)$/.exec(line)) || (m = /^\s*\d+\.\s+(.*)$/.exec(line))) {
        flushP();
        const tag = /^\s*\d/.test(line) ? 'ol' : 'ul';
        if (!list || list.t !== tag) { flushL(); list = { t: tag, items: [] }; }
        list.items.push(m[1]);
      } else { flushL(); para.push(line); }
    }
    flushP(); flushL();
    return out.join('');
  }

  function renderMd(text) {
    let src = String(text == null ? '' : text).replace(/\r\n/g, '\n');
    if ((src.match(/```/g) || []).length % 2) src += '\n```'; // a fence still open while streaming
    return src.split(/(```[^\n]{0,20}\n[\s\S]*?```)/g).map((p, i) => {
      if (!(i % 2)) return blocks(p);
      const m = /^```[^\n]{0,20}\n([\s\S]*?)```$/.exec(p);
      return '<pre><code>' + esc(m ? m[1].replace(/\n$/, '') : p) + '</code></pre>';
    }).join('');
  }

  root.renderMd = renderMd;
  if (typeof module !== 'undefined' && module.exports) module.exports = { renderMd };
})(typeof window !== 'undefined' ? window : globalThis);
