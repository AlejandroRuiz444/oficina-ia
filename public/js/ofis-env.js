// Surroundings of the office: a floating diorama island laid out around the building and the local lots,
// with a street along the entrances, a river with a footbridge and a waterfall, woods and mountains.
// It is static geometry merged into a few meshes (9 draw calls by day, 11 at night, none casting shadows);
// per frame only the water texture scrolls, two toy cars drive by and, after dark (local time), the street
// lamps and the windows light up. The island is rebuilt only when the building or the lots change size, or when
// a resized view needs a bigger island to reach past its edges.
//
// Preview another time of day by adding ?hour=21 to the page URL (before the #); ?env=0 leaves the surroundings out.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// ------------------------------------------------------------ levels (1 unit ≈ 1 meter; the office floor is at y = 0)

const GY = -0.1;                  // grass
const ROAD_Y = GY + 0.012;        // asphalt
const WALK_Y = -0.012;            // sidewalks and paving, just below the office floor
const PATH_Y = GY + 0.014;        // dirt paths
const WATER_Y = GY - 0.2;
const BED = 0.58;                 // river bed depth below the grass
const BASE_H = 3.3;               // thickness of the island's cross-section
const SUB = GY - 0.34;            // bottom of the road and sidewalk slabs

const PAL = {
  grassA: '#8cc76c', grassB: '#a6d47d', grassWood: '#70ad59',
  sand: '#e3d09a', sandWet: '#c2b07e', bed: '#5f8f86', clearing: '#d0b67f',
  dirt: '#dcc28c', dirtEdge: '#c3a36f',
  walk: '#d4d7dc', curb: '#b3b8c1', joint: '#c0c4cb', asphalt: '#4b505c', paint: '#f1efe6', paintY: '#f2c14e',
  pole: '#434a58', poleBase: '#353b47', lampHead: '#2d323d', bulb: '#f4eedb',
  wood: '#c38b57', woodDark: '#8d5c38', iron: '#3c414c', plank: '#c79261', plank2: '#b98552',
  stone: '#aaa59d', stoneDark: '#8f8b85',
  glass: '#33405a', tire: '#24262c', hub: '#c3c7cf', headlight: '#fff4d6', tail: '#e0483f',
  window: '#a8cfe2', frame: '#f5f2ea', leaf: '#4f9a4c', leaf2: '#63b058', lily: '#4e9a52',
  plate: '#30364a',
};
const STRATA = [                  // the island's cross-section, top to bottom
  { d: 0.34, c: '#6aa851' },      // grass lip
  { d: 1.05, c: '#8f5f3d' },      // topsoil
  { d: 1.85, c: '#b07a4b' },      // clay
  { d: 2.55, c: '#74513a' },      // dark soil
  { d: BASE_H, c: '#7b7880' },    // bedrock
];
const FLOWERS = ['#f2c14e', '#e8735a', '#f29fb5', '#ffffff', '#9d7fd8', '#f7e27a'];
const CAR_COLORS = ['#e0574f', '#f2c14e', '#4f86c6', '#4fa3a0', '#eef0f3', '#9d7fd8', '#e8974f'];
const HOUSES = [
  { wall: '#f1e3c6', roof: '#c8553d' }, { wall: '#bcd7e6', roof: '#5f6f96' },
  { wall: '#f3cf86', roof: '#8a5a3a' }, { wall: '#e9b8a3', roof: '#5f8f5a' },
];
const ROCKS = ['#a7a29b', '#9a9690', '#b3aea4'];
const TREE_H = { round: 2.4, pine: 2.75, bush: 0.7 };
const TREE_R = { round: 0.95, pine: 0.8, bush: 0.6 };

// ------------------------------------------------------------ small helpers

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, k) => a + (b - a) * k;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function rng(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// stable hash of integer coordinates → [0, 1): placement is tied to world cells, so a rebuild keeps most things in place
function hash2(x, z, s = 0) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(z | 0, 0x165667b1) ^ Math.imul(s | 0, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, z, s) {
  const xi = Math.floor(x), zi = Math.floor(z), fx = x - xi, fz = z - zi;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash2(xi, zi, s), b = hash2(xi + 1, zi, s), c = hash2(xi, zi + 1, s), d = hash2(xi + 1, zi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
  const t = l2 ? clamp(((px - ax) * dx + (pz - az) * dz) / l2, 0, 1) : 0;
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}
const colorCache = new Map();
function C(v) {
  if (v && v.isColor) return v;
  let c = colorCache.get(v);
  if (!c) colorCache.set(v, c = new THREE.Color(v));
  return c;
}

// ------------------------------------------------------------ geometry merging

const G = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 10),
  disc: new THREE.CylinderGeometry(0.5, 0.5, 1, 18),
  prism3: new THREE.CylinderGeometry(0.5, 0.5, 1, 3),
  oct: new THREE.CylinderGeometry(0.5, 0.5, 1, 8),
  cone: new THREE.ConeGeometry(0.5, 1, 7),
  ico: new THREE.IcosahedronGeometry(0.5, 0),
  rock: new THREE.DodecahedronGeometry(0.5, 0),
  gem: new THREE.OctahedronGeometry(0.5, 0),
  flat: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
};
const roundedCache = new Map();
function rounded(w, h, d, r) {
  const key = [w, h, d, r].join('|');
  let g = roundedCache.get(key);
  if (!g) roundedCache.set(key, g = new RoundedBoxGeometry(w, h, d, 2, r));
  return g;
}

