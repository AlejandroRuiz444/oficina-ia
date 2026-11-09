const crypto = require('crypto');

function makeGuard(port, token = crypto.randomBytes(24).toString('hex')) {
  const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  const origins = hosts.map(h => 'http://' + h);
  const tokenOk = t => {
    if (typeof t !== 'string') return false;
    const a = Buffer.from(t), b = Buffer.from(token);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  };
  return {
    token, tokenOk,
    // ok=false → 403 (DNS rebinding / pages from other sites). control=true only with the right token.
    check(req) {
      const o = req.headers.origin;
      if (!hosts.includes(req.headers.host) || (o && !origins.includes(o))) return { ok: false, control: false };
      return { ok: true, control: tokenOk(req.headers['x-office-token']) };
    },
  };
}

module.exports = { makeGuard };