const _m = new THREE.Matrix4(), _n = new THREE.Matrix3(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
const _p = new THREE.Vector3(), _s = new THREE.Vector3(), _v = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3();
const _out = new THREE.Vector3(), _col = new THREE.Color();

// Collects vertex-colored geometry in growing typed arrays and builds one BufferGeometry from it (one draw call).
class Mesher {
  constructor(o = {}) {
    this.cs = o.alpha ? 4 : 3;
    this.uv = !!o.uv;
    this.v = 0; this.n = 0; this.cap = 0;
    this.P = this.N = this.C = this.U = null;
    this.I = new Uint32Array(4096);
    this.reserve(2048);
  }
  reserve(extra) {
    const need = this.v + extra;
    if (need <= this.cap) return;
    let cap = Math.max(2048, this.cap);
    while (cap < need) cap *= 2;
    const grow = (a, k) => { const b = new Float32Array(cap * k); if (a) b.set(a.subarray(0, this.v * k)); return b; };
    this.P = grow(this.P, 3); this.N = grow(this.N, 3); this.C = grow(this.C, this.cs);
    if (this.uv) this.U = grow(this.U, 2);
    this.cap = cap;
  }
  reserveI(extra) {
    if (this.n + extra <= this.I.length) return;
    let cap = this.I.length;
    while (cap < this.n + extra) cap *= 2;
    const b = new Uint32Array(cap);
    b.set(this.I.subarray(0, this.n));
    this.I = b;
  }
  vert(x, y, z, nx, ny, nz, c, a = 1, u = 0, w = 0) {
    if (this.v >= this.cap) this.reserve(1);
    const i = this.v, p = i * 3, q = i * this.cs, P = this.P, N = this.N, Cc = this.C;
    P[p] = x; P[p + 1] = y; P[p + 2] = z;
    N[p] = nx; N[p + 1] = ny; N[p + 2] = nz;
    Cc[q] = c.r; Cc[q + 1] = c.g; Cc[q + 2] = c.b;
    if (this.cs === 4) Cc[q + 3] = a;
    if (this.U) { this.U[i * 2] = u; this.U[i * 2 + 1] = w; }
    return this.v++;
  }
  tri(a, b, c) {
    if (this.n + 3 > this.I.length) this.reserveI(3);
    const I = this.I;
    I[this.n++] = a; I[this.n++] = b; I[this.n++] = c;
  }
  // flat-shaded triangle; with `out` the normal is turned to face that direction
  ftri(a, b, c, color, out) {
    _a.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    _b.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    _v.crossVectors(_a, _b);
    if (out && _v.dot(out) < 0) { const t = b; b = c; c = t; _v.negate(); }
    _v.normalize();
    const k = C(color);
    const i = this.vert(a[0], a[1], a[2], _v.x, _v.y, _v.z, k);
    this.vert(b[0], b[1], b[2], _v.x, _v.y, _v.z, k);
    this.vert(c[0], c[1], c[2], _v.x, _v.y, _v.z, k);
    this.tri(i, i + 1, i + 2);
  }
  add(geo, m, color) {
    const k = C(color), pos = geo.attributes.position.array, nor = geo.attributes.normal.array;
    const cnt = geo.attributes.position.count, base = this.v, cs = this.cs;
    this.reserve(cnt);
    _n.getNormalMatrix(m);
    const e = m.elements, ne = _n.elements, P = this.P, N = this.N, Cc = this.C, U = this.U;
    for (let i = 0; i < cnt; i++) {
      const s = i * 3, o = (base + i) * 3, q = (base + i) * cs;
      const x = pos[s], y = pos[s + 1], z = pos[s + 2], a = nor[s], b = nor[s + 1], c = nor[s + 2];
      P[o] = e[0] * x + e[4] * y + e[8] * z + e[12];
      P[o + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
      P[o + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
      const nx = ne[0] * a + ne[3] * b + ne[6] * c, ny = ne[1] * a + ne[4] * b + ne[7] * c, nz = ne[2] * a + ne[5] * b + ne[8] * c;
      const l = 1 / (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1);
      N[o] = nx * l; N[o + 1] = ny * l; N[o + 2] = nz * l;
      Cc[q] = k.r; Cc[q + 1] = k.g; Cc[q + 2] = k.b;
      if (cs === 4) Cc[q + 3] = 1;
      if (U) { U[(base + i) * 2] = 0; U[(base + i) * 2 + 1] = 0; }
    }
    this.v += cnt;
    if (geo.index) {
      const ix = geo.index.array;
      this.reserveI(ix.length);
      for (let i = 0; i < ix.length; i++) this.I[this.n++] = base + ix[i];
    } else {
      this.reserveI(cnt);
      for (let i = 0; i < cnt; i++) this.I[this.n++] = base + i;
    }
  }
  // rotation order: first rz, then rx (tilt), then ry (heading)
  put(geo, x, y, z, sx, sy, sz, color, ry = 0, rx = 0, rz = 0) {
    _q.setFromEuler(_e.set(rx, ry, rz, 'YXZ'));
    _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
    this.add(geo, _m, color);
  }
  box(x, y, z, w, h, d, color, ry = 0) { this.put(G.box, x, y, z, w, h, d, color, ry); }
  slab(x0, x1, z0, z1, top, bottom, color) {
    this.put(G.box, (x0 + x1) / 2, (top + bottom) / 2, (z0 + z1) / 2, x1 - x0, top - bottom, z1 - z0, color);
  }
  build() {
    const g = new THREE.BufferGeometry(), v = this.v;
    g.setAttribute('position', new THREE.BufferAttribute(this.P.slice(0, v * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.N.slice(0, v * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.C.slice(0, v * this.cs), this.cs));
    if (this.U) g.setAttribute('uv', new THREE.BufferAttribute(this.U.slice(0, v * 2), 2));
    const idx = this.I.subarray(0, this.n);
    g.setIndex(new THREE.BufferAttribute(v > 65535 ? idx.slice() : Uint16Array.from(idx), 1));
    g.computeBoundingSphere();
    return g;
  }
}

// Draws into a mesher in a local frame at (x, y, z) turned by ry; +z is the object's front.
function local(M, x, y, z, ry = 0) {
  const c = Math.cos(ry), s = Math.sin(ry);
  const at = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
  return {
    at,
    box(lx, ly, lz, w, h, d, color, rx = 0, rz = 0) { const p = at(lx, lz); M.put(G.box, p[0], y + ly, p[1], w, h, d, color, ry, rx, rz); },
    put(geo, lx, ly, lz, sx, sy, sz, color, rx = 0, rz = 0, ry2 = 0) { const p = at(lx, lz); M.put(geo, p[0], y + ly, p[1], sx, sy, sz, color, ry + ry2, rx, rz); },
  };
}

// ------------------------------------------------------------ layout

// ------------------------------------------------------------ road connections (for roads that leave the local lots)

const ROAD_DIRS = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0], north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
// 'n' | 's' | 'e' | 'w' (n = -z, s = +z, e = +x, w = -x) or a vector { x, z } / [x, z], snapped to the nearest axis
function axisDir(d) {
  if (typeof d === 'string') return ROAD_DIRS[d.trim().toLowerCase()] || null;
  const x = Array.isArray(d) ? d[0] : d && d.x, z = Array.isArray(d) ? d[1] : d && d.z;
  if (!Number.isFinite(x) || !Number.isFinite(z) || (!x && !z)) return null;
  return Math.abs(x) >= Math.abs(z) ? [Math.sign(x), 0] : [0, Math.sign(z)];
}
// the main street's lines (x), laid along the +x side of the building and the lots
function streetX(b) {
  const sx = b.x1;
  return { walk0: sx + 1.1, road0: sx + 3.1, mid: sx + 6.2, park: sx + 9.3, road1: sx + 11.3, walk1: sx + 13.3 };
}
function unionBounds(base, lots) {
  const b = { ...base };
  for (const l of lots) { b.x0 = Math.min(b.x0, l.x0); b.x1 = Math.max(b.x1, l.x1); b.z0 = Math.min(b.z0, l.z0); b.z1 = Math.max(b.z1, l.z1); }
  return b;
}
// does the axis-aligned segment, widened by hw on each side, overlap rect r?
function segHits(ax, az, bx, bz, hw, r) {
  return Math.min(ax, bx) - hw < r.x1 && Math.max(ax, bx) + hw > r.x0 && Math.min(az, bz) - hw < r.z1 && Math.max(az, bz) + hw > r.z0;
}
// A connection leaves its mouth straight in its direction and then runs outside the building and the lots
// (at most two bends) to the main street, which it meets at a right angle. Points are [x, z]; the last one lies on
// the street's centerline (the junction).
function routeFor(req, base, lots, X) {
  const hw = req.width / 2, c = hw + 0.9, rects = [base, ...lots];
  const b = unionBounds(base, lots), ring = { x0: b.x0 - c, x1: b.x1 + c, z0: b.z0 - c, z1: b.z1 + c };
  const others = rects.filter(r => !(req.x >= r.x0 - 0.3 && req.x <= r.x1 + 0.3 && req.z >= r.z0 - 0.3 && req.z <= r.z1 + 0.3));
  const free = (ax, az, bx, bz, list) => !list.some(r => segHits(ax, az, bx, bz, hw - 0.05, r));
  const eastFrom = (x, z) => x <= X.road0 && free(x, z, X.road0, z, rects);
  const m = [req.x, req.z];
  const [dx, dz] = req.d;
  if (dx > 0) {
    if (free(req.x, req.z, X.road0, req.z, others)) return [m, [X.mid, req.z]];
    // something is in the way: step just out of the lot, then round the nearer end of the office and the lots
    const own = rects.find(r => !others.includes(r));
    const ex = Math.max(req.x + 0.5, (own ? own.x1 : req.x) + hw + 0.2), zs = req.z > (b.z0 + b.z1) / 2 ? ring.z1 : ring.z0;
    return [m, [ex, req.z], [ex, zs], [X.mid, zs]];
  }
  let px = req.x + dx * c, pz = req.z + dz * c;
  if (!free(req.x, req.z, px, pz, others)) return [m, [X.mid, req.z]];      // the mouth faces into something: go straight
  if (dx >= 0 && eastFrom(px, pz)) return [m, [px, pz], [X.mid, pz]];
  if (dx) px = dx > 0 ? Math.max(px, ring.x1) : Math.min(px, ring.x0);
  else pz = dz > 0 ? Math.max(pz, ring.z1) : Math.min(pz, ring.z0);
  const out = [m, [px, pz]];
  if (!eastFrom(px, pz)) {                                                   // beside the building: round its nearer end
    pz = pz - ring.z0 < ring.z1 - pz ? ring.z0 : ring.z1;
    out.push([px, pz]);
  }
  out.push([X.mid, pz]);
  return out;
}

// The camera's orientation and the viewport size, read from the office's orthographic camera.
function viewOf(camera) {
  const e = camera.matrixWorld.elements;
  return { w: camera.right - camera.left, h: camera.top - camera.bottom, R: [e[0], e[1], e[2]], U: [e[4], e[5], e[6]] };
}

// The island: fixed margins around the building and the lots, grown so that it reaches past the left, right and bottom
// edges of the default ("fit") view: fitBox is the office's framing in screen units ({ a0, a1, b0, b1 } along the camera's
// right and up axes); without it the framing of the bounds alone is re-derived the same way.
function islandRect(b, view, fitBox) {
  const I = { x0: b.x0 - 21, x1: b.x1 + 21.8, z0: b.z0 - 17, z1: b.z1 + 12.5 };
  if (view && view.w > 50 && view.h > 50) {
    const [rx, ry, rz] = view.R, [ux, uy, uz] = view.U;
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    if (fitBox) ({ a0, a1, b0, b1 } = fitBox);        // the office's own framing (it can include extra objects)
    else {
      for (const x of [b.x0, b.x1]) for (const z of [b.z0, b.z1]) for (const y of [-0.5, 2.9]) {
        const pa = rx * x + ry * y + rz * z, pb = ux * x + uy * y + uz * z;
        a0 = Math.min(a0, pa); a1 = Math.max(a1, pa); b0 = Math.min(b0, pb); b1 = Math.max(b1, pb);
      }
    }
    const narrow = view.w < 640;
    const zoom = clamp(Math.min((view.w - (narrow ? 16 : 42)) / (a1 - a0), (view.h - (narrow ? 64 : 34)) / (b1 - b0)), 3, 70);
    const ca = (a0 + a1) / 2, cb = (b0 + b1) / 2, ha = view.w / 2 / zoom, hb = view.h / 2 / zoom, det = rx * uz - rz * ux;
    // ground points under the side edges (up to a little above the middle), the bottom corners and the top middle
    for (const [sa, sb] of [[-1, 0.35], [1, 0.35], [-1, -1], [1, -1], [0, -1], [0, 0.8]]) {
      const A = ca + sa * ha - ry * GY, B = cb + sb * hb - uy * GY;
      const x = (A * uz - rz * B) / det, z = (rx * B - ux * A) / det;
      I.x0 = Math.min(I.x0, Math.max(x - 3, b.x0 - 90)); I.x1 = Math.max(I.x1, Math.min(x + 3, b.x1 + 90));
      I.z0 = Math.min(I.z0, Math.max(z - 3, b.z0 - 90)); I.z1 = Math.max(I.z1, Math.min(z + 3, b.z1 + 90));
    }
  }
  return { x0: Math.floor(I.x0), x1: Math.ceil(I.x1), z0: Math.floor(I.z0), z1: Math.ceil(I.z1) };
}

// Everything is placed relative to the bounds of the building and the lots, outside of them:
// the street runs along the entrances (+x), the river and the woods lie on the far-left side (-x),
// the mountains along the two far edges and a meadow with a footpath in front (+z).
function plan(info, I, reqs = []) {
  const b = info.bounds, base = info.base || b;
  const lots = info.lots || [];
  const entries = (info.entries || []).filter(Number.isFinite);
  const X = streetX(b);
  // roads from the lots to the street (connectRoad); the footpath in front of the building moves out past them
  const roads = reqs.map(req => ({ req, w: req.width, pts: routeFor(req, base, lots, X) }));
  let pz = b.z1 + 2.9;
  for (let pass = 0; pass < 2; pass++) {
    for (const r of roads) {
      for (let i = 0; i < r.pts.length - 1; i++) {
        const az = r.pts[i][1], bz = r.pts[i + 1][1];
        if (Math.abs(az - bz) < 1e-6 && az > b.z1 - 0.5 && az - r.w / 2 < pz + 1.5) pz = Math.max(pz, az + r.w / 2 + 2.5);
      }
    }
  }
  I = { ...I, z1: Math.max(I.z1, Math.ceil(pz + 9.6)) };
  const zLobby = clamp(entries.length ? entries[entries.length - 1] : (b.z0 + b.z1) / 2, I.z0 + 5, I.z1 - 5);
  let zBus = zLobby - 4.6;
  if (zBus < I.z0 + 4) zBus = zLobby + 4.6;

  // the mountain ridges stand at a fixed distance behind the building (so they show behind it at the default zoom),
  // whatever the island's size; a bigger island gets a taller second row further back
  const zr = Math.max(I.z0 + 5.4, b.z0 - 18), xr2 = Math.max(I.x0 + 5.4, b.x0 - 20.5);

  // the river: springs from a hill at the back ridge, passes the building on the left, widens into a pond and falls off the front edge
  const rx0 = b.x0 - 6.4, zPond = pz + 4.9, zSrc = zr + 0.8;
  const river = {
    zSrc,
    x: z => rx0 + 0.85 * Math.sin(z * 0.19 + 0.7) + 0.45 * Math.sin(z * 0.071 + 2.1),
    dx: z => 0.1615 * Math.cos(z * 0.19 + 0.7) + 0.032 * Math.cos(z * 0.071 + 2.1),
    hw: z => (1.2 + 0.14 * Math.sin(z * 0.43 + 1.3) + 2.3 * Math.exp(-(((z - zPond) / 3.1) ** 2))) * smooth(zSrc, zSrc + 2.5, z),
  };
  river.dist = (x, z) => Math.abs(x - river.x(z)) / Math.sqrt(1 + river.dx(z) ** 2);
  const bridgeX = river.x(pz), bridgeL = river.hw(pz) + 1.15;
  const clear = { x: bridgeX - bridgeL - 4.6, z: pz - 3.4, r: 2.1 };
  const paths = [
    [[X.walk0 + 0.05, pz], [bridgeX + bridgeL, pz]],
    [[bridgeX - bridgeL, pz], [bridgeX - bridgeL - 1.9, pz - 0.35], [clear.x + 0.8, clear.z + 1.1]],
  ];

  // houses across the street, facing it
  const houses = [];
  for (let z = Math.round(b.z0 - 6); z + 4.4 < Math.min(I.z1 - 3, b.z1 + 8) && houses.length < 4; z += 9) {
    const zc = z + 2.2;
    if (Math.abs(zc - zBus) < 4.6) { z -= 5; continue; }
    const st = HOUSES[Math.abs(Math.round(z)) % HOUSES.length];
    houses.push({ x0: X.walk1 + 1.8, z0: z, w: 3.8, d: 4.4, ...st, seed: Math.round(z * 13) });
  }

  // mountains along the two far edges, the tallest in the far corner
  const mts = [];
  const leftBank = z => river.x(z) - river.hw(z) - 1.4;
  const addM = (x, z, r, h, o = {}) => {
    mts.push({ x, z, r, h, p: h < 4 ? 0.7 : 1.2, snow: h > 7.4, seed: (Math.round(x * 7) * 73856093) ^ (Math.round(z * 7) * 19349663), ...o });
  };
  const free = (x, z, r) => !mts.some(m => Math.hypot(m.x - x, m.z - z) < (m.r + r) * 0.55);
  addM(river.x(zSrc) - 0.4, zSrc - 1.2, 5.0, 6.2);                              // the spring hill
  addM(xr2 + 1.8, zr + 1.8, 7.4, 12.5);                                         // the peak in the far corner
  for (let x = xr2 + 8; ;) {
    const t = clamp((x - xr2) / (X.walk0 - xr2), 0, 1);
    const r = lerp(6.2, 4.0, t) * (0.9 + 0.2 * hash2(Math.round(x), 1, 41));
    if (x + r > X.walk0 - 1.5) break;
    const h = lerp(10.5, 3.0, t) * (0.8 + 0.35 * hash2(Math.round(x), 2, 42));
    const z = zr + (hash2(Math.round(x), 3, 43) - 0.5) * 1.6;
    if (free(x, z, r)) addM(x, z, r, h);
    x += r * 1.2;
  }
  for (let z = zr + 9; ;) {
    const t = clamp((z - zr) / (b.z1 - zr), 0, 1);
    let r = lerp(6, 4.2, t) * (0.9 + 0.2 * hash2(Math.round(z), 4, 44));
    if (z + r > b.z1 - 3) break;
    const x = xr2 + (hash2(Math.round(z), 5, 45) - 0.5) * 1.4;
    r = Math.min(r, leftBank(z) - x - 0.6);
    const h = lerp(9.5, 3.4, t) * (0.8 + 0.35 * hash2(Math.round(z), 6, 46)) * clamp(r / 5, 0.6, 1);
    if (r > 2 && free(x, z, r)) addM(x, z, r, h);
    z += Math.max(r, 3.5) * 1.2;
  }
  // a taller, snowy second row behind the ridges when the island reaches that far
  if (zr - 9 > I.z0 + 3) {
    for (let x = xr2 - 4; x < X.walk0 - 5; x += 8.6) {
      const r = 6.2 + hash2(Math.round(x), 11, 51) * 1.4, z = zr - 8.5 + (hash2(Math.round(x), 12, 52) - 0.5) * 2;
      if (x - r > I.x0 - 2) addM(x, z, r, 11 + hash2(Math.round(x), 13, 53) * 4.5);
    }
  }
  if (xr2 - 9 > I.x0 + 3) {
    for (let z = zr + 4; z < b.z1 - 6; z += 8.6) {
      const r = 6 + hash2(Math.round(z), 14, 54) * 1.3, x = xr2 - 8.5 + (hash2(Math.round(z), 15, 55) - 0.5) * 2;
      addM(x, z, r, lerp(14, 9, clamp((z - zr) / (b.z1 - zr), 0, 1)) * (0.85 + hash2(Math.round(z), 16, 56) * 0.3));
    }
  }
  // green foothills in front of the back ridge, and two hills in the right corner
  for (let x = xr2 + 12; x < X.walk0 - 6; x += 8.5) {
    const z = zr + 5.8 + (hash2(Math.round(x), 7, 47) - 0.5) * 1.5, r = 2.6 + hash2(Math.round(x), 8, 48) * 0.9;
    if (hash2(Math.round(x), 9, 49) < 0.35 || z + r > b.z0 - 2.4 || Math.abs(x - river.x(z)) < r + river.hw(z) + 1.5) continue;
    addM(x, z, r, 1.5 + hash2(Math.round(x), 10, 50) * 1.2);
  }
  const hillOk = (x, z, r) => x + r < I.x1 && !houses.some(h => x + r > h.x0 - 0.5 && x - r < h.x0 + h.w + 0.5 && z + r > h.z0 - 0.5 && z - r < h.z0 + h.d + 0.5);
  if (hillOk(X.walk1 + 4.6, zr + 1, 3.6)) addM(X.walk1 + 4.6, zr + 1, 3.6, 3.1);
  if (hillOk(X.walk1 + 10, zr + 5.5, 2.6)) addM(X.walk1 + 10, zr + 5.5, 2.6, 2.0);

  // tulip fields in the meadow in front, away from the river, the pond and the island's edge
  const fields = [];
  for (let k = 0, fx = b.x0 + (X.walk0 - b.x0) * 0.3; k < 2 && fx + 3.6 < X.walk0 - 2.5; k++, fx += 9) {
    const f = { x0: fx - 3.5, x1: fx + 3.5, z0: pz + 4.4, z1: pz + 8.4 };
    if (f.z1 > I.z1 - 1.5) break;
    if (Math.min(river.dist(f.x0, f.z0), river.dist(f.x0, f.z1)) < river.hw(f.z1) + 2.2 || f.x0 < river.x(f.z1)) continue;
    if (roads.some(r => r.pts.some(([x, z], i) => i && segHits(r.pts[i - 1][0], r.pts[i - 1][1], x, z, r.w / 2 + 0.6, f)))) continue;
    fields.push(f);
  }

  const L = {
    b, base, lots, entries, X, I, zLobby, zBus, pz, river, bridge: { x: bridgeX, len: bridgeL * 2 }, clear, paths, houses, mts, fields,
    keep: [...houses.map(h => ({ x0: h.x0 - 0.9, x1: h.x0 + h.w + 0.9, z0: h.z0 - 1.1, z1: h.z0 + h.d + 1.1 })),
      ...fields.map(f => ({ x0: f.x0 - 1, x1: f.x1 + 1, z0: f.z0 - 1, z1: f.z1 + 1 }))],
    roads,
  };
  // the connections' footprints: trees and decorations keep out of them, the sidewalk is cut where they meet the street
  L.corr = [];
  for (const r of roads) {
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1], hw = r.w / 2;
      L.corr.push({ x0: Math.min(ax, bx) - hw, x1: Math.max(ax, bx) + hw, z0: Math.min(az, bz) - hw, z1: Math.max(az, bz) + hw });
    }
  }
  L.inRoad = (x, z, pad = 0) => L.corr.some(r => x > r.x0 - pad && x < r.x1 + pad && z > r.z0 - pad && z < r.z1 + pad);
  L.cuts = roads.map(r => { const zc = r.pts[r.pts.length - 1][1]; return [zc - r.w / 2 - 0.4, zc + r.w / 2 + 0.4]; });
  L.inCut = (z, pad = 0) => L.cuts.some(([a, c]) => z > a - pad && z < c + pad);
  L.mts = mts.filter(m => !L.inRoad(m.x, m.z, m.r * 0.9));
  L.pathDist = (x, z) => {
    let d = Infinity;
    for (const pl of paths) for (let i = 0; i < pl.length - 1; i++) d = Math.min(d, segDist(x, z, pl[i][0], pl[i][1], pl[i + 1][0], pl[i + 1][1]));
    return d;
  };
  L.woodAt = (x, z) => {
    const far = smooth(0, 3, leftBank(z) - x);
    const back = smooth(0, 4, b.z0 - 4 - z) * (x < X.walk0 ? 1 : 0.5);
    return Math.max(far, back);
  };
  // would something this tall at (x, z) cover part of the building from the camera? (the view ray drops 0.9 per unit along -x and -z)
  L.hides = (x, z, h, pad = 0.9) => {
    if (x < b.x1 && z < b.z1) return false;
    const k = h / 0.9;
    const t0 = Math.max(0, (x - b.x1 - pad) / k, (z - b.z1 - pad) / k);
    const t1 = Math.min(1, (x - b.x0 + pad) / k, (z - b.z0 + pad) / k);
    return t0 <= t1;
  };
  return L;
}

// ------------------------------------------------------------ ground and the island's cross-section

function buildGround(c) {
  const { L, S, lite } = c, { I, river, b } = L;
  const cell = clamp(Math.sqrt((I.x1 - I.x0) * (I.z1 - I.z0) / (lite ? 8000 : 24000)), 0.45, lite ? 1.6 : 1.1);
  const nx = Math.ceil((I.x1 - I.x0) / cell), nz = Math.ceil((I.z1 - I.z0) / cell);
  const dx = (I.x1 - I.x0) / nx, dz = (I.z1 - I.z0) / nz, W = nx + 1;
  const H = new Float32Array(W * (nz + 1)), E = new Float32Array(W * (nz + 1)), LB = new Float32Array(nz + 1);
  // river distance per vertex (the river's course only depends on z, so it is evaluated once per row)
  for (let j = 0; j <= nz; j++) {
    const z = I.z0 + j * dz, hw = river.hw(z), rx = river.x(z), inv = 1 / Math.sqrt(1 + river.dx(z) ** 2);
    LB[j] = rx - hw - 1.4;
    for (let i = 0; i <= nx; i++) {
      const k = j * W + i;
      const e = z > river.zSrc - 0.5 && hw >= 0.05 ? Math.abs(I.x0 + i * dx - rx) * inv - hw : 1e9;
      E[k] = e;
      H[k] = e < 0.8 ? GY - BED * (1 - smooth(-0.4, 0.8, e)) : GY;
    }
  }
  const base = S.v, col = new THREE.Color();
  const cA = C(PAL.grassA), cB = C(PAL.grassB), cW = C(PAL.grassWood), cS = C(PAL.sand), cSw = C(PAL.sandWet), cBed = C(PAL.bed), cCl = C(PAL.clearing);
  for (let j = 0; j <= nz; j++) {
    const z = I.z0 + j * dz, back = smooth(0, 4, b.z0 - 4 - z);
    for (let i = 0; i <= nx; i++) {
      const x = I.x0 + i * dx, k = j * W + i, h = H[k];
      const hl = H[j * W + Math.max(0, i - 1)], hr = H[j * W + Math.min(nx, i + 1)];
      const hu = H[Math.max(0, j - 1) * W + i], hd = H[Math.min(nz, j + 1) * W + i];
      _v.set(-(hr - hl) / (2 * dx), 1, -(hd - hu) / (2 * dz)).normalize();
      // grass with soft patches, darker in the woods
      col.copy(cA).lerp(cB, vnoise(x * 0.075, z * 0.075, 3));
      const w = Math.max(smooth(0, 3, LB[j] - x), back * (x < L.X.walk0 ? 1 : 0.5));
      if (w > 0) col.lerp(cW, w * 0.8);
      const dc = Math.hypot(x - L.clear.x, z - L.clear.z);
      if (dc < L.clear.r + 0.7) col.lerp(cCl, 1 - smooth(L.clear.r - 0.5, L.clear.r + 0.7, dc));
      // banks: sand above the water line, wet sand and the river bed below it
      const e = E[k];
      if (e < 1.5) {
        col.lerp(cS, 1 - smooth(0.9, 1.5, e));
        const d = GY - h;
        if (d > 0.22) col.copy(cBed);
        else if (d > 0.1) col.lerp(cSw, (d - 0.1) / 0.12);
      }
      col.multiplyScalar(1 + (vnoise(x * 0.33, z * 0.33, 7) - 0.5) * 0.08);
      S.vert(x, h, z, _v.x, _v.y, _v.z, col);
    }
  }
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const a = base + j * W + i, b = a + 1, c2 = a + W, d = c2 + 1;
      S.tri(a, c2, b); S.tri(b, c2, d);
    }
  }
  return { nx, nz, dx, dz, H };
}

// Layered cross-section on the two faces the camera sees (+z: front-left, +x: front-right). The layer lines wave a little;
// they follow the perimeter so the two faces meet at the corner.
function buildSkirt(c, grid) {
  const { L, S, lite } = c, { I } = L, { nx, nz, dx, dz, H } = grid, W = nx + 1;
  const edge = (k, u) => k === STRATA.length - 1 ? GY - BASE_H
    : GY - STRATA[k].d + (vnoise(u * 0.42, k * 3.7 + 11, 5) - 0.5) * 0.3 + Math.sin(u * 0.8 + k * 1.7) * 0.05;
  const col = new THREE.Color();
  const face = (n, pos, top, axis) => {
    for (let k = 0; k < STRATA.length; k++) {
      const up = [], lo = [], u = [];
      for (let i = 0; i < n; i++) {
        const t = pos(i), uu = axis === 'z' ? I.x1 - t : t - I.z1;
        u.push(t);
        const hi = k === 0 ? top(i) : edge(k - 1, uu);
        up.push(Math.min(hi, k === 0 ? hi : top(i)));
        lo.push(Math.min(edge(k, uu), up[i]));
      }
      const base = C(STRATA[k].c);
      for (let i = 0; i < n - 1; i++) {
        if (up[i] - lo[i] < 1e-4 && up[i + 1] - lo[i + 1] < 1e-4) continue;
        const vs = [];
        for (const [ii, y] of [[i, up[i]], [i + 1, up[i + 1]], [i, lo[i]], [i + 1, lo[i + 1]]]) {
          col.copy(base).multiplyScalar(1 + (hash2(Math.round(u[ii] * 3), k, 60) - 0.5) * 0.06);
          vs.push(axis === 'z' ? S.vert(u[ii], y, I.z1, 0, 0, 1, col) : S.vert(I.x1, y, u[ii], 1, 0, 0, col));
        }
        const [A, B, Cc, D] = vs;
        if (axis === 'z') { S.tri(A, Cc, B); S.tri(B, Cc, D); } else { S.tri(A, B, Cc); S.tri(B, D, Cc); }
      }
    }
  };
  face(nx + 1, i => I.x0 + i * dx, i => H[nz * W + i], 'z');
  face(nz + 1, j => I.z0 + j * dz, j => H[j * W + nx], 'x');
  if (lite) return;
  // stones in the lower layers
  for (let x = Math.ceil(I.x0) + 1; x < I.x1 - 0.5; x += 2.3) {
    const r = hash2(Math.round(x * 3), 1, 61);
    if (r < 0.45) S.put(G.rock, x, GY - 1.3 - r * 3.2, I.z1, 0.5 + r, 0.36 + r * 0.5, 0.3, ROCKS[Math.round(r * 9) % 3], r * 5);
  }
  for (let z = Math.ceil(I.z0) + 1; z < I.z1 - 0.5; z += 2.3) {
    const r = hash2(Math.round(z * 3), 2, 62);
    if (r < 0.45) S.put(G.rock, I.x1, GY - 1.3 - r * 3.2, z, 0.3, 0.36 + r * 0.5, 0.5 + r, ROCKS[Math.round(r * 9) % 3], r * 5);
  }
}

// ------------------------------------------------------------ street

function lamp(c, x, z, dir) {
  const { S, LT } = c, top = WALK_Y + 3.05;
  S.put(G.cyl, x, WALK_Y + 0.1, z, 0.3, 0.2, 0.3, PAL.poleBase);
  S.put(G.cyl, x, WALK_Y + 1.55, z, 0.11, 3.0, 0.11, PAL.pole);
  S.box(x + dir * 0.45, top, z, 0.9, 0.07, 0.07, PAL.pole);
  S.box(x + dir * 0.95, top - 0.02, z, 0.58, 0.13, 0.32, PAL.lampHead);
  LT.box(x + dir * 0.95, top - 0.1, z, 0.46, 0.05, 0.24, PAL.bulb);
  c.glows.push(x + dir * 0.95, top - 0.22, z);
  c.pools.push([x + dir * 0.95, z, 4.6]);
}

function parkLamp(c, x, z, y = GY) {
  const { S, LT } = c;
  S.put(G.cyl, x, y + 0.08, z, 0.24, 0.16, 0.24, PAL.poleBase);
  S.put(G.cyl, x, y + 1.05, z, 0.08, 2.0, 0.08, PAL.pole);
  S.put(G.cyl, x, y + 2.08, z, 0.2, 0.06, 0.2, PAL.lampHead);
  LT.put(G.ico, x, y + 2.3, z, 0.36, 0.38, 0.36, PAL.bulb);
  S.put(G.cone, x, y + 2.55, z, 0.34, 0.14, 0.34, PAL.lampHead);
  c.glows.push(x, y + 2.3, z);
  c.pools.push([x, z, 3.4]);
}

function bench(c, x, z, ry) {
  const F = local(c.S, x, GY, z, ry);
  for (const lz of [-0.12, 0.02, 0.16]) F.box(0, 0.46, lz, 1.5, 0.05, 0.12, PAL.wood);
  F.box(0, 0.7, -0.25, 1.5, 0.1, 0.05, PAL.wood, -0.2);
  F.box(0, 0.86, -0.28, 1.5, 0.1, 0.05, PAL.wood, -0.2);
  for (const lx of [-0.6, 0.6]) {
    F.box(lx, 0.22, 0.02, 0.07, 0.44, 0.4, PAL.iron);
    F.box(lx, 0.62, -0.27, 0.07, 0.56, 0.06, PAL.iron, -0.2);
  }
  blob(c, x, z, 0.55, 0.8, GY + 0.02, 1.9, 0.9);
}

function bin(c, x, z, y = GY) {
  c.S.put(G.cyl, x, y + 0.37, z, 0.44, 0.74, 0.44, '#4b7f5a');
  c.S.put(G.cyl, x, y + 0.77, z, 0.5, 0.07, 0.5, PAL.iron);
  c.S.put(G.cyl, x, y + 0.5, z, 0.46, 0.06, 0.46, '#3f6b4b');
}

function hydrant(c, x, z) {
  const S = c.S;
  S.put(G.cyl, x, WALK_Y + 0.25, z, 0.22, 0.5, 0.22, '#d64541');
  S.put(G.ico, x, WALK_Y + 0.52, z, 0.24, 0.18, 0.24, '#d64541');
  S.put(G.cyl, x, WALK_Y + 0.33, z, 0.1, 0.36, 0.1, '#b8322f', 0, 0, Math.PI / 2);
  S.put(G.cyl, x, WALK_Y + 0.04, z, 0.3, 0.06, 0.3, '#b8322f');
}

// road signs face +z (toward the camera)
function roadSign(c, x, z, kind) {
  const S = c.S, y = WALK_Y, top = y + 2.25;
  S.put(G.cyl, x, y + 1.1, z, 0.07, 2.2, 0.07, '#8a919c');
  const F = local(S, x, 0, z + 0.05, 0);
  if (kind === 'cross') {
    F.box(0, top, 0, 0.58, 0.58, 0.04, '#2f6fc0');
    F.put(G.prism3, 0, top - 0.02, 0.03, 0.44, 0.02, 0.44, '#ffffff', -Math.PI / 2);
    F.box(0, top - 0.06, 0.045, 0.06, 0.16, 0.01, '#23252d');
  } else if (kind === 'speed') {
    F.put(G.disc, 0, top, 0, 0.62, 0.04, 0.62, '#d64541', Math.PI / 2);
    F.put(G.disc, 0, top, 0.025, 0.46, 0.02, 0.46, '#ffffff', Math.PI / 2);
    F.box(-0.07, top, 0.04, 0.08, 0.2, 0.01, '#23252d');
    F.box(0.07, top, 0.04, 0.08, 0.2, 0.01, '#23252d');
  } else {
    F.put(G.prism3, 0, top, 0, 0.74, 0.04, 0.74, '#d64541', -Math.PI / 2);
    F.put(G.prism3, 0, top - 0.02, 0.025, 0.5, 0.02, 0.5, '#ffffff', -Math.PI / 2);
    F.box(0, top - 0.04, 0.04, 0.05, 0.14, 0.01, '#23252d');
  }
}

// a cute toy car in its local frame (front toward +z)
function carParts(M, x, y, z, ry, body) {
  const F = local(M, x, y, z, ry);
  F.put(rounded(1.56, 0.56, 3.1, 0.16), 0, 0.5, 0, 1, 1, 1, body);
  F.put(rounded(1.36, 0.5, 1.7, 0.14), 0, 0.96, -0.2, 1, 1, 1, PAL.glass);
  F.put(rounded(1.3, 0.09, 1.52, 0.04), 0, 1.22, -0.2, 1, 1, 1, body);
  for (const [lx, lz] of [[-0.72, 0.98], [0.72, 0.98], [-0.72, -1.02], [0.72, -1.02]]) {
    F.put(G.disc, lx, 0.3, lz, 0.58, 0.24, 0.58, PAL.tire, 0, Math.PI / 2);
    F.put(G.cyl, lx + Math.sign(lx) * 0.125, 0.3, lz, 0.28, 0.02, 0.28, PAL.hub, 0, Math.PI / 2);
  }
  for (const s of [-1, 1]) {
    F.box(s * 0.5, 0.58, 1.54, 0.3, 0.13, 0.05, PAL.headlight);
    F.box(s * 0.52, 0.62, -1.54, 0.26, 0.11, 0.05, PAL.tail);
  }
  F.box(0, 0.3, 1.56, 1.3, 0.1, 0.06, '#3a3f4a');
  F.box(0, 0.3, -1.56, 1.3, 0.1, 0.06, '#3a3f4a');
}

function busStop(c, x0, z) {
  const { S, LT } = c, y = WALK_Y, x1 = x0 + 1.5;
  for (const zz of [z - 1.35, z + 1.35]) {
    S.box(x1 - 0.1, y + 1.1, zz, 0.08, 2.2, 0.08, PAL.pole);
    S.box(x0 + 0.1, y + 1.1, zz, 0.06, 2.2, 0.06, PAL.pole);
  }
  S.box((x0 + x1) / 2, y + 2.26, z, 1.72, 0.1, 3.0, '#3b6fa8');
  S.box((x0 + x1) / 2, y + 2.2, z, 1.66, 0.04, 2.9, '#dfe7ee');
  S.box(x1 - 0.12, y + 1.3, z, 0.04, 1.5, 2.6, '#cfe5ee');          // back glass
  S.box(x1 - 0.1, y + 0.55, z, 0.07, 0.07, 2.62, PAL.pole);
  LT.box((x0 + x1) / 2, y + 1.25, z - 1.35, 1.0, 1.35, 0.05, '#f0a25a');   // lit poster at the side
  S.box((x0 + x1) / 2, y + 1.25, z - 1.38, 1.1, 1.45, 0.03, PAL.pole);
  S.box(x1 - 0.5, y + 0.46, z + 0.15, 0.42, 0.06, 1.9, PAL.wood);
  S.box(x1 - 0.5, y + 0.22, z - 0.6, 0.36, 0.44, 0.06, PAL.iron);
  S.box(x1 - 0.5, y + 0.22, z + 0.9, 0.36, 0.44, 0.06, PAL.iron);
  // the stop sign by the curb
  S.put(G.cyl, x0 - 0.05, y + 1.2, z + 1.9, 0.08, 2.4, 0.08, '#8a919c');
  const F = local(S, x0 - 0.05, 0, z + 1.95, 0);
  F.put(G.disc, 0, y + 2.3, 0, 0.62, 0.05, 0.62, '#2e9c62', Math.PI / 2);
  F.box(0, y + 2.3, 0.03, 0.28, 0.2, 0.01, '#ffffff');
  F.box(0, y + 2.25, 0.04, 0.2, 0.06, 0.01, '#2e9c62');
  blob(c, (x0 + x1) / 2, z, 1.0, 2.2, WALK_Y + 0.01, 3.2, 1.8);
}

function buildStreet(c) {
  const { L, S } = c, { I, X, base, lots } = L;
  const z0 = I.z0 - 0.01, z1 = I.z1 + 0.012, zz = L.zLobby, zb = L.zBus;
  // the near sidewalk is cut where a connection from a lot meets the street
  const walks = [];
  let from = z0;
  for (const [a, b2] of [...L.cuts].sort((p, q) => p[0] - q[0])) { if (a > from) walks.push([from, a]); from = Math.max(from, b2); }
  if (from < z1) walks.push([from, z1]);
  for (const [a, b2] of walks) {
    S.slab(X.walk0, X.road0, a, b2, WALK_Y, SUB, PAL.walk);
    S.slab(X.road0 - 0.18, X.road0, a, b2, WALK_Y + 0.005, WALK_Y - 0.02, PAL.curb);
  }
  S.slab(X.road0, X.road1, z0, z1, ROAD_Y, SUB, PAL.asphalt);
  S.slab(X.road1, X.walk1, z0, z1, WALK_Y, SUB, PAL.walk);
  S.slab(X.road1, X.road1 + 0.18, z0, z1, WALK_Y + 0.005, WALK_Y - 0.02, PAL.curb);
  for (let z = Math.ceil(I.z0 / 1.6) * 1.6; z < I.z1; z += 1.6) {
    if (!L.inCut(z, 0.05)) S.slab(X.walk0, X.road0 - 0.18, z - 0.02, z + 0.02, WALK_Y + 0.003, WALK_Y - 0.01, PAL.joint);
    S.slab(X.road1 + 0.18, X.walk1, z - 0.02, z + 0.02, WALK_Y + 0.003, WALK_Y - 0.01, PAL.joint);
  }
  // markings
  const paint = (x0, x1, za, zc, color = PAL.paint) => S.slab(x0, x1, za, zc, ROAD_Y + 0.004, ROAD_Y - 0.004, color);
  for (let z = Math.ceil(I.z0 / 3) * 3; z < I.z1 - 1.4; z += 3) if (Math.abs(z + 0.7 - zz) > 2.3) paint(X.mid - 0.07, X.mid + 0.07, z, z + 1.4);
  const spans = [[I.z0, zz - 1.5], [zz + 1.5, I.z1]];
  for (const [a, b2] of spans) if (b2 - a > 0.3) paint(X.park - 0.05, X.park + 0.05, a, b2);
  for (let z = Math.ceil(I.z0 / 5.4) * 5.4; z < I.z1; z += 5.4) {
    if (Math.abs(z - zz) > 1.6 && Math.abs(z - zb) > 3.2) paint(X.park, X.road1 - 0.15, z - 0.05, z + 0.05);
  }
  for (let x = X.road0 + 0.45; x < X.road1 - 0.4; x += 0.95) paint(x, x + 0.5, zz - 1.3, zz + 1.3, '#f6f5ef');
  // bus bay: a yellow frame in the parking lane
  paint(X.park + 0.1, X.road1 - 0.2, zb - 3.0, zb - 2.9, PAL.paintY);
  paint(X.park + 0.1, X.road1 - 0.2, zb + 2.9, zb + 3.0, PAL.paintY);
  paint(X.park + 0.1, X.park + 0.2, zb - 3.0, zb + 3.0, PAL.paintY);

  // paved walks from the building's entrances to the sidewalk, unless a lot is in the way
  for (const ze of L.entries) {
    const lobby = ze === L.entries[L.entries.length - 1], half = lobby ? 1.35 : 0.95;
    if (ze - half < I.z0 + 1 || ze + half > I.z1 - 1) continue;
    if (lots.some(l => l.x1 > base.x1 + 0.1 && l.x0 < X.walk0 && l.z1 > ze - half && l.z0 < ze + half)) continue;
    S.slab(base.x1 - 0.05, X.walk0 + 0.02, ze - half, ze + half, WALK_Y, SUB, PAL.walk);
    if (!lobby) continue;
    for (const s of [-1, 1]) {
      const pz = ze + s * (half + 0.5);
      if (lots.some(l => l.x1 > X.walk0 - 1 && l.x0 < X.walk0 && l.z1 > pz - 0.5 && l.z0 < pz + 0.5) || L.inRoad(X.walk0 - 0.55, pz, 0.4)) continue;
      S.put(G.disc, X.walk0 - 0.55, GY + 0.2, pz, 0.62, 0.4, 0.62, '#d9d2c4');
      S.put(G.ico, X.walk0 - 0.55, GY + 0.62, pz, 0.72, 0.62, 0.72, PAL.leaf, pz);
      S.put(G.ico, X.walk0 - 0.6, GY + 0.9, pz + 0.05, 0.46, 0.42, 0.46, PAL.leaf2, pz * 2);
    }
  }
  // lamps on both sidewalks, their arms over the road
  for (let k = Math.ceil((I.z0 + 2.5) / 9); k * 9 < I.z1 - 2; k++) {
    const z = k * 9;
    if (!L.entries.some(e => Math.abs(e - z) < 1.9) && Math.abs(z - zz) > 2.2 && !L.inCut(z, 0.9)) lamp(c, X.road0 - 0.42, z, 1);
    const z2 = z + 4.5;
    if (z2 < I.z1 - 2 && Math.abs(z2 - zb) > 2.4 && Math.abs(z2 - zz) > 2.2) lamp(c, X.road1 + 0.42, z2, -1);
  }
  // parked cars
  let n = 0;
  for (let k = Math.ceil((I.z0 + 3) / 5.4); (k + 0.5) * 5.4 < I.z1 - 3 && n < 5; k++) {
    const zc = (k + 0.5) * 5.4;
    if (Math.abs(zc - zz) < 3.6 || Math.abs(zc - zb) < 4.4 || hash2(k, 0, 31) > 0.55) continue;
    const col = CAR_COLORS[Math.floor(hash2(k, 1, 32) * CAR_COLORS.length)];
    carParts(S, X.park + 1.0, ROAD_Y, zc, hash2(k, 2, 33) < 0.5 ? 0 : Math.PI, col);
    blob(c, X.park + 1.0, zc, 0.95, 1.2, ROAD_Y + 0.01, 1.9, 3.4);
    n++;
  }
  busStop(c, X.road1 + 0.35, zb);
  bin(c, X.road1 + 0.55, zb + 2.6, WALK_Y);
  if (!L.inCut(zz + 1.75, 0.5)) roadSign(c, X.road0 - 0.45, zz + 1.75, 'cross');
  roadSign(c, X.road1 + 0.45, zz - 1.75, 'cross');
  if (I.z1 - 6 > zz + 4 && !L.inCut(I.z1 - 5.5, 0.5)) roadSign(c, X.road0 - 0.45, I.z1 - 5.5, 'speed');
  if (zz - 7 > I.z0 + 4) roadSign(c, X.road1 + 0.45, I.z0 + 6.5, 'warn');
  if (zz + 6 < I.z1 - 2 && !L.inCut(zz + 6.2, 0.5)) hydrant(c, X.walk0 + 0.4, zz + 6.2);
  if (!L.inCut(zz - 2.1, 0.5)) bin(c, X.walk0 + 0.4, zz - 2.1, WALK_Y);
}

// Roads from the lots to the street (connectRoad): asphalt at grass level, raised over the lot's own plinth with a short
// ramp down from it, a stop line before the sidewalk and a zebra crossing where the sidewalk is cut.
function buildRoads(c) {
  const { L, S } = c, { X } = L, top = GY + 0.02, low = GY - 0.25;
  for (const r of L.roads) {
    const pts = r.pts, hw = r.w / 2, n = pts.length;
    const own = [L.base, ...L.lots].find(q => pts[0][0] >= q.x0 - 0.3 && pts[0][0] <= q.x1 + 0.3 && pts[0][1] >= q.z0 - 0.3 && pts[0][1] <= q.z1 + 0.3);
    for (let i = 0; i < n - 1; i++) {
      let [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const last = i === n - 2;
      if (last) bx = X.road0 + 0.01;                          // the street's own asphalt takes over at the curb
      const horiz = Math.abs(az - bz) < 1e-6, dir = horiz ? Math.sign(bx - ax) || 1 : Math.sign(bz - az) || 1;
      // extend past the bends so the corners are filled
      const e0 = i === 0 ? 0 : hw, e1 = last ? 0 : hw;
      let s0 = (horiz ? ax : az) - dir * e0;
      const s1 = (horiz ? bx : bz) + dir * e1;
      if (i === 0 && own) {
        // inside the lot's plinth: level with it, then a ramp down to the grass
        const edge = horiz ? (dir > 0 ? own.x1 : own.x0) : (dir > 0 ? own.z1 : own.z0);
        const inner = Math.max(0, (edge - s0) * dir), ramp = 1.2, drop = 0.006 - top;
        if (inner > 0.01 && inner < Math.abs(s1 - s0)) {
          const e = s0 + dir * inner;
          if (horiz) S.slab(Math.min(s0, e), Math.max(s0, e), az - hw, az + hw, 0.006, -0.05, PAL.asphalt);
          else S.slab(ax - hw, ax + hw, Math.min(s0, e), Math.max(s0, e), 0.006, -0.05, PAL.asphalt);
          s0 = e;
        }
        if (Math.abs(s1 - s0) > ramp + 0.2) {
          const a = Math.atan2(drop, ramp), mid = s0 + dir * ramp / 2, len = Math.hypot(ramp, drop) + 0.02, y = (0.006 + top) / 2 - 0.03;
          if (horiz) S.put(G.box, mid, y, az, len, 0.06, r.w, PAL.asphalt, 0, 0, -dir * a);
          else S.put(G.box, ax, y, mid, r.w, 0.06, len, PAL.asphalt, 0, dir * a, 0);
          s0 += dir * ramp;
        }
      }
      if (horiz) S.slab(Math.min(s0, s1), Math.max(s0, s1), az - hw, az + hw, top, low, PAL.asphalt);
      else S.slab(ax - hw, ax + hw, Math.min(s0, s1), Math.max(s0, s1), top, low, PAL.asphalt);
      // a dashed center line on wide connections
      if (r.w >= 4.4) {
        const lo = Math.min(s0, s1) + 0.6, hi = Math.max(s0, s1) - 0.6;
        for (let t = lo; t + 1.0 < hi; t += 2.4) {
          if (horiz) S.slab(t, t + 1.0, az - 0.06, az + 0.06, top + 0.004, top - 0.004, PAL.paint);
          else S.slab(ax - 0.06, ax + 0.06, t, t + 1.0, top + 0.004, top - 0.004, PAL.paint);
        }
      }
    }
    // stop line and a zebra crossing on the cut sidewalk (the last leg runs along +x into the street)
    const zc = pts[n - 1][1];
    S.slab(X.walk0 - 0.55, X.walk0 - 0.35, zc - 0.02, zc + hw - 0.15, top + 0.004, top - 0.004, PAL.paint);   // eastbound half (right-hand traffic)
    for (let z = zc - hw + 0.3; z + 0.4 <= zc + hw - 0.2; z += 0.85) S.slab(X.walk0 + 0.15, X.road0 - 0.15, z, z + 0.45, top + 0.004, top - 0.004, '#f6f5ef');
  }
}

// a little house across the street; the door faces the street (-x), the camera sees its gable end and back
function house(c, h) {
  const { S, LT } = c, { x0, z0, w, d } = h, y0 = GY, H = 2.3, rise = 1.35, over = 0.3;
  const cx = x0 + w / 2, R = rng(h.seed);
  S.slab(x0 - 0.1, x0 + w + 0.1, z0 - 0.1, z0 + d + 0.1, y0 + 0.2, y0 - 0.05, '#b9b3a8');
  S.slab(x0, x0 + w, z0, z0 + d, y0 + H, y0 + 0.18, h.wall);
  const a = Math.atan2(rise, w / 2), half = w / 2 + over, len = half / Math.cos(a);
  for (const s of [-1, 1]) {
    const ex = cx + s * half, ey = y0 + H + rise - half * Math.tan(a);
    S.put(G.box, (cx + ex) / 2, (y0 + H + rise + ey) / 2 + 0.05, z0 + d / 2, len + 0.06, 0.12, d + 2 * over, h.roof, 0, 0, -s * a);
  }
  for (const [zf, oz] of [[z0 + d, 1], [z0, -1]]) {
    _out.set(0, 0, oz);
    S.ftri([x0, y0 + H, zf], [x0 + w, y0 + H, zf], [cx, y0 + H + rise, zf], h.wall, _out);
  }
  S.box(cx + w * 0.22, y0 + H + rise * 0.72, z0 + d * 0.3, 0.42, 1.1, 0.42, '#a0584a');
  // windows: glass is in the lit mesh (it glows at night), frames in the static one
  const win = (x, y, z, ww, hh, axis) => {
    if (axis === 'z') { S.box(x, y, z, ww + 0.14, hh + 0.14, 0.04, PAL.frame); LT.box(x, y, z + 0.022, ww, hh, 0.02, PAL.window); S.box(x, y - hh / 2 - 0.08, z + 0.05, ww + 0.2, 0.06, 0.12, PAL.frame); }
    else { S.box(x, y, z, 0.04, hh + 0.14, ww + 0.14, PAL.frame); LT.box(x + 0.022, y, z, 0.02, hh, ww, PAL.window); S.box(x + 0.05, y - hh / 2 - 0.08, z, 0.12, 0.06, ww + 0.2, PAL.frame); }
  };
  win(cx - w * 0.24, y0 + 1.35, z0 + d + 0.02, 0.62, 0.72, 'z');
  win(cx + w * 0.24, y0 + 1.35, z0 + d + 0.02, 0.62, 0.72, 'z');
  win(cx, y0 + H + 0.5, z0 + d + 0.02, 0.4, 0.4, 'z');
  win(x0 + w + 0.02, y0 + 1.35, z0 + d * 0.27, 0.66, 0.72, 'x');
  win(x0 + w + 0.02, y0 + 1.35, z0 + d * 0.73, 0.66, 0.72, 'x');
  // flower box under the front windows
  for (const s of [-1, 1]) {
    const fx = cx + s * w * 0.24, fz = z0 + d + 0.16;
    S.box(fx, y0 + 0.86, fz, 0.7, 0.16, 0.2, PAL.woodDark);
    for (let i = 0; i < 4; i++) S.put(G.gem, fx - 0.24 + i * 0.16, y0 + 1.0, fz, 0.13, 0.13, 0.13, FLOWERS[(R() * FLOWERS.length) | 0], R());
  }
  // door and step toward the street
  S.box(x0 - 0.03, y0 + 0.95, z0 + d / 2, 0.06, 1.5, 0.8, h.roof);
  S.box(x0 - 0.35, y0 + 0.1, z0 + d / 2, 0.6, 0.2, 1.1, '#c9c3b8');
  LT.box(x0 - 0.1, y0 + 1.95, z0 + d / 2 + 0.6, 0.12, 0.16, 0.12, PAL.bulb);
  // a paved walk to the sidewalk
  S.slab(c.L.X.walk1 - 0.02, x0 - 0.05, z0 + d / 2 - 0.45, z0 + d / 2 + 0.45, WALK_Y - 0.02, GY - 0.05, PAL.walk);
}

// ------------------------------------------------------------ nature

function mountain(S, m) {
  const R = rng(m.seed), segs = 10 + ((R() * 4) | 0), K = 5, rot = R() * 6.28;
  const rings = [];
  for (let k = 0; k < K; k++) {
    const t = k / K, ring = [];
    for (let s = 0; s < segs; s++) {
      const a = (s / segs) * Math.PI * 2 + (R() - 0.5) * 0.4 + rot;
      const rr = m.r * (1 - t) * (0.84 + R() * 0.28);
      const y = k === 0 ? GY - 0.25 : GY + m.h * Math.pow(t, m.p) * (0.86 + R() * 0.24);
      ring.push([m.x + Math.cos(a) * rr, y, m.z + Math.sin(a) * rr]);
    }
    rings.push(ring);
  }
  const peak = [m.x + (R() - 0.5) * m.r * 0.16, GY + m.h, m.z + (R() - 0.5) * m.r * 0.16];
  const rockA = R() < 0.5 ? '#a1978d' : '#978f8f', rockB = R() < 0.5 ? '#8d8683' : '#a49a8f';
  const snowLine = 0.6 + R() * 0.08, rockLine = m.h < 4 ? 9 : 0.28 + R() * 0.1;
  const tri = (a, b, c) => {
    const q = ((a[1] + b[1] + c[1]) / 3 - GY) / m.h, j = R();
    const col = m.snow && q > snowLine - j * 0.05 ? (j < 0.5 ? '#f4f6f9' : '#e7ecf3')
      : q > rockLine + (j - 0.5) * 0.08 ? (j < 0.5 ? rockA : rockB)
        : (j < 0.5 ? '#72ae59' : '#7fb862');
    _out.set((a[0] + b[0] + c[0]) / 3 - m.x, m.r * 0.4, (a[2] + b[2] + c[2]) / 3 - m.z);
    S.ftri(a, b, c, col, _out);
  };
  for (let k = 0; k < K - 1; k++) {
    for (let s = 0; s < segs; s++) {
      const a = rings[k][s], b = rings[k][(s + 1) % segs], c = rings[k + 1][(s + 1) % segs], d = rings[k + 1][s];
      tri(a, b, c); tri(a, c, d);
    }
  }
  for (let s = 0; s < segs; s++) tri(rings[K - 1][s], rings[K - 1][(s + 1) % segs], peak);
}

function rock(c, x, z, s, seed, y = GY) {
  const r = hash2(seed, 3, 70);
  c.S.put(G.rock, x, y + s * 0.18, z, s, s * (0.55 + r * 0.25), s * (0.8 + r * 0.3), ROCKS[((seed % 3) + 3) % 3], r * 6, (r - 0.5) * 0.3);
}

function flowerBed(c, x, z, rx, rz, seed) {
  const S = c.S, R = rng(seed);
  S.put(G.disc, x, GY + 0.05, z, rx * 2 + 0.18, 0.1, rz * 2 + 0.18, '#b9ad99');
  S.put(G.disc, x, GY + 0.07, z, rx * 2, 0.1, rz * 2, '#6d4c34');
  const n = Math.max(4, Math.round(rx * rz * (c.lite ? 5 : 11)));
  for (let i = 0; i < n; i++) {
    const a = R() * Math.PI * 2, r = Math.sqrt(R()) * 0.82;
    const fx = x + Math.cos(a) * rx * r, fz = z + Math.sin(a) * rz * r;
    S.put(G.ico, fx, GY + 0.17, fz, 0.26, 0.2, 0.26, R() < 0.5 ? PAL.leaf : PAL.leaf2, R() * 3);
    S.put(G.gem, fx + (R() - 0.5) * 0.08, GY + 0.31, fz, 0.16, 0.15, 0.16, FLOWERS[(R() * FLOWERS.length) | 0], R() * 3);
  }
}

function wildFlowers(c, x, z, seed) {
  const R = rng(seed), n = 5 + ((R() * 5) | 0), col = FLOWERS[(R() * FLOWERS.length) | 0], col2 = FLOWERS[(R() * FLOWERS.length) | 0];
  for (let i = 0; i < n; i++) {
    const a = R() * Math.PI * 2, r = Math.sqrt(R()) * 0.7;
    c.S.put(G.gem, x + Math.cos(a) * r, GY + 0.06, z + Math.sin(a) * r, 0.13, 0.12, 0.13, R() < 0.7 ? col : col2, R() * 3);
  }
}

function picnicTable(c, x, z) {
  const F = local(c.S, x, GY, z, 0.35);
  F.box(0, 0.72, 0, 1.7, 0.07, 0.8, PAL.wood);
  for (const s of [-1, 1]) {
    F.box(0, 0.42, s * 0.68, 1.7, 0.06, 0.32, PAL.wood);
    F.box(s * 0.62, 0.36, 0, 0.08, 0.72, 1.7, PAL.woodDark, 0, s * 0.18);
  }
  blob(c, x, z, 1.1, 0.8, GY + 0.02, 2.4, 2.0);
}

function bridge(c, xc, z, len, wid) {
  const S = c.S, n = Math.max(10, Math.round(len / 0.3)), rise = 0.42, pw = len / n;
  const yAt = t => PATH_Y + 0.05 + rise * Math.sin(Math.PI * t);
  const slope = t => rise * Math.PI * Math.cos(Math.PI * t) / len;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n, x = xc - len / 2 + t * len, a = Math.atan(slope(t)), y = yAt(t);
    S.put(G.box, x, y, z, pw / Math.cos(a) + 0.02, 0.08, wid, i % 2 ? PAL.plank : PAL.plank2, 0, 0, a);
    for (const s of [-1, 1]) S.put(G.box, x, y - 0.1, z + s * (wid / 2 - 0.1), pw / Math.cos(a) + 0.02, 0.14, 0.1, PAL.woodDark, 0, 0, a);
  }
  const np = Math.max(3, Math.round(len / 0.95));
  for (const s of [-1, 1]) {
    const zr = z + s * (wid / 2 - 0.05);
    let px = 0, py = 0;
    for (let i = 0; i <= np; i++) {
      const t = i / np, x = xc - len / 2 + t * len, y = yAt(t);
      S.box(x, y + 0.42, zr, 0.09, 0.8, 0.09, PAL.woodDark);
      if (i) {
        const a = Math.atan2(y - py, x - px), l = Math.hypot(x - px, y - py);
        S.put(G.box, (x + px) / 2, (y + py) / 2 + 0.78, zr, l + 0.06, 0.07, 0.08, PAL.wood, 0, 0, a);
        S.put(G.box, (x + px) / 2, (y + py) / 2 + 0.46, zr, l, 0.05, 0.05, PAL.wood, 0, 0, a);
      }
      px = x; py = y;
    }
  }
  for (const s of [-1, 1]) S.slab(xc + s * len / 2 - 0.3, xc + s * len / 2 + 0.3, z - wid / 2 - 0.1, z + wid / 2 + 0.1, PATH_Y + 0.02, GY - 0.3, PAL.stone);
}

function pathStrip(S, pts, w, color, y) {
  const k = C(color);
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz) || 1, nx = -dz / l * w / 2, nz = dx / l * w / 2;
    const a = S.vert(ax + nx, y, az + nz, 0, 1, 0, k), b = S.vert(ax - nx, y, az - nz, 0, 1, 0, k);
    const d = S.vert(bx + nx, y, bz + nz, 0, 1, 0, k), e = S.vert(bx - nx, y, bz - nz, 0, 1, 0, k);
    S.tri(a, d, b); S.tri(b, d, e);
  }
  for (const [x, z] of pts) S.put(G.disc, x, y - 0.006, z, w, 0.008, w, color);
}

function buildPark(c) {
  const { L, S } = c, { b, I, X, river, pz } = L;
  for (const pl of L.paths) { pathStrip(S, pl, 1.5, PAL.dirtEdge, PATH_Y - 0.003); pathStrip(S, pl, 1.3, PAL.dirt, PATH_Y); }
  bridge(c, L.bridge.x, pz, L.bridge.len, 1.5);
  // front lawn: flower beds, benches and park lamps in a tidy row along the path
  const zl = pz - 1.35, x1 = X.walk0 - 2.2, x0 = Math.max(b.x0 + 0.8, L.bridge.x + L.bridge.len / 2 + 1.2);
  let i = 0;
  for (let x = x1; x > x0; x -= 3.4, i++) {
    const kind = i % 4;
    if (L.inRoad(x, zl, 1.4)) continue;
    if (kind === 0 || kind === 2) flowerBed(c, x, zl, 1.05, 0.4, Math.round(x * 17));
    else if (kind === 1) { bench(c, x, zl + 0.05, 0); bin(c, x + 1.05, zl + 0.15); }
    else parkLamp(c, x, zl + 0.1);
  }
  // tulip fields: rows of one color each on dark soil, with a low wooden edge
  const TULIPS = ['#e8735a', '#f2c14e', '#f29fb5', '#9d7fd8', '#ffffff'];
  L.fields.forEach((f, k) => {
    S.slab(f.x0 - 0.12, f.x1 + 0.12, f.z0 - 0.12, f.z1 + 0.12, GY + 0.06, GY - 0.05, PAL.woodDark);
    S.slab(f.x0, f.x1, f.z0, f.z1, GY + 0.07, GY - 0.05, '#86603f');
    const rows = Math.max(3, Math.floor((f.z1 - f.z0) / 0.8));
    for (let i = 0; i < rows; i++) {
      const z = f.z0 + (i + 0.5) * (f.z1 - f.z0) / rows, col = TULIPS[(i + k * 2) % TULIPS.length];
      S.slab(f.x0 + 0.15, f.x1 - 0.15, z - 0.26, z + 0.26, GY + 0.14, GY + 0.05, PAL.leaf);
      for (const dz of c.lite ? [0] : [-0.13, 0.13]) {
        for (let x = f.x0 + 0.3 + (dz > 0 ? 0.13 : 0); x < f.x1 - 0.25; x += c.lite ? 0.5 : 0.26) {
          S.put(G.gem, x, GY + 0.26, z + dz, 0.24, 0.26, 0.24, col, x * 3);
        }
      }
    }
  });
  // across the bridge: a picnic clearing
  picnicTable(c, L.clear.x, L.clear.z);
  parkLamp(c, L.clear.x + 1.6, L.clear.z + 1.3);
  // lily pads on the pond
  for (let z = river.zSrc + 3; z < I.z1 - 1.2; z += 0.9) {
    const hw = river.hw(z);
    if (hw < 2.2) continue;
    const r = hash2(Math.round(z * 10), 1, 80);
    if (r > 0.5) continue;
    const off = (hash2(Math.round(z * 10), 2, 81) - 0.5) * 2 * (hw - 0.8), s = 0.42 + r * 0.4;
    S.put(G.disc, river.x(z) + off, WATER_Y + 0.012, z, s, 0.01, s, PAL.lily);
    if (r < 0.12) S.put(G.gem, river.x(z) + off, WATER_Y + 0.07, z, 0.16, 0.14, 0.16, '#f29fb5');
  }
  // rocks: river banks, the waterfall's lip, mountain feet
  for (let z = river.zSrc + 3; z < I.z1 - 0.5; z += 2.6) {
    const r = hash2(Math.round(z * 5), 3, 82);
    if (r > 0.5 || Math.abs(z - pz) < 1.6) continue;
    const s = r < 0.25 ? 1 : -1, off = river.hw(z) + 0.55 + r;
    rock(c, river.x(z) + s * off, z, 0.45 + r * 0.7, Math.round(z * 5));
  }
  const ze = I.z1 - 0.45, xe = river.x(ze), he = river.hw(ze);
  rock(c, xe - he - 0.6, ze, 0.95, 5);
  rock(c, xe + he + 0.55, ze - 0.2, 0.75, 7);
  rock(c, xe + he + 1.3, ze - 0.6, 0.45, 8);
  for (const m of L.mts) {
    if (m.h < 3) continue;
    for (let k = 0; k < 2; k++) {
      const a = Math.PI * 0.25 + (hash2(m.seed, k, 83) - 0.5) * 2.2, rr = m.r * 0.98;
      const x = m.x + Math.cos(a) * rr, z = m.z + Math.sin(a) * rr;
      const ok = x > I.x0 + 0.6 && x < I.x1 - 0.6 && z > I.z0 + 0.6 && z < I.z1 - 0.6 && !(x > X.walk0 - 1 && x < X.walk1 + 1) &&
        !(x > b.x0 - 1.5 && x < b.x1 + 1 && z > b.z0 - 1.5 && z < b.z1 + 1) && (z < river.zSrc || river.dist(x, z) > river.hw(z) + 0.9) && !L.inRoad(x, z, 0.8);
      if (ok) rock(c, x, z, 0.5 + hash2(m.seed, k, 84) * 0.6, (m.seed + k) & 0xffff);
    }
  }
}

// ------------------------------------------------------------ trees (instanced) and blob shadows

function blob(c, x, z, r, h, y = GY + 0.02, sx = 0, sz = 0) {
  const d = c.sunDir, off = h * 0.28;
  c.blobs.push({ x: x + d.x * off, y, z: z + d.y * off, sx: sx || r * 2.3, sz: sz || r * 2.3 + h * 0.5, ry: sx ? 0 : Math.atan2(d.x, d.y) });
}

function treeZone(L, x, z) {
  const { b, I, X, river } = L;
  if (x < I.x0 + 0.9 || x > I.x1 - 0.9 || z < I.z0 + 0.9 || z > I.z1 - 0.9) return null;
  if (x > b.x0 - 1.8 && x < b.x1 + 1.0 && z > b.z0 - 1.8 && z < b.z1 + 1.0) return null;
  if (x > X.walk0 - 0.7 && x < X.walk1 + 0.7) return null;
  const hw = river.hw(z);
  if (z > river.zSrc - 1 && river.dist(x, z) < hw + 1.4) return null;
  if (L.pathDist(x, z) < 1.3 || L.inRoad(x, z, 1.1)) return null;
  if (Math.hypot(x - L.clear.x, z - L.clear.z) < L.clear.r + 0.6) return null;
  for (const m of L.mts) if (Math.hypot(x - m.x, z - m.z) < m.r * 0.92) return null;
  for (const r of L.keep) if (x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1) return null;
  const rx = river.x(z);
  let p, pine, bush, g0 = 0.4;
  if (x < rx - hw - 1) { p = 0.46; pine = 0.5; bush = 0.08; }                       // woods on the far bank
  else if (z < b.z0 - 4) { p = 0.4; pine = 0.45; bush = 0.1; }                      // woods behind the office
  else if (x > X.walk1) { p = 0.24; pine = 0.2; bush = 0.3; g0 = 0.3; }             // gardens across the street
  else if (z > L.pz) { p = 0.15 + 0.2 * smooth(b.x0 + 4, rx + 1, x); pine = 0.12; bush = 0.35; g0 = 0.3; }  // the meadow in front
  else { p = 0.16; pine = 0.3; bush = 0.25; g0 = 0.3; }                             // between the office and the river
  // groves with open glades between them, sparse near the office and denser toward the island's edges
  const ex = Math.max(b.x0 - x, x - b.x1, 0), ez = Math.max(b.z0 - z, z - b.z1, 0);
  p *= smooth(g0, g0 + 0.32, vnoise(x * 0.085, z * 0.085, 9)) * (0.25 + 0.75 * smooth(4, 18, Math.hypot(ex, ez)));
  return { p, pine, bush };
}

function scatterTrees(c) {
  const { L, trees, lite } = c, { I } = L, cell = 1.75;
  const dens = lite ? 0.5 : 1;
  for (let gz = Math.floor(I.z0 / cell); gz <= Math.ceil(I.z1 / cell); gz++) {
    for (let gx = Math.floor(I.x0 / cell); gx <= Math.ceil(I.x1 / cell); gx++) {
      const x = (gx + 0.15 + hash2(gx, gz, 11) * 0.7) * cell, z = (gz + 0.15 + hash2(gx, gz, 12) * 0.7) * cell;
      const zone = treeZone(L, x, z);
      if (!zone || hash2(gx, gz, 13) > zone.p * dens) continue;
      const r4 = hash2(gx, gz, 14), rs = hash2(gx, gz, 15);
      let type = r4 < zone.pine ? 'pine' : r4 > 1 - zone.bush ? 'bush' : 'round';
      let s = type === 'pine' ? 0.8 + rs * 0.7 : type === 'round' ? 0.85 + rs * 0.5 : 0.7 + rs * 0.5;
      const sy = type === 'pine' ? 0.95 + hash2(gx, gz, 16) * 0.35 : 0.92 + hash2(gx, gz, 16) * 0.2;
      if (type !== 'bush' && L.hides(x, z, TREE_H[type] * s * sy, TREE_R[type] * s)) { type = 'bush'; s = 0.8 + rs * 0.3; }
      if (type === 'bush' && L.hides(x, z, TREE_H.bush * s, 0.5)) continue;
      trees[type].push({ x, z, s, sy, ry: hash2(gx, gz, 17) * 6.28, t: hash2(gx, gz, 18), w: hash2(gx, gz, 19) });
      blob(c, x, z, TREE_R[type] * s, TREE_H[type] * s * sy);
    }
  }
  // wild flowers and a few stones in the grass
  if (lite) return;
  const fc = 4.2;
  for (let gz = Math.floor(I.z0 / fc); gz <= Math.ceil(I.z1 / fc); gz++) {
    for (let gx = Math.floor(I.x0 / fc); gx <= Math.ceil(I.x1 / fc); gx++) {
      const r = hash2(gx, gz, 21);
      if (r > 0.42) continue;
      const x = (gx + 0.2 + hash2(gx, gz, 22) * 0.6) * fc, z = (gz + 0.2 + hash2(gx, gz, 23) * 0.6) * fc;
      const zone = treeZone(L, x, z);
      if (!zone || L.woodAt(x, z) > 0.5) continue;
      if (r < 0.34) wildFlowers(c, x, z, gx * 7919 + gz * 104729);
      else rock(c, x, z, 0.35 + (r - 0.34) * 4, (gx * 31 + gz * 17) & 0xffff);
    }
  }
}

function treeGeometries() {
  const round = new Mesher();
  round.put(G.cyl, 0, 0.5, 0, 0.2, 1.0, 0.2, '#8a5d3b');
  round.put(G.ico, 0, 1.45, 0, 1.5, 1.35, 1.5, '#5daa55', 0.3);
  round.put(G.ico, 0.32, 1.9, 0.12, 1.0, 0.95, 1.0, '#6cb85f', 1.1);
  round.put(G.ico, -0.3, 1.72, -0.18, 0.95, 0.9, 0.95, '#55a04f', 2.0);
  const pine = new Mesher();
  pine.put(G.cyl, 0, 0.3, 0, 0.18, 0.6, 0.18, '#7a5236');
  pine.put(G.cone, 0, 1.05, 0, 1.6, 1.25, 1.6, '#3f8c58');
  pine.put(G.cone, 0, 1.7, 0, 1.22, 1.05, 1.22, '#47975f');
  pine.put(G.cone, 0, 2.3, 0, 0.84, 0.9, 0.84, '#52a468');
  const bush = new Mesher();
  bush.put(G.ico, 0, 0.32, 0, 1.0, 0.72, 1.0, '#5aa653', 0.4);
  bush.put(G.ico, 0.34, 0.27, 0.12, 0.66, 0.54, 0.66, '#68b35c', 1.3);
  bush.put(G.ico, -0.3, 0.25, -0.1, 0.6, 0.5, 0.6, '#4f9a4b', 2.2);
  return { round: round.build(), pine: pine.build(), bush: bush.build() };
}

// ------------------------------------------------------------ water

function buildWater(c) {
  const { L, W } = c, { river, I } = L, white = C('#ffffff');
  const zs = [];
  for (let z = river.zSrc; z < I.z1 - 0.05; z += 0.55) zs.push(z);
  zs.push(I.z1);
  let v = 0, px = null, pzz = null;
  const rows = [];
  for (const z of zs) {
    const x = river.x(z), hw = river.hw(z) + 0.85, last = z === I.z1;
    if (px !== null) v += Math.hypot(x - px, z - pzz) / 2.4;
    px = x; pzz = z;
    const dx = river.dx(z), l = Math.hypot(1, dx), nx = last ? 1 : 1 / l, nz = last ? 0 : -dx / l;
    rows.push([
      W.vert(x - nx * hw, WATER_Y, z - nz * hw, 0, 1, 0, white, 1, -hw / 2.4, v),
      W.vert(x + nx * hw, WATER_Y, z + nz * hw, 0, 1, 0, white, 1, hw / 2.4, v),
    ]);
  }
  for (let i = 0; i < rows.length - 1; i++) {
    const [a, b] = rows[i], [cc, d] = rows[i + 1];
    W.tri(a, cc, b); W.tri(b, cc, d);
  }
  // the waterfall off the front edge, fading out below the island
  const xe = river.x(I.z1), he = river.hw(I.z1) + 0.3, z1 = I.z1;
  const fall = [
    [z1, WATER_Y, 1, 1], [z1 + 0.14, WATER_Y - 0.1, 1, 0.55], [z1 + 0.27, WATER_Y - 0.42, 1, 0.2],
    [z1 + 0.34, GY - 1.6, 0.96, 0.02], [z1 + 0.37, GY - BASE_H + 0.3, 0.7, 0], [z1 + 0.4, GY - BASE_H - 1.6, 0, 0],
  ];
  let fv = v, prev = null;
  const frows = [];
  for (const [z, y, alpha, ny] of fall) {
    if (prev) fv += Math.hypot(z - prev[0], y - prev[1]) * 1.1;
    prev = [z, y];
    const l = Math.hypot(ny, 1);
    frows.push([
      W.vert(xe - he, y, z, 0, ny / l, 1 / l, white, alpha, -he / 2.4, fv),
      W.vert(xe + he, y, z, 0, ny / l, 1 / l, white, alpha, he / 2.4, fv),
    ]);
  }
  for (let i = 0; i < frows.length - 1; i++) {
    const [a, b] = frows[i], [cc, d] = frows[i + 1];
    W.tri(a, cc, b); W.tri(b, cc, d);
  }
}

// ------------------------------------------------------------ textures

function canvasTex(w, h, draw, repeat) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function radial(stops) {
  return (g, w, h) => {
    const rg = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    for (const [k, a] of stops) rg.addColorStop(k, `rgba(255,255,255,${a})`);
    g.fillStyle = rg;
    g.fillRect(0, 0, w, h);
  };
}
// tiling water: blue with soft darker patches, light streaks along the flow and a few sparkles
function drawWater(g, w, h) {
  const r = rng(5);
  g.fillStyle = '#3f9ccd';
  g.fillRect(0, 0, w, h);
  const wrap = (fn) => { for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) fn(ox, oy); };
  for (let i = 0; i < 26; i++) {
    const x = r() * w, y = r() * h, rx = 8 + r() * 14, ry = 5 + r() * 9;
    g.fillStyle = 'rgba(40,120,170,.35)';
    wrap((ox, oy) => { g.beginPath(); g.ellipse(x + ox, y + oy, rx, ry, 0, 0, Math.PI * 2); g.fill(); });
  }
  for (let i = 0; i < 34; i++) {
    const x = r() * w, y = r() * h, rx = 1.2 + r() * 1.6, ry = 5 + r() * 12;
    g.fillStyle = `rgba(170,225,245,${0.35 + r() * 0.35})`;
    wrap((ox, oy) => { g.beginPath(); g.ellipse(x + ox, y + oy, rx, ry, 0, 0, Math.PI * 2); g.fill(); });
  }
  for (let i = 0; i < 12; i++) {
    const x = r() * w, y = r() * h;
    g.fillStyle = 'rgba(255,255,255,.95)';
    wrap((ox, oy) => { g.fillRect(x + ox - 1, y + oy - 1, 2.2, 2.2); });
  }
}

// ------------------------------------------------------------ the module

export function createEnv({ scene, camera, lights = null, lightDir = null, softwareGL = false, fitBox = null } = {}) {
  const lite = !!softwareGL;
  const root = new THREE.Group();
  root.name = 'environment';
  scene.add(root);
  const sunDir = new THREE.Vector2(-(lightDir ? lightDir.x : 0.55), -(lightDir ? lightDir.z : 0.8)).normalize();

  const TEX = {
    water: canvasTex(128, 128, drawWater, true),
    blob: canvasTex(64, 64, radial([[0, 0.9], [0.45, 0.55], [1, 0]]), false),
    glow: canvasTex(64, 64, radial([[0, 1], [0.3, 0.5], [1, 0]]), false),
  };
  const MAT = {
    stat: new THREE.MeshLambertMaterial({ vertexColors: true }),
    lit: new THREE.MeshLambertMaterial({ vertexColors: true, emissive: '#000000' }),
    water: new THREE.MeshLambertMaterial({ vertexColors: true, map: TEX.water, transparent: true }),
    blob: new THREE.MeshBasicMaterial({ map: TEX.blob, color: '#1f3a1c', transparent: true, opacity: 0.3, depthWrite: false }),
    glow: new THREE.PointsMaterial({ map: TEX.glow, color: '#ffd48a', size: 60, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
    pool: new THREE.MeshBasicMaterial({ map: TEX.glow, color: '#ffcf7a', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
  };
  const TREE = treeGeometries();

  const params = (() => { try { return new URLSearchParams(location.search); } catch { return new URLSearchParams(); } })();
  const hourParam = params.get('hour') !== null && params.get('hour') !== '' && Number.isFinite(+params.get('hour'))
    ? ((+params.get('hour') % 24) + 24) % 24 : null;
  const off = params.get('env') === '0';

  let pending = null, pendingAt = 0, delay = 90, sig = '', built = false, L = null, last = null, builtRect = null, checkAt = -1e9;
  // road connections requested by the local lots (roadApi); registered anew on every office rebuild
  let roadReqs = [], roadFns = [], roadsDirty = false, builtRoads = '';
  const roadsKey = () => roadReqs.map(r => [r.x, r.z, r.d[0], r.d[1], r.width].map(v => Math.round(v * 100) / 100).join(',')).join(';');
  function setRoute(req, pts) {
    const res = req.res;
    res.points.length = 0;
    for (const [x, z] of pts) res.points.push({ x, z });
    const j = pts[pts.length - 1];
    res.junction.x = j[0]; res.junction.z = j[1];
  }
  function network(b, I) {
    const X = streetX(b);
    return [[{ x: X.mid, z: I.z0 }, { x: X.mid, z: I.z1 }]];
  }
  function notifyRoads(net) {
    const payload = { network: net, roads: roadReqs.map(r => r.res) };
    for (const fn of roadFns.slice()) { try { fn(payload); } catch (err) { report('onRoadsChange', err); } }
  }
  let cars = [], glowPts = null, poolMesh = null, stats = {};
  let night = -1, dayAt = -1e9, lightBase = null, errLogged = false;
  const report = (where, err) => {
    if (errLogged) return;
    errLogged = true;
    console.error(`Office environment (${where}):`, err);
  };

  function clear() {
    for (const o of root.children.slice()) {
      root.remove(o);
      if (o.isInstancedMesh) { o.dispose(); if (o.userData.own) o.geometry.dispose(); }
      else if (o.geometry && o.userData.own) o.geometry.dispose();
    }
    cars = []; glowPts = null; poolMesh = null;
  }

  function mesh(geo, mat, receive = true) {
    const m = new THREE.Mesh(geo, mat);
    m.receiveShadow = receive;
    m.userData.own = true;
    root.add(m);
    return m;
  }
  function instanced(geo, mat, list, fill, own = false) {
    if (!list.length) return null;
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    const col = new THREE.Color();
    list.forEach((it, i) => { fill(it, _m, col); im.setMatrixAt(i, _m); if (it.t !== undefined) im.setColorAt(i, col); });
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();
    im.userData.own = own;
    root.add(im);
    return im;
  }

  function build(info, view) {
    const t0 = performance.now();
    clear();
    builtRect = islandRect(info.bounds, view, fitBox ? fitBox() : null);
    L = plan(info, builtRect, roadReqs);
    for (const r of L.roads) setRoute(r.req, r.pts);
    const c = {
      L, lite, sunDir, S: new Mesher(), LT: new Mesher(), W: new Mesher({ uv: true, alpha: true }),
      trees: { round: [], pine: [], bush: [] }, blobs: [], glows: [], pools: [],
    };
    const grid = buildGround(c);
    buildSkirt(c, grid);
    c.S.slab(L.I.x0 - 0.3, L.I.x1 + 0.3, L.I.z0 - 0.3, L.I.z1 + 0.3, GY - BASE_H, GY - BASE_H - 0.28, PAL.plate);
    buildStreet(c);
    buildRoads(c);
    for (const h of L.houses) house(c, h);
    buildPark(c);
    for (const m of L.mts) mountain(c.S, m);
    scatterTrees(c);
    buildWater(c);

    mesh(c.S.build(), MAT.stat);
    if (c.LT.v) mesh(c.LT.build(), MAT.lit);
    mesh(c.W.build(), MAT.water);
    for (const type of ['round', 'pine', 'bush']) {
      const im = instanced(TREE[type], MAT.stat, c.trees[type], (it, m, col) => {
        _q.setFromEuler(_e.set(0, it.ry, 0));
        m.compose(_p.set(it.x, GY - 0.02, it.z), _q, _s.set(it.s, it.s * it.sy, it.s));
        const k = 0.9 + it.t * 0.2;
        col.setRGB(k * (1 + (it.w - 0.5) * 0.12), k, k * (1 - (it.w - 0.5) * 0.16));
      });
      if (im) im.receiveShadow = true;
    }
    instanced(G.flat, MAT.blob, c.blobs, (it, m) => {
      _q.setFromEuler(_e.set(0, it.ry, 0));
      m.compose(_p.set(it.x, it.y, it.z), _q, _s.set(it.sx, 1, it.sz));
    });
    if (!lite && c.glows.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(c.glows, 3));
      glowPts = new THREE.Points(g, MAT.glow);
      glowPts.userData.own = true;
      glowPts.visible = false;
      glowPts.renderOrder = 6;
      root.add(glowPts);
      poolMesh = instanced(G.flat, MAT.pool, c.pools, (it, m) => {
        _q.identity();
        m.compose(_p.set(it[0], WALK_Y + 0.014, it[1]), _q, _s.set(it[2], 1, it[2]));
      });
      if (poolMesh) { poolMesh.visible = false; poolMesh.renderOrder = 5; }
    }
    // two toy cars driving along the street
    if (!lite) {
      const { X, I } = L;
      [[X.road0 + 1.55, 1, 3.1, CAR_COLORS[2], 0.15], [X.mid + 1.55, -1, 2.6, CAR_COLORS[0], 0.62]].forEach(([x, dir, speed, color, at]) => {
        const M = new Mesher();
        carParts(M, 0, 0, 0, dir > 0 ? 0 : Math.PI, color);
        const m = mesh(M.build(), MAT.stat);
        m.position.set(x, ROAD_Y, lerp(I.z0, I.z1, at));
        cars.push({ m, dir, speed });
      });
    }
    night = -1; dayAt = -1e9;     // re-apply the time of day to the new meshes on the next frame
    built = true;
    const tris = root.children.reduce((s, o) => s + (o.geometry && o.geometry.index ? o.geometry.index.count / 3 * (o.isInstancedMesh ? o.count : 1) : 0), 0);
    stats = {
      ms: +(performance.now() - t0).toFixed(1), meshes: root.children.length, tris: Math.round(tris),
      trees: c.trees.round.length + c.trees.pine.length + c.trees.bush.length, island: [L.I.x1 - L.I.x0, L.I.z1 - L.I.z0],
      roads: L.roads.length,
    };
    builtRoads = roadsKey();
    notifyRoads(network(L.b, L.I));
  }

  function hourNow() {
    if (hourParam !== null) return hourParam;
    const d = new Date();
    return d.getHours() + d.getMinutes() / 60;
  }
  // 0 by day, 1 at night, with an hour and a half of dusk and dawn
  const darkness = h => Math.max(1 - smooth(5.6, 7.1, h), smooth(18.6, 20.1, h));
  const NIGHT_SKY = new THREE.Color('#9fb2ff'), MOON = new THREE.Color('#aebfff');
  function setNight(k) {
    if (Math.abs(k - night) < 0.01) return;
    night = k;
    MAT.lit.emissive.setRGB(1, 0.74, 0.4).multiplyScalar(0.9 * k);
    MAT.glow.opacity = k;
    MAT.pool.opacity = 0.34 * k;
    if (glowPts) glowPts.visible = k > 0.03;
    if (poolMesh) poolMesh.visible = k > 0.03;
    if (lights && lights.hemi && lights.sun) {
      const { hemi, sun } = lights;
      if (!lightBase) lightBase = { hi: hemi.intensity, si: sun.intensity, hc: hemi.color.clone(), sc: sun.color.clone() };
      hemi.intensity = lightBase.hi * (1 - 0.3 * k);
      sun.intensity = lightBase.si * (1 - 0.45 * k);
      hemi.color.copy(lightBase.hc).lerp(NIGHT_SKY, 0.35 * k);
      sun.color.copy(lightBase.sc).lerp(MOON, 0.5 * k);
    }
  }

  return {
    // info: { bounds, base, lots, entries } — bounds: building + lots, base: building only, entries: z of the hall entrances (+x side)
    layout(info) {
      try {
        const b = info && info.bounds;
        if (!b) return;
        if (off) {                 // no surroundings: the connections are still routed for the local module
          const base = info.base || b, lots = info.lots || [];
          for (const r of roadReqs) setRoute(r, routeFor(r, base, lots, streetX(b)));
          notifyRoads(network(b, islandRect(b, null)));
          return;
        }
        const r = v => Math.round(v * 20) / 20;
        const key = [b.x0, b.x1, b.z0, b.z1].map(r).join(',') + '|' + (info.lots || []).map(l => [l.x0, l.x1, l.z0, l.z1].map(r).join(',')).join(';') +
          '|' + (info.entries || []).map(r).join(',') + '|' + (info.base ? r(info.base.x1) : '') + '|' + roadsKey();
        if (key === sig) return;
        sig = key;
        last = pending = info;
        pendingAt = performance.now();
        delay = 90;              // layouts come in bursts (rooms, then the local lots): build once they settle
      } catch (err) { report('layout', err); }
    },
    // called every frame before drawing; T in seconds
    frame(T, dt) {
      try {
        const view = viewOf(camera), now = performance.now(), ok = view.w > 50 && view.h > 50;
        if (built && !pending && last) {
          // connections added or dropped outside a layout (e.g. later from the local module)
          if (roadsDirty) { roadsDirty = false; if (roadsKey() !== builtRoads) { pending = last; pendingAt = now; delay = 90; } }
          // a resized view (or a changed framing) can need another island size to fill it
          if (!pending && ok && T - checkAt > 1) {
            checkAt = T;
            const I = islandRect(last.bounds, view, fitBox ? fitBox() : null);
            if (['x0', 'x1', 'z0', 'z1'].some(k => Math.abs(I[k] - builtRect[k]) > 2)) { pending = last; pendingAt = now; delay = 400; }
          }
        }
        if (pending && ok && (!built || now - pendingAt > delay)) { const p = pending; pending = null; build(p, view); }
        if (!built) return;
        if (!lite) TEX.water.offset.y = -((T * 0.16) % 1);
        for (const car of cars) {
          const { I } = L, m = car.m;
          m.position.z += car.dir * car.speed * dt;
          if (car.dir > 0 && m.position.z > I.z1 + 0.6) m.position.z = I.z0 - 0.6;
          if (car.dir < 0 && m.position.z < I.z0 - 0.6) m.position.z = I.z1 + 0.6;
          const s = smooth(I.z0 - 0.4, I.z0 + 1.8, m.position.z) * smooth(I.z1 + 0.4, I.z1 - 1.8, m.position.z);
          m.scale.setScalar(Math.max(0.001, s));
          m.visible = s > 0.02;
        }
        if (T - dayAt > 5) { dayAt = T; setNight(darkness(hourNow())); }
        if (glowPts && glowPts.visible) MAT.glow.size = 2.6 * camera.zoom;
      } catch (err) { report('frame', err); }
    },
    // for verification: build time, the draw calls the surroundings add right now (one per visible mesh), sizes
    get stats() { return { ...stats, draws: root.children.filter(o => o.visible).length, night: +Math.max(0, night).toFixed(2) }; },
    // the office calls this at the start of every rebuild: the local module registers its connections again
    resetRoads() {
      if (roadReqs.length) roadsDirty = true;
      roadReqs = []; roadFns = [];
    },
    /**
     * Road API for the local module (merged into the office's plugin `api`). getInfo() → { base, lots }: the building's
     * ground rectangle and the lots created so far, read at call time.
     *
     * connectRoad({ x, z, dir = 'e', width = 3.2, key }) → { key, points: [{ x, z }, ...], junction: { x, z }, width } | null
     *   Links a road that leaves a lot at the mouth (x, z) (world coordinates, on the lot's edge) heading `dir` to the
     *   nearest main road. dir: 'n' (-z) | 's' (+z) | 'e' (+x) | 'w' (-x), or a vector { x, z } / [x, z] (snapped to the
     *   nearest axis). width: the connecting road's full width (1.6-8). The surroundings draw it with a curb cut, a stop
     *   line and a zebra crossing where it meets the street, and keep trees and decorations out of it. The route leaves the
     *   mouth straight, runs outside the building and the lots with at most two right-angle bends and meets the street
     *   at a right angle. points: its centerline from the mouth to the junction (the last point), which lies on the main
     *   road's centerline (see roadNetwork). The returned object is live: after every layout of the surroundings its
     *   points and junction are updated in place (then onRoadsChange listeners run). A repeated key replaces the earlier
     *   request. Like onFrame, requests belong to one build: call it again from decorate() on every rebuild.
     * roadNetwork() → [[{ x, z }, ...], ...]: centerlines of the main roads, edge to edge of the island. Main roads carry
     *   one lane each way with right-hand traffic: lane centers lie 1.55 to the right of the centerline in the direction
     *   of travel (heading +z: x - 1.55; heading -z: x + 1.55). Road surface height ≈ -0.09 (the office floor is y = 0).
     * onRoadsChange(fn) → fn({ network, roads }) after every layout of the surroundings (rooms or lots changed, the view
     *   resized): network = roadNetwork(), roads = the connectRoad results, updated. Registered per build, like onFrame.
     */
    roadApi(getInfo) {
      const current = () => {
        const i = (getInfo && getInfo()) || {};
        const base = i.base || (last && (last.base || last.bounds)) || null;
        return base ? { base, lots: i.lots || [] } : null;
      };
      return {
        connectRoad(o = {}) {
          const x = Number(o.x), z = Number(o.z), cur = current();
          if (!Number.isFinite(x) || !Number.isFinite(z) || !cur) return null;
          const req = { key: o.key != null ? String(o.key) : 'road' + roadReqs.length, x, z, d: axisDir(o.dir) || [1, 0], width: clamp(Number(o.width) || 3.2, 1.6, 8) };
          const at = roadReqs.findIndex(r => r.key === req.key);
          req.res = at >= 0 ? roadReqs[at].res : { key: req.key, points: [], junction: { x: 0, z: 0 }, width: req.width };
          req.res.width = req.width;
          if (at >= 0) roadReqs[at] = req; else roadReqs.push(req);
          setRoute(req, routeFor(req, cur.base, cur.lots, streetX(unionBounds(cur.base, cur.lots))));
          roadsDirty = true;
          return req.res;
        },
        roadNetwork() {
          const cur = current();
          if (!cur) return [];
          const b = unionBounds(cur.base, cur.lots);
          const same = L && Math.abs(streetX(b).mid - L.X.mid) < 1e-6;
          return network(b, same ? L.I : islandRect(b, null));
        },
        onRoadsChange(fn) { if (typeof fn === 'function') roadFns.push(fn); },
      };
    },
    dispose() {
      clear();
      scene.remove(root);
      Object.values(MAT).forEach(m => m.dispose());
      Object.values(TEX).forEach(t => t.dispose());
      Object.values(TREE).forEach(g => g.dispose());
    },
  };
}
