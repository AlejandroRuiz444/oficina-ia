// Office: a 3D isometric office in the spirit of Game Dev Tycoon.
// Every live session is a room; the main agent is the room's chief, subagents are the staff at the desks.
// The scene is drawn with three.js. Signs, name tags and balloons live in an HTML layer so they stay crisp.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { catColor, hash, esc, icon, fmtShort } from './util.js';
import { t as msg } from './i18n.js';
import { createEnv } from './ofis-env.js';

// ------------------------------------------------------------ dimensions (1 unit ≈ 1 meter)

const WALL_H = 2.2, WALL_T = 0.16, LOW_H = 0.3;
const SIGN_H = 1.24, SIGN_Y = 1.5;       // room sign on the wall (center height)
const SIGN_HTML_BELOW = 19;               // below this zoom, an HTML fallback sign replaces the wall text
const SIGN_PX = 288;                      // sign texture height in pixels (for crisp text)
const SIGN_FONT = '"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif';
const SIGN_FONT_D = '"Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif';
const ROOM_D = 6.8, CHEF_W = 3.2, COL_W = 2.1, FRONT_M = 1.0, GAP = 1.5;
const ROWS_Z = [1.6, 3.4, 5.2];
const LANE_Z = 0.55;
const COLS = [1, 2, 4];                   // room class → desk columns (3 desks per column)
const CAP = COLS.map(c => c * 3);         // at most 12 subagents; the rest show as "+N" on the sign
const DOOR_W = 0.9, DOOR_H = 1.72;
const WALK = 2.2;                         // units / s
const HALL_D = 5.0, HALL_OPEN_D = 3.6, HALL_GAP = 0.18;  // depth of the hall between two rows / of the open hall in front
const FRAME_MS = 1000 / 30;
const VIEW = new THREE.Vector3(1, 0.9, 1).normalize();
const LIGHT = new THREE.Vector3(0.55, 1, 0.8).normalize();
const YELLOW = '#fab219';
const roomW = cls => CHEF_W + COLS[cls] * COL_W + FRONT_M;

// ------------------------------------------------------------ colors

const THEMES = [
  { wall: '#d8654f', floor: '#4ea394' }, // brick + turquoise
  { wall: '#e8974f', floor: '#4f93ab' }, // orange + teal
  { wall: '#e6cf9f', floor: '#5aa877' }, // beige + green
  { wall: '#86b4cc', floor: '#c9a978' }, // sky + sand
  { wall: '#d98ea4', floor: '#4fa3a0' }, // rose + turquoise
  { wall: '#b6a3db', floor: '#5fb08c' }, // lavender + mint
  { wall: '#cf7b5c', floor: '#5b8fb8' }, // terracotta + blue
  { wall: '#a9c98f', floor: '#8f9fb0' }, // sage + gray
];
const SKINS = ['#f3cfb0', '#e7b590', '#cf9670', '#b07650', '#86573a', '#f7dcc6'];
const HAIRS = ['#2b211c', '#4c3528', '#7d5130', '#c08f4f', '#1c1d24', '#8a8f9c', '#a8432f', '#e0c890'];
const PANTS = ['#35405a', '#3e5a86', '#4a4f5c', '#5c4a3e', '#2f3440'];
const BOOKS = ['#d6604d', '#e8a33d', '#4f86c6', '#5aa469', '#8e6bbf', '#e07a9a', '#3f4a5a', '#e9d8b4'];
const POSTERS = ['#f2c14e', '#5b9bd5', '#e8735a', '#6cc3a0', '#9d7fd8', '#f29fb5'];
const WOOD = '#c8935c', WOOD_D = '#9c6d42', METAL = '#4a505d', BEZEL = '#2a2f3a', CHAIR = '#3d4350', CHAIR_S = '#505869';
const SCR_OFF = '#141820', SCR_IDLE = '#5b6d8e', SCR_DONE = '#3f7a5e';

const FIT_ICON = '<svg class="ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"/></svg>';

// ------------------------------------------------------------ small helpers

const _c = new THREE.Color(), _w = new THREE.Color('#ffffff'), _k = new THREE.Color('#000000');
function shade(hex, t) {
  _c.set(hex).lerp(t > 0 ? _w : _k, Math.abs(t));
  return '#' + _c.getHexString();
}
function rng(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function angTo(a, b, k) {
  const d = ((((b - a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
  return a + d * k;
}
const lerp = (a, b, k) => a + (b - a) * k;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function shortDesc(s) {
  const d = String(s.desc || s.atype || msg('agent.sub')).trim().replace(/\s+/g, ' ');
  if (d.length <= 14) return d;
  let out = '';
  for (const w of d.split(' ')) {
    const nx = out ? out + ' ' + w : w;
    if (nx.length > 14) break;
    out = nx;
  }
  if (!out) out = d.slice(0, 12) + '…';
  return out.replace(/[\s:;,.\-–—]+$/, '');
}

// ------------------------------------------------------------ shared geometries

const GEO = {
  unit: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 16),
  pot: new THREE.CylinderGeometry(0.5, 0.36, 1, 12),
  ico: new THREE.IcosahedronGeometry(0.5, 0),
  head: new THREE.SphereGeometry(0.25, 22, 16),
  hair: new THREE.SphereGeometry(0.268, 22, 12, 0, Math.PI * 2, 0, Math.PI * 0.52),
  bun: new THREE.SphereGeometry(0.11, 12, 10),
  eye: new THREE.SphereGeometry(0.032, 8, 6),
  hand: new THREE.SphereGeometry(0.062, 10, 8),
  torso: new RoundedBoxGeometry(0.44, 0.46, 0.28, 2, 0.1),
  hairLong: new RoundedBoxGeometry(0.46, 0.4, 0.13, 2, 0.06),
  arm: new THREE.CapsuleGeometry(0.066, 0.2, 4, 8).translate(0, -0.165, 0),
  leg: new THREE.CapsuleGeometry(0.078, 0.25, 4, 8).translate(0, -0.2, 0),
  band: new THREE.TorusGeometry(0.278, 0.022, 6, 22, Math.PI),
  cup: new THREE.CylinderGeometry(0.078, 0.078, 0.07, 14).rotateZ(Math.PI / 2),
  mic: new THREE.BoxGeometry(0.022, 0.022, 0.2),
  seat: new RoundedBoxGeometry(0.54, 0.09, 0.52, 2, 0.035),
  back: new RoundedBoxGeometry(0.52, 0.7, 0.1, 2, 0.045),
  arm2: new RoundedBoxGeometry(0.06, 0.05, 0.36, 1, 0.02),
  post: new THREE.CylinderGeometry(0.035, 0.035, 0.36, 8),
  base: new THREE.CylinderGeometry(0.27, 0.27, 0.05, 12),
  hit: new THREE.BoxGeometry(0.64, 1.55, 0.64).translate(0, 0.78, 0),
  screen: new THREE.PlaneGeometry(1, 1),
  ring: new THREE.RingGeometry(0.52, 0.66, 48).rotateX(-Math.PI / 2),
  hover: new THREE.RingGeometry(0.42, 0.5, 40).rotateX(-Math.PI / 2),
  disc: new THREE.CircleGeometry(0.7, 40).rotateX(-Math.PI / 2),
  lamp: new THREE.SphereGeometry(0.1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
  beam: (() => {
    const g = new THREE.CylinderGeometry(0.55, 0.95, 6, 28, 6, true).translate(0, 3, 0);
    const p = g.attributes.position, col = [];
    for (let i = 0; i < p.count; i++) { const k = Math.pow(1 - p.getY(i) / 6, 1.8); col.push(k, k, k); }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return g;
  })(),
};
const SHARED = new Set(Object.values(GEO));
const roundedCache = new Map();
function rounded(w, h, d, r) {
  const key = [w, h, d, r].map(v => v.toFixed(3)).join('|');
  let g = roundedCache.get(key);
  if (!g) { roundedCache.set(key, g = new RoundedBoxGeometry(w, h, d, 2, r)); g.userData.rkey = key; }
  return g;
}

// ------------------------------------------------------------ batch that merges the static scene into one mesh

const _m = new THREE.Matrix4(), _nm = new THREE.Matrix3(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
const _p = new THREE.Vector3(), _s = new THREE.Vector3(), _v = new THREE.Vector3();

class Batch {
  constructor() { this.p = []; this.n = []; this.c = []; this.i = []; this.v = 0; }
  add(geo, m, color) {
    _c.set(color);
    const pos = geo.attributes.position, nor = geo.attributes.normal;
    _nm.getNormalMatrix(m);
    for (let k = 0; k < pos.count; k++) {
      _v.fromBufferAttribute(pos, k).applyMatrix4(m); this.p.push(_v.x, _v.y, _v.z);
      _v.fromBufferAttribute(nor, k).applyMatrix3(_nm).normalize(); this.n.push(_v.x, _v.y, _v.z);
      this.c.push(_c.r, _c.g, _c.b);
    }
    if (geo.index) { const a = geo.index.array; for (let k = 0; k < a.length; k++) this.i.push(this.v + a[k]); }
    else for (let k = 0; k < pos.count; k++) this.i.push(this.v + k);
    this.v += pos.count;
  }
  put(geo, x, y, z, sx, sy, sz, color, ry = 0, rx = 0, rz = 0) {
    _q.setFromEuler(_e.set(rx, ry, rz));
    _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
    this.add(geo, _m, color);
  }
  box(x, y, z, w, h, d, color, ry = 0) { this.put(GEO.unit, x, y, z, w, h, d, color, ry); }
  rbox(x, y, z, w, h, d, r, color, ry = 0) { this.put(rounded(w, h, d, r), x, y, z, 1, 1, 1, color, ry); }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.v > 65535 ? new THREE.Uint32BufferAttribute(this.i, 1) : new THREE.Uint16BufferAttribute(this.i, 1));
    g.computeBoundingSphere();
    return g;
  }
}

// ------------------------------------------------------------ textures (drawn on a canvas in grayscale; color comes from the material)

function canvasTex(size, draw, repeat = true) {
  const cv = document.createElement('canvas');
  cv.width = size[0]; cv.height = size[1];
  draw(cv.getContext('2d'), cv.width, cv.height);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function drawCarpet(g, w, h) {
  const r = rng(7);
  g.fillStyle = '#f4f4f4'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 2600; i++) {
    const v = 214 + ((r() * 40) | 0);
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(r() * w, r() * h, 1.6, 1.6);
  }
  g.fillStyle = 'rgba(0,0,0,.09)';
  g.fillRect(0, 0, w, 2); g.fillRect(0, 0, 2, h);
}
function drawTile(g, w, h) {
  const r = rng(11);
  const n = 2, s = w / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const v = 238 + ((r() * 12) | 0);
    g.fillStyle = `rgb(${v},${v},${v - 3})`;
    g.fillRect(i * s, j * s, s, s);
  }
  g.fillStyle = 'rgba(0,0,0,.13)';
  for (let i = 0; i < n; i++) { g.fillRect(i * s, 0, 2, h); g.fillRect(0, i * s, w, 2); }
}
function drawScreen(g, w, h) {
  const r = rng(3);
  g.fillStyle = '#8c8c8c'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, 9);
  g.fillStyle = '#5a5a5a'; g.fillRect(0, 9, 22, h - 9);
  for (let i = 0; i < 9; i++) {
    const y = 16 + i * 7;
    g.fillStyle = '#c8c8c8'; g.fillRect(4, y, 12, 3);
    const ind = (r() * 3 | 0) * 6;
    g.fillStyle = r() < 0.35 ? '#ffffff' : '#e4e4e4';
    g.fillRect(28 + ind, y, 18 + r() * 70, 3);
  }
}

// ------------------------------------------------------------ layout: pairs of rows with a hall between them

// Rows are paired and the hall between them serves both: the back row's door is in its low front wall,
// the front row's door is the glass door in its back wall. A leftover last row has its hall in front (the building's facade).
function vlayout(r) {
  const rows = [], halls = [];
  let z = 0;
  for (let i = 0; i < r; i += 2) {
    if (i) z += GAP;
    rows.push({ z, door: 'front', hall: halls.length });
    const hz = z + ROOM_D + HALL_GAP;
    if (i + 1 < r) {
      halls.push({ z0: hz, z1: hz + HALL_D, open: false, lane: hz + 1.75 });
      rows.push({ z: hz + HALL_D + WALL_T, door: 'back', hall: halls.length - 1 });
      z = hz + HALL_D + WALL_T + ROOM_D;
    } else {
      halls.push({ z0: hz, z1: hz + HALL_OPEN_D, open: true, lane: hz + HALL_OPEN_D * 0.55 });
      z = hz + HALL_OPEN_D;
    }
  }
  return { rows, halls, d: z };
}

// Split the rooms into r rows without reordering them (minimizing the widest row). lead0/lead1: space reserved at the start of the first/last row.
function partition(ws, r, lead0, lead1) {
  const n = ws.length, pre = [0];
  for (const w of ws) pre.push(pre[pre.length - 1] + w);
  const rowW = (i, j) => pre[j] - pre[i] + GAP * (j - i - 1);
  const lead = (k, j) => (k === 1 ? lead0 : 0) + (k === r && j === n ? lead1 : 0);
  const best = Array.from({ length: r + 1 }, () => new Array(n + 1).fill(Infinity));
  const cut = Array.from({ length: r + 1 }, () => new Array(n + 1).fill(0));
  best[0][0] = 0;
  for (let k = 1; k <= r; k++) {
    for (let j = k; j <= n; j++) {
      for (let i = k - 1; i < j; i++) {
        const v = Math.max(best[k - 1][i], rowW(i, j) + lead(k, j));
        if (v < best[k][j]) { best[k][j] = v; cut[k][j] = i; }
      }
    }
  }
  const rows = [];
  let j = n;
  for (let k = r; k >= 1; k--) { const i = cut[k][j]; rows.unshift([i, j]); j = i; }
  return { rows, w: best[r][n] };
}
function pack(items, lead0 = 0, lead1 = 0) {
  const n = items.length;
  if (!n) return null;
  const ws = items.map(it => it.W);
  let best = null;
  for (let r = 1; r <= n; r++) {
    const { rows, w } = partition(ws, r, lead0, lead1);
    const V = vlayout(r);
    let waste = 0;
    rows.forEach(([i, j], k) => {
      const ld = (k === 0 ? lead0 : 0) + (k === r - 1 ? lead1 : 0);
      waste += w - (ws.slice(i, j).reduce((s, x) => s + x, 0) + GAP * (j - i - 1) + ld);
    });
    const score = w + V.d + waste * 0.35;
    if (!best || score < best.score - 1e-6) best = { rows, w, V, score };
  }
  const R = best.rows.length;
  const place = new Array(n);
  best.rows.forEach(([i, j], k) => {
    for (let q = i; q < j; q++) place[q] = { row: k };
  });
  return { place, w: best.w, d: best.V.d, V: best.V, R, rowsIdx: best.rows };
}

// ------------------------------------------------------------ view

export function createOfis(root, ctx) {
  const { store } = ctx;
  root.innerHTML =
    '<div class="of-stage"></div><div class="of-layer"></div>' +
    '<div class="of-hud"><div class="of-sum"></div></div>' +
    '<div class="of-ctl">' +
    `<button type="button" data-z="in" title="${esc(msg('of.zoomIn'))}">+</button>` +
    `<button type="button" data-z="out" title="${esc(msg('of.zoomOut'))}">−</button>` +
    `<button type="button" data-z="fit" title="${esc(msg('of.fit'))}">${FIT_ICON}</button></div>` +
    '<div class="of-empty" hidden></div>';
  const stage = root.querySelector('.of-stage');
  const layer = root.querySelector('.of-layer');
  const sumEl = root.querySelector('.of-sum');
  const emptyEl = root.querySelector('.of-empty');

  // Software WebGL (SwiftShader / llvmpipe, e.g. headless Chrome or a VM without a GPU) draws on the CPU
  // and can saturate several cores; detect it once and fall back to a low-power profile.
  const SOFTWARE_GL = (() => {
    try {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      if (!gl) return false;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
      const lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
      return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name);
    } catch { return false; }
  })();

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: !SOFTWARE_GL, alpha: true, powerPreference: 'default' });
  } catch {
    emptyEl.hidden = false;
    emptyEl.textContent = msg('of.noWebgl');
    return { show() {}, hide() {}, update() {} };
  }
  renderer.setPixelRatio(SOFTWARE_GL ? 1 : Math.min(1.5, window.devicePixelRatio || 1));
  renderer.setClearColor(0x000000, 0);
  // Shadows are re-rendered only when the scene changes (see sync) and every few frames, not every frame.
  renderer.shadowMap.enabled = !SOFTWARE_GL;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  stage.appendChild(renderer.domElement);
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  const TEX = {
    carpet: canvasTex([128, 128], drawCarpet),
    tile: canvasTex([128, 128], drawTile),
    screen: canvasTex([128, 80], drawScreen, false),
    glow: canvasTex([64, 64], (g, w, h) => {
      const rg = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      rg.addColorStop(0, 'rgba(255,255,255,1)');
      rg.addColorStop(0.35, 'rgba(255,255,255,.45)');
      rg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = rg;
      g.fillRect(0, 0, w, h);
    }, false),
  };
  TEX.carpet.anisotropy = TEX.tile.anisotropy = aniso;

  const MAT = {
    stat: new THREE.MeshLambertMaterial({ vertexColors: true }),
    screen: new THREE.MeshBasicMaterial({ map: TEX.screen }),
    slab: new THREE.MeshLambertMaterial({ color: '#ddd6c8', map: TEX.tile }),
    glass: new THREE.MeshLambertMaterial({ color: '#c4e9f5', transparent: true, opacity: 0.42, depthWrite: false }),
    ovl: new THREE.MeshBasicMaterial({ color: '#0a0f28', transparent: true, opacity: 0.5, depthWrite: false }),
    hover: new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85, depthWrite: false }),
    signSide: new THREE.MeshLambertMaterial({ color: '#1b1f28' }),
    hall: new THREE.MeshLambertMaterial({ color: '#f2ede3', map: TEX.tile }),
  };
  const matCache = new Map();
  const mat = hex => {
    let m = matCache.get(hex);
    if (!m) matCache.set(hex, m = new THREE.MeshLambertMaterial({ color: hex }));
    return m;
  };
  const floorMats = new Map();
  const floorMat = hex => {
    let m = floorMats.get(hex);
    if (!m) floorMats.set(hex, m = new THREE.MeshLambertMaterial({ color: hex, map: TEX.carpet }));
    return m;
  };

  // door leaf: all doors share the same geometry
  const doorGeo = (() => {
    const B = new Batch(), w = DOOR_W - 0.04, h = DOOR_H - 0.03, t = 0.05, f = 0.07, col = '#f2f4f7';
    B.box(f / 2, h / 2, 0, f, h, t, col);
    B.box(w - f / 2, h / 2, 0, f, h, t, col);
    B.box(w / 2, h - f / 2, 0, w, f, t, col);
    B.box(w / 2, 0.1, 0, w, 0.2, t, col);
    B.box(w - 0.16, 0.95, 0.045, 0.04, 0.3, 0.04, '#8b929f');
    B.box(w - 0.16, 0.95, -0.045, 0.04, 0.3, 0.04, '#8b929f');
    return B.build();
  })();
  const glassGeo = new THREE.BoxGeometry(DOOR_W - 0.04 - 0.14, DOOR_H - 0.03 - 0.27, 0.02).translate((DOOR_W - 0.04) / 2, 0.2 + (DOOR_H - 0.03 - 0.27) / 2, 0);

  // ---------------------------------------------------------- scene, lights, camera

  const scene = new THREE.Scene();
  const hemi = new THREE.HemisphereLight('#fffaf0', '#8d8478', 1.9);
  const sun = new THREE.DirectionalLight('#fff4e2', 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(hemi, sun, sun.target);

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 50, 700);
  const R = new THREE.Vector3(1, 0, -1).normalize();
  const U = new THREE.Vector3().crossVectors(VIEW, R).normalize();
  const focus = new THREE.Vector3();
  let camA = 0, camB = 0, zoom = 30, zMin = 4, zMax = 90, vw = 1, vh = 1;
  let autoFit = true;
  let lim = { a0: -1e9, a1: 1e9, b0: -1e9, b1: 1e9 };

  function applyCam() {
    camA = clamp(camA, lim.a0, lim.a1);
    camB = clamp(camB, lim.b0, lim.b1);
    camera.left = -vw / 2; camera.right = vw / 2; camera.top = vh / 2; camera.bottom = -vh / 2;
    camera.zoom = zoom;
    camera.updateProjectionMatrix();
    focus.copy(R).multiplyScalar(camA).addScaledVector(U, camB);
    camera.position.copy(focus).addScaledVector(VIEW, 300);
    camera.up.set(0, 1, 0);
    camera.lookAt(focus);
    camera.updateMatrixWorld();
  }

  const hoverRing = new THREE.Mesh(GEO.hover, MAT.hover);
  hoverRing.visible = false;
  hoverRing.renderOrder = 3;
  scene.add(hoverRing);

  // surroundings (street, river, woods, mountains): laid out around world.bounds in applyBounds, animated in step
  const env = createEnv({ scene, camera, lights: { hemi, sun }, lightDir: LIGHT, softwareGL: SOFTWARE_GL, fitBox: () => projBounds() });

  // ---------------------------------------------------------- state

  let visible = false, raf = 0, lastT = 0, resized = true, instantNext = true;
  const world = { group: null, rooms: new Map(), pick: [], screens: [], screenMesh: null, bounds: null, sig: '' };
  const roomState = new Map();   // session id → { cls, low }
  const chars = new Map();       // agent id → character
  const labels = new Set();
  const signs = new Map();       // session id → sign label
  const themeOf = new Map();     // project → theme index; open projects get distinct colors when possible
  let extras = null;             // optional local decoration module { mod, w }
  const extraLabels = [];
  const extraFrame = [];
  const extraMats = [];
  const extraPointer = [];       // pointer hooks of the local module (api.onPointer), per build like extraFrame
  const extraFigs = [];          // people created by the local module (api.figures), per build
  const doorWalkers = [];        // x, z pairs from api.openDoorsNear for this frame; cleared after stepRooms
  let shakeAmp = 0;              // camera shake strength in screen pixels (api.shake); decays every frame
  let activeTool = null;         // exclusive interaction mode of a local add-on (api.setTool); kept across builds
  const toolFns = [];            // api.onToolChange listeners, per build like extraFrame
  const gRay = new THREE.Raycaster(), gNdc = new THREE.Vector2(), gPlane = new THREE.Plane(), gUp = new THREE.Vector3(0, 1, 0);
  const gV1 = new THREE.Vector3(), gV2 = new THREE.Vector3(), gV3 = new THREE.Vector3(), gBox = new THREE.Box3();

  function assignThemes(list) {
    const live = [];
    for (const it of list) {
      const a = store.agents.get(it.id);
      const p = (a && a.project) || it.id;
      if (!live.includes(p)) live.push(p);
    }
    const used = new Set(live.filter(p => themeOf.has(p)).map(p => themeOf.get(p)));
    for (const p of live) {
      if (themeOf.has(p)) continue;
      let t = hash(p) % THEMES.length;
      for (let i = 0; i < THEMES.length && used.has(t); i++) t = (t + 1) % THEMES.length;
      themeOf.set(p, t);
      used.add(t);
    }
  }

  // ---------------------------------------------------------- label layer

  function mkLabel(cls, pri, mode, gap, minZoom = 0) {
    const el = document.createElement('div');
    el.className = 'of-l ' + cls;
    el.style.zIndex = String(pri);
    el.style.visibility = 'hidden';
    layer.appendChild(el);
    const L = { el, pri, mode, gap, minZoom, pos: new THREE.Vector3(), want: true, shown: false, html: '', dirty: true, w: 0, h: 0, force: false };
    labels.add(L);
    return L;
  }
  function setLabel(L, html, id, pri) {
    if (L.html !== html) { L.el.innerHTML = html; L.html = html; L.dirty = true; }
    if (id !== undefined && L.el.dataset.id !== id) L.el.dataset.id = id;
    if (pri !== undefined && L.pri !== pri) { L.pri = pri; L.el.style.zIndex = String(pri); }
  }
  function dropLabel(L) { if (!L) return; L.el.remove(); labels.delete(L); }
  function showLabel(L, on) {
    if (L.shown === on) return;
    L.shown = on;
    L.el.style.visibility = on ? 'visible' : 'hidden';
  }

  const PV = new THREE.Vector3();
  function placeLabels() {
    const s = clamp(zoom / 38, 0.74, 1);
    const list = [];
    for (const L of labels) {
      if (!L.want || L.off || zoom < L.minZoom || (L.maxZoom && zoom >= L.maxZoom)) { showLabel(L, false); continue; }
      if (L.dirty) { L.w = L.el.offsetWidth; L.h = L.el.offsetHeight; L.dirty = false; }
      PV.copy(L.pos).project(camera);
      const sx = (PV.x + 1) / 2 * vw, sy = (1 - PV.y) / 2 * vh;
      const k = L.force ? Math.max(s, 0.9) : s;
      const w = L.w * k, h = L.h * k;
      const x = sx - w / 2;
      const y = L.mode === 'up' ? sy - h - L.gap * k : L.mode === 'mid' ? sy - h / 2 : sy + L.gap * k;
      if (x > vw + 4 || x + w < -4 || y > vh + 4 || y + h < -4) { showLabel(L, false); continue; }
      L.x = x; L.y = y; L.sw = w; L.sh = h; L.k = k;
      list.push(L);
    }
    list.sort((a, b) => b.pri - a.pri || b.y - a.y);
    const placed = [];
    for (const L of list) {
      let ok = true;
      if (!L.force) {
        for (const P of placed) {
          if (L.x < P.x + P.sw + 3 && L.x + L.sw + 3 > P.x && L.y < P.y + P.sh + 2 && L.y + L.sh + 2 > P.y) { ok = false; break; }
        }
      }
      if (!ok) { showLabel(L, false); continue; }
      placed.push(L);
      L.el.style.transform = `translate(${L.x.toFixed(1)}px,${L.y.toFixed(1)}px) scale(${L.k.toFixed(3)})`;
      showLabel(L, true);
    }
  }

  // ---------------------------------------------------------- build the rooms

  function disposeWorld() {
    if (!world.group) return;
    scene.remove(world.group);
    world.group.traverse(o => {
      if (o.userData.own && o.geometry && !SHARED.has(o.geometry) && !roundedCache.has(o.geometry.userData.rkey)) o.geometry.dispose();
      if (o.userData.ownMat && o.material) o.material.dispose();
      if (o.userData.dispose) o.userData.dispose();
      if (o.userData.mats) o.userData.mats.forEach(m => m.dispose());
    });
    world.group = null;
  }

  function rebuild(list) {
    disposeWorld();
    const g = new THREE.Group();
    world.group = g;
    scene.add(g);
    world.pick = [];
    world.screens = [];
    const oldRooms = world.rooms;
    world.rooms = new Map();
    for (const L of extraLabels) dropLabel(L);
    extraLabels.length = 0;
    extraFrame.length = 0;
    extraPointer.length = 0;
    toolFns.length = 0;
    env.resetRoads();
    extraFigs.length = 0;
    extraMats.splice(0).forEach(m => m.dispose());

    const items = list.map(it => ({ ...it, W: roomW(it.cls) }));
    // optional local extra areas: 'last' = start of the last row (bottom-left front corner), 'first' = start of the first row (opens onto the hall)
    const ex = items.length && extras ? extras.areas : [];
    const aFirst = ex.find(x => x.row === 'first'), aLast = ex.find(x => x.row === 'last');
    const P = pack(items, aFirst ? aFirst.w + GAP : 0, aLast ? aLast.w + GAP : 0);
    world.halls = P ? P.V.halls : [];
    world.width = P ? P.w : 0;
    world.entryX = world.width + 0.45;
    world.depth = P ? P.d : 0;
    const areas = world.areaList = [];
    if (P) {
      // rooms in short rows widen to fill the row; the extra space becomes a lounge corner in the room
      P.rowsIdx.forEach(([i, j], k) => {
        const row = P.V.rows[k];
        let lx = 0;
        if (k === P.R - 1 && aLast) { areas.push({ ...aLast, x: 0, z: row.z, door: row.door, hall: row.hall }); lx += aLast.w + GAP; }
        if (k === 0 && aFirst) { areas.push({ ...aFirst, x: lx, z: row.z, door: row.door, hall: row.hall }); lx += aFirst.w + GAP; }
        const idxs = [];
        for (let q = i; q < j; q++) idxs.push(q);
        const used = idxs.reduce((sum, q) => sum + items[q].W, 0) + GAP * (idxs.length - 1) + lx;
        const extra = Math.min(4.2, (P.w - used) / idxs.length);
        let x = lx + (P.w - used - extra * idxs.length) / 2;
        for (const q of idxs) {
          Object.assign(items[q], { W: items[q].W + extra, extra, X: x, Z: row.z, door: row.door, hall: row.hall });
          x += items[q].W + GAP;
        }
      });
    }
    assignThemes(list);
    const B = new Batch();
    const T = WALL_T;

    // floor slab (corridors) and the building's plinth
    const m0 = 0.7;
    const bx0 = -T - m0, bz0 = -T - m0, bx1 = world.width + T + m0, bz1 = (P ? P.d : 0) + T + m0;
    const slabGeo = new THREE.PlaneGeometry(bx1 - bx0, bz1 - bz0).rotateX(-Math.PI / 2);
    const uv = slabGeo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (bx1 - bx0) / 1.2, uv.getY(i) * (bz1 - bz0) / 1.2);
    const slab = new THREE.Mesh(slabGeo, MAT.slab);
    slab.position.set((bx0 + bx1) / 2, 0, (bz0 + bz1) / 2);
    slab.receiveShadow = true;
    slab.userData.own = true;
    g.add(slab);
    B.box((bx0 + bx1) / 2, -0.23, (bz0 + bz1) / 2, bx1 - bx0, 0.46, bz1 - bz0, '#4a5163');
    B.box((bx0 + bx1) / 2, -0.012, (bz0 + bz1) / 2, bx1 - bx0 + 0.06, 0.02, bz1 - bz0 + 0.06, '#b9b1a1');

    items.forEach(it => {
      const room = buildRoom(B, g, it);
      const prev = oldRooms.get(it.id);
      if (prev) room.doorOpen = prev.doorOpen;
      world.rooms.set(it.id, room);
    });
    buildHalls(B, g, items, areas);

    const stat = new THREE.Mesh(B.build(), MAT.stat);
    stat.castShadow = stat.receiveShadow = true;
    stat.userData.own = true;
    g.add(stat);

    world.baseBounds = { x0: bx0, x1: bx1, z0: bz0, z1: bz1 };
    world.lots = [];
    world.fitExtra = [];
    if (extras && items.length) runExtras(g, areas);

    // screens: a single InstancedMesh
    const n = Math.max(1, world.screens.length);
    const sm = new THREE.InstancedMesh(GEO.screen, MAT.screen, n);
    sm.count = world.screens.length;
    world.screens.forEach((s, i) => {
      _q.setFromEuler(_e.set(0, s.ry + Math.PI / 2, 0));
      _m.compose(_p.set(s.x, s.y, s.z), _q, _s.set(s.w, s.h, 1));
      sm.setMatrixAt(i, _m);
      sm.setColorAt(i, _c.set(SCR_OFF));
    });
    sm.instanceMatrix.needsUpdate = true;
    if (sm.instanceColor) sm.instanceColor.needsUpdate = true;
    sm.frustumCulled = false;
    world.screenMesh = sm;
    g.add(sm);


    // seat the characters in their new places
    for (const c of [...chars.values()]) {
      const room = world.rooms.get(c.roomId);
      if (!room) { removeChar(c); continue; }
      if (c.main) { seatChef(c, room); continue; }
      if (c.after === 'gone') { removeChar(c); continue; }
      if (c.slot < 0 || c.slot >= room.cap || room.slotChar[c.slot]) c.slot = room.slotChar.indexOf(null);
      if (c.slot < 0) { removeChar(c); continue; }
      room.slotChar[c.slot] = c;
      seatSub(c, room);
    }
    for (const [id, L] of signs) if (!world.rooms.has(id)) { dropLabel(L); signs.delete(id); }

    applyBounds();
  }

  // Union of the building and the local lots: camera framing, pan limits and the shadow camera follow it.
  function applyBounds() {
    const b = { ...(world.baseBounds || { x0: -1, x1: 1, z0: -1, z1: 1 }) };
    for (const l of world.lots || []) { b.x0 = Math.min(b.x0, l.x0); b.x1 = Math.max(b.x1, l.x1); b.z0 = Math.min(b.z0, l.z0); b.z1 = Math.max(b.z1, l.z1); }
    world.bounds = b;
    env.layout({ bounds: b, base: world.baseBounds, lots: world.lots || [], entries: (world.halls || []).map(h => h.lane) });
    const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    const rad = Math.hypot(b.x1 - b.x0, b.z1 - b.z0) / 2 + 2;
    sun.target.position.set(cx, 0, cz);
    sun.position.set(cx, 0, cz).addScaledVector(LIGHT, 80);
    const sc = sun.shadow.camera;
    sc.left = -rad; sc.right = rad; sc.top = rad; sc.bottom = -rad; sc.near = 1; sc.far = 80 + rad * 2;
    sc.updateProjectionMatrix();
    sun.target.updateMatrixWorld();
    sun.shadow.mapSize.setScalar(rad > 34 ? 4096 : 2048);
    if (sun.shadow.map && sun.shadow.map.width !== sun.shadow.mapSize.x) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    computeLimits();
    if (autoFit) fit();
  }

  // Room shell: carpet, back walls (full height), front walls (low cutaway) and the door facing the hall.
  // door === 'back' → glass door in the back-right wall; 'front' → opening in the low front wall.
  function buildShell(B, g, X, Z, W, D, th, door) {
    const T = WALL_T, H = WALL_H;
    const wall = th.wall, wain = shade(wall, -0.13), rail = shade(wall, 0.5), cap = shade(wall, -0.55), base = shade(wall, -0.38);
    const trim = '#f3efe6';
    const b = (x, y, z, w, hh, d, col, ry) => B.box(X + x, y, Z + z, w, hh, d, col, ry);

    const fg = new THREE.PlaneGeometry(W, D).rotateX(-Math.PI / 2);
    const fuv = fg.attributes.uv;
    for (let i = 0; i < fuv.count; i++) fuv.setXY(i, fuv.getX(i) * W, fuv.getY(i) * D);
    const floor = new THREE.Mesh(fg, floorMat(th.floor));
    floor.position.set(X + W / 2, 0.012, Z + D / 2);
    floor.receiveShadow = true;
    floor.userData.own = true;
    g.add(floor);
    b(W / 2, 0.004, D / 2, W + 0.04, 0.008, D + 0.04, shade(th.floor, -0.3));

    // back-left wall (x = 0 plane)
    b(-T / 2, H / 2, (D - T) / 2, T, H, D + T, wall);
    b(-T / 2, H + 0.025, (D - T) / 2, T + 0.03, 0.05, D + T + 0.03, cap);
    b(0.012, 0.43, D / 2, 0.024, 0.86, D, wain);
    b(0.022, 0.875, D / 2, 0.044, 0.045, D, rail);
    b(0.02, 0.05, D / 2, 0.04, 0.1, D, base);

    // back-right wall (z = 0 plane)
    const dx = W - 1.0, dl = dx - DOOR_W / 2, dr = dx + DOOR_W / 2;
    const seg = (x1, x2) => {
      b((x1 + x2) / 2, H / 2, -T / 2, x2 - x1, H, T, wall);
      const i1 = Math.max(0, x1), i2 = x2;
      if (i2 - i1 > 0.05) {
        b((i1 + i2) / 2, 0.43, 0.012, i2 - i1, 0.86, 0.024, wain);
        b((i1 + i2) / 2, 0.875, 0.022, i2 - i1, 0.045, 0.044, rail);
        b((i1 + i2) / 2, 0.05, 0.02, i2 - i1, 0.1, 0.04, base);
      }
    };
    let pivot = null;
    if (door === 'back') {
      seg(-T, dl - 0.06);
      seg(dr + 0.06, W);
      b(dx, (DOOR_H + 0.06 + H) / 2, -T / 2, DOOR_W + 0.12, H - DOOR_H - 0.06, T, wall);
      b(dl - 0.03, DOOR_H / 2, -T / 2, 0.06, DOOR_H + 0.06, T + 0.07, trim);
      b(dr + 0.03, DOOR_H / 2, -T / 2, 0.06, DOOR_H + 0.06, T + 0.07, trim);
      b(dx, DOOR_H + 0.03, -T / 2, DOOR_W + 0.12, 0.06, T + 0.07, trim);
      b(dx, 0.006, -T / 2, DOOR_W, 0.012, T, '#8b8f98');
      // glass door leaf (hinged on the left, opens inward)
      pivot = new THREE.Group();
      pivot.position.set(X + dl + 0.02, 0.01, Z - T / 2);
      const leaf = new THREE.Mesh(doorGeo, MAT.stat); leaf.castShadow = true;
      const glass = new THREE.Mesh(glassGeo, MAT.glass); glass.renderOrder = 2;
      pivot.add(leaf, glass);
      g.add(pivot);
    } else seg(-T, W);
    b((W - T) / 2, H + 0.025, -T / 2, W + T + 0.03, 0.05, T + 0.03, cap);

    // low front walls (cutaway); with a front door, an opening onto the hall
    b(W + T / 2, LOW_H / 2, D / 2, T, LOW_H, D + 2 * T, wall);
    b(W + T / 2, LOW_H + 0.02, D / 2, T + 0.03, 0.04, D + 2 * T + 0.03, cap);
    const low = (x1, x2) => {
      b((x1 + x2) / 2, LOW_H / 2, D + T / 2, x2 - x1, LOW_H, T, wall);
      b((x1 + x2) / 2, LOW_H + 0.02, D + T / 2, x2 - x1 + 0.03, 0.04, T + 0.03, cap);
    };
    if (door === 'front') {
      low(-T, dl);
      low(dr, W);
      for (const px of [dl - 0.05, dr + 0.05]) b(px, 0.3, D + T / 2, 0.1, 0.6, T + 0.08, trim);
      b(dx, 0.016, D - 0.25, DOOR_W - 0.1, 0.012, 0.5, shade(th.floor, -0.35));
    } else low(-T, W);

    return { pivot, cap, dx, signX0: 0.3, signX1: door === 'back' ? dl - 0.3 : W - 0.75 };
  }

  function buildRoom(B, g, it) {
    const X = it.X, Z = it.Z, W = it.W, D = ROOM_D, T = WALL_T, H = WALL_H;
    const a = store.agents.get(it.id);
    const th = THEMES[themeOf.get((a && a.project) || it.id) ?? (hash(it.id) % THEMES.length)];
    const r = rng(hash(it.id));
    const b = (x, y, z, w, hh, d, col, ry) => B.box(X + x, y, Z + z, w, hh, d, col, ry);
    const rb = (x, y, z, w, hh, d, rr, col, ry) => B.rbox(X + x, y, Z + z, w, hh, d, rr, col, ry);
    const pt = (geo, x, y, z, sx, sy, sz, col, ry, rx, rz) => B.put(geo, X + x, y, Z + z, sx, sy, sz, col, ry, rx, rz);

    const shell = buildShell(B, g, X, Z, W, D, th, it.door);
    const cap = shell.cap;
    const room = {
      id: it.id, cls: it.cls, cap: CAP[it.cls], X, Z, W, D, door: it.door, hall: it.hall,
      chefSeat: new THREE.Vector3(X + 1.95, 0, Z + D / 2),
      doorX: X + shell.dx, doorPt: new THREE.Vector3(X + shell.dx, 0, it.door === 'back' ? Z : Z + D),
      doorPivot: shell.pivot,
      slotChar: new Array(CAP[it.cls]).fill(null),
      doorOpen: 0, overflow: 0,
    };

    // ---- chief's corner
    const cz = D / 2;
    rb(0.95, 0.615, cz, 0.9, 0.05, 2.3, 0.02, shade(WOOD, -0.12));
    b(0.95, 0.3, cz - 1.08, 0.8, 0.6, 0.06, WOOD_D);
    b(0.95, 0.3, cz + 1.08, 0.8, 0.6, 0.06, WOOD_D);
    b(0.6, 0.34, cz, 0.04, 0.5, 2.1, WOOD_D);
    const monitor = (x, z, ry, w, kind, slot) => {
      const nx = Math.cos(ry), nz = -Math.sin(ry);
      b(x, 0.648, z, 0.2, 0.02, 0.24, METAL, ry);
      b(x - nx * 0.02, 0.76, z - nz * 0.02, 0.04, 0.22, 0.05, METAL, ry);
      b(x, 0.97, z, 0.05, 0.38, w, BEZEL, ry);
      world.screens.push({ x: X + x + nx * 0.027, y: 0.975, z: Z + z + nz * 0.027, ry, w: w - 0.06, h: 0.32, room: it.id, kind, slot });
    };
    monitor(0.74, cz - 0.4, -0.22, 0.66, 'chef', 0);
    monitor(0.74, cz + 0.4, 0.22, 0.66, 'chef', 1);
    b(1.2, 0.652, cz, 0.2, 0.025, 0.56, '#e8ebf0');
    b(1.22, 0.652, cz + 0.46, 0.11, 0.022, 0.07, '#e8ebf0');
    pt(GEO.cyl, 1.15, 0.69, cz - 0.86, 0.1, 0.13, 0.1, POSTERS[(r() * POSTERS.length) | 0]);
    pt(GEO.pot, 0.78, 0.69, cz + 0.95, 0.14, 0.12, 0.14, '#e9e4da');
    pt(GEO.ico, 0.78, 0.8, cz + 0.95, 0.2, 0.18, 0.2, '#5aa85a', r() * 3);

    // whiteboard (back-left wall)
    b(0.03, 1.44, cz, 0.04, 0.76, 1.6, '#c9ced7');
    b(0.055, 1.44, cz, 0.02, 0.68, 1.5, '#fbfbfd');
    b(0.08, 1.07, cz, 0.06, 0.03, 1.2, '#b7bcc7');
    const ink = ['#3b6fd1', '#d8484a', '#2f9e6a'];
    for (let i = 0; i < 4; i++) {
      const len = 0.35 + r() * 0.5;
      b(0.068, 1.66 - i * 0.12, cz - 0.62 + len / 2, 0.01, 0.024, len, ink[i % 3]);
    }
    const notes = ['#ffd766', '#ff9fb2', '#8fd3ff', '#b5ec8e'];
    for (let i = 0; i < 4; i++) b(0.068, 1.62 - (i >> 1) * 0.2, cz + 0.36 + (i & 1) * 0.2, 0.01, 0.14, 0.14, notes[(i + (r() * 4 | 0)) % 4]);

    // corner plant
    pt(GEO.pot, 0.42, 0.19, 0.42, 0.36, 0.38, 0.36, '#c8704a');
    b(0.42, 0.37, 0.42, 0.3, 0.02, 0.3, '#5a3f2b');
    pt(GEO.cyl, 0.42, 0.62, 0.42, 0.05, 0.5, 0.05, '#6b4a2e');
    pt(GEO.ico, 0.42, 0.98, 0.42, 0.66, 0.58, 0.66, '#4c9a4f', r() * 3);
    pt(GEO.ico, 0.34, 1.3, 0.48, 0.46, 0.46, 0.46, '#63b25c', r() * 3);
    pt(GEO.ico, 0.52, 1.22, 0.33, 0.38, 0.38, 0.38, '#57a856', r() * 3);

    // filing cabinet
    b(0.25, 0.44, 1.2, 0.46, 0.88, 0.56, '#aab2bf');
    for (let i = 0; i < 3; i++) {
      b(0.485, 0.18 + i * 0.28, 1.2, 0.01, 0.02, 0.46, '#8a93a3');
      b(0.49, 0.25 + i * 0.28, 1.2, 0.02, 0.03, 0.14, '#6e7686');
    }
    b(0.25, 0.94, 1.2, 0.36, 0.12, 0.4, '#e3e6ec');
    b(0.25, 1.005, 1.2, 0.26, 0.012, 0.3, '#f7f7f5');

    // bookshelf (back-left wall, toward the front)
    const bz = cz + 1.92;
    b(0.03, 0.8, bz, 0.04, 1.6, 1.1, WOOD_D);
    b(0.2, 0.8, bz - 0.53, 0.36, 1.6, 0.04, WOOD);
    b(0.2, 0.8, bz + 0.53, 0.36, 1.6, 0.04, WOOD);
    for (const y of [0.03, 0.54, 1.06, 1.58]) b(0.2, y, bz, 0.36, 0.04, 1.1, WOOD);
    for (let s = 0; s < 3; s++) {
      let z = bz - 0.49;
      while (z < bz + 0.45) {
        const bw = 0.05 + r() * 0.05, bh = 0.26 + r() * 0.14;
        if (r() < 0.12) { z += 0.08; continue; }
        b(0.19, 0.05 + s * 0.515 + bh / 2, z + bw / 2, 0.24, bh, bw, BOOKS[(r() * BOOKS.length) | 0]);
        z += bw + 0.008;
      }
    }

    // back-right wall: room sign (project name + session title), with posters and a clock in the space left over
    const sg0 = shell.signX0, sg1 = shell.signX1;
    const sw = Math.min(sg1 - sg0, 5.4), sh = SIGN_H;
    const scx = sg0 + Math.min(sw / 2 + 0.2, (sg1 - sg0) / 2);
    makeSign(g, room, X + scx, SIGN_Y, Z, sw, sh);
    b(scx, SIGN_Y, 0.012, sw + 0.1, sh + 0.1, 0.024, cap);
    const poster = x => {
      const bg = POSTERS[(r() * POSTERS.length) | 0], fg = POSTERS[(r() * POSTERS.length) | 0];
      b(x, 1.42, 0.03, 0.62, 0.82, 0.04, '#2d313b');
      b(x, 1.42, 0.052, 0.54, 0.74, 0.01, bg);
      pt(GEO.cyl, x + 0.1, 1.58, 0.062, 0.22, 0.012, 0.22, shade(fg, 0.25), 0, Math.PI / 2);
      b(x, 1.22, 0.06, 0.54, 0.16, 0.008, shade(bg, -0.25));
      b(x - 0.08, 1.7, 0.06, 0.3, 0.04, 0.008, '#ffffff');
    };
    const clock = x => {
      pt(GEO.cyl, x, 1.55, 0.035, 0.38, 0.04, 0.38, '#2d313b', 0, Math.PI / 2);
      pt(GEO.cyl, x, 1.55, 0.058, 0.32, 0.01, 0.32, '#fbfbf7', 0, Math.PI / 2);
      b(x, 1.6, 0.066, 0.018, 0.1, 0.006, '#23252d');
      b(x + 0.04, 1.55, 0.066, 0.08, 0.016, 0.006, '#23252d');
    };
    let px = scx + sw / 2 + 0.75, first = true;
    while (px + 0.4 < sg1) { (first ? clock : poster)(px); first = false; px += 1.35; }

    // water cooler (next to the door)
    b(W - 0.3, 0.42, 0.32, 0.34, 0.84, 0.34, '#e9edf2');
    b(W - 0.3, 0.6, 0.5, 0.12, 0.08, 0.04, '#5c6474');
    b(W - 0.3, 0.86, 0.32, 0.3, 0.04, 0.3, '#cfd5de');
    pt(GEO.cyl, W - 0.3, 1.07, 0.32, 0.26, 0.38, 0.26, '#8fd0ee');

    // lounge corner: at the front of a room that widened to fill its row
    const cols = COLS[it.cls];
    const lx0 = CHEF_W + cols * COL_W + 0.3, lx1 = W - 0.3, lw = lx1 - lx0;
    if (lw >= 1.5) {
      const lz = 3.9, sofa = shade(th.wall, -0.28), cushion = shade(th.wall, 0.18);
      b((lx0 + lx1) / 2, 0.018, lz, Math.min(lw - 0.1, 3.4), 0.012, 2.6, '#efe6d2');
      b((lx0 + lx1) / 2, 0.02, lz, Math.min(lw - 0.1, 3.4) - 0.24, 0.012, 2.36, shade(th.floor, 0.35));
      const sx = lx0 + 0.42;
      rb(sx, 0.26, lz, 0.72, 0.26, 1.8, 0.06, sofa);
      rb(sx - 0.28, 0.56, lz, 0.18, 0.52, 1.8, 0.06, sofa);
      rb(sx, 0.36, lz - 0.86, 0.72, 0.36, 0.16, 0.05, shade(sofa, -0.1));
      rb(sx, 0.36, lz + 0.86, 0.72, 0.36, 0.16, 0.05, shade(sofa, -0.1));
      rb(sx + 0.04, 0.41, lz - 0.38, 0.56, 0.08, 0.72, 0.04, cushion);
      rb(sx + 0.04, 0.41, lz + 0.38, 0.56, 0.08, 0.72, 0.04, cushion);
      if (lw >= 1.9) {
        const tx = sx + 1.0;
        rb(tx, 0.34, lz, 0.5, 0.05, 0.9, 0.02, WOOD);
        b(tx, 0.16, lz, 0.38, 0.32, 0.78, WOOD_D);
        pt(GEO.cyl, tx, 0.4, lz + 0.22, 0.09, 0.08, 0.09, '#f5f3ee');
        b(tx + 0.02, 0.375, lz - 0.2, 0.2, 0.02, 0.26, POSTERS[(r() * POSTERS.length) | 0], 0.3);
      }
      const plx = lw >= 3.2 ? lx0 + 0.35 : lx1 - 0.25;
      pt(GEO.pot, plx, 0.2, 1.15, 0.34, 0.4, 0.34, '#e9e4da');
      pt(GEO.ico, plx, 0.62, 1.15, 0.5, 0.56, 0.5, '#4f9f55', r() * 3);
      pt(GEO.ico, plx - 0.05, 0.86, 1.2, 0.34, 0.36, 0.34, '#66b35d', r() * 3);
      if (lw >= 3.2) {
        const ax = lx1 - 0.35, az = 1.45, body = POSTERS[(r() * POSTERS.length) | 0];
        b(ax, 0.72, az, 0.56, 1.44, 0.56, shade(body, -0.35));
        b(ax - 0.29, 1.1, az, 0.02, 0.4, 0.46, '#1c2030');
        b(ax - 0.3, 1.1, az, 0.01, 0.34, 0.4, shade(body, 0.3));
        b(ax - 0.33, 0.82, az, 0.16, 0.06, 0.5, '#2a2f3a');
        b(ax - 0.36, 0.86, az - 0.1, 0.03, 0.06, 0.03, '#e24d4d');
        b(ax - 0.36, 0.86, az + 0.1, 0.04, 0.03, 0.04, '#3b8fe0');
        b(ax, 1.47, az, 0.58, 0.08, 0.58, body);
      }
    }

    // subagent desks
    for (let c = 0; c < cols; c++) {
      for (let rr = 0; rr < 3; rr++) {
        const slot = c * 3 + rr;
        const ax = CHEF_W + c * COL_W, z = ROWS_Z[rr];
        rb(ax + 0.55, 0.6, z, 0.64, 0.045, 1.24, 0.018, WOOD);
        b(ax + 0.55, 0.29, z - 0.57, 0.56, 0.58, 0.04, WOOD_D);
        b(ax + 0.55, 0.29, z + 0.57, 0.56, 0.58, 0.04, WOOD_D);
        b(ax + 0.28, 0.34, z, 0.03, 0.46, 1.1, WOOD_D);
        monitor(ax + 0.42, z, 0, 0.58, 'slot', slot);
        b(ax + 0.76, 0.635, z, 0.18, 0.022, 0.46, '#e8ebf0');
        const item = r();
        if (item < 0.3) pt(GEO.cyl, ax + 0.55, 0.675, z + 0.46, 0.09, 0.12, 0.09, POSTERS[(r() * POSTERS.length) | 0]);
        else if (item < 0.5) { pt(GEO.pot, ax + 0.45, 0.68, z - 0.46, 0.12, 0.1, 0.12, '#e9e4da'); pt(GEO.ico, ax + 0.45, 0.78, z - 0.46, 0.17, 0.15, 0.17, '#5aa85a', r() * 3); }
        else if (item < 0.7) b(ax + 0.62, 0.64, z + 0.42, 0.22, 0.04, 0.3, '#f5f3ee', r() - 0.5);
        // chair (backrest toward +x)
        const sx = ax + 1.2;
        pt(GEO.cyl, sx, 0.03, z, 0.52, 0.05, 0.52, METAL);
        pt(GEO.cyl, sx, 0.25, z, 0.06, 0.4, 0.06, METAL);
        rb(sx, 0.46, z, 0.5, 0.09, 0.5, 0.035, CHAIR_S);
        rb(sx + 0.25, 0.78, z, 0.09, 0.58, 0.48, 0.04, CHAIR);
        const hit = hitBox(g, X + ax + 0.75, 0.5, Z + z, 1.2, 1.0, 1.3);
        hit.userData.pick = { t: 'slot', room: it.id, slot };
      }
    }

    // dark overlay (sleeping room), yellow light beam and rings (your turn)
    const ovl = new THREE.Mesh(GEO.unit, MAT.ovl);
    ovl.scale.set(W + 2 * T + 0.06, H + 0.14, D + 2 * T + 0.06);
    ovl.position.set(X + W / 2, (H + 0.14) / 2, Z + D / 2);
    ovl.visible = false; ovl.renderOrder = 4;
    g.add(ovl);
    room.ovl = ovl;

    const beamMat = new THREE.MeshBasicMaterial({ color: YELLOW, vertexColors: true, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const beam = new THREE.Mesh(GEO.beam, beamMat);
    beam.position.copy(room.chefSeat); beam.visible = false; beam.renderOrder = 5; beam.userData.ownMat = true;
    g.add(beam);
    room.beam = beam;
    const discMat = new THREE.MeshBasicMaterial({ color: YELLOW, transparent: true, opacity: 0.32, depthWrite: false });
    const disc = new THREE.Mesh(GEO.disc, discMat);
    disc.position.copy(room.chefSeat).setY(0.03); disc.visible = false; disc.renderOrder = 2; disc.userData.ownMat = true;
    g.add(disc);
    room.disc = disc;
    room.rings = [0, 1].map(() => {
      const m = new THREE.Mesh(GEO.ring, new THREE.MeshBasicMaterial({ color: YELLOW, transparent: true, opacity: 0.7, depthWrite: false }));
      m.position.copy(room.chefSeat).setY(0.04); m.visible = false; m.renderOrder = 2; m.userData.ownMat = true;
      g.add(m);
      return m;
    });

    // pick boxes
    const fh = hitBox(g, X + W / 2, 0.03, Z + D / 2, W, 0.06, D);
    fh.userData.pick = { t: 'room', id: it.id };
    const ch = hitBox(g, X + 1.2, 0.5, Z + cz, 1.6, 1.0, 2.4);
    ch.userData.pick = { t: 'agent', id: it.id };
    const w1 = hitBox(g, X - T / 2, H / 2, Z + (D - T) / 2, T, H, D + T);
    w1.userData.pick = { t: 'block' };
    const w2 = hitBox(g, X + (W - T) / 2, H / 2, Z - T / 2, W + T, H, T);
    w2.userData.pick = { t: 'block' };

    return room;
  }

  // ---------------------------------------------------------- hall / lobby

  function buildHalls(B, g, items, areas) {
    const Wb = world.width, T = WALL_T, H = WALL_H;
    world.lobby = null;
    const endWall = '#e8dcc5', endCap = '#5b4636', endWain = '#b98a5c';
    world.halls.forEach((h, hi) => {
      const lobby = hi === world.halls.length - 1;
      const z0 = h.z0, z1 = h.z1, hd = z1 - z0;
      // floor: light stone tiles
      const fw = Wb + 0.3;
      const fg = new THREE.PlaneGeometry(fw, hd).rotateX(-Math.PI / 2);
      const fuv = fg.attributes.uv;
      for (let i = 0; i < fuv.count; i++) fuv.setXY(i, fuv.getX(i) * fw / 1.1, fuv.getY(i) * hd / 1.1);
      const floor = new THREE.Mesh(fg, MAT.hall);
      floor.position.set(fw / 2, 0.01, z0 + hd / 2);
      floor.receiveShadow = true;
      floor.userData.own = true;
      g.add(floor);
      // runner rug (runs left from the entrance)
      const rx0 = 0.5, rx1 = Wb + 0.3;
      B.box((rx0 + rx1) / 2, 0.016, h.lane, rx1 - rx0, 0.012, 1.08, '#c9a24e');
      B.box((rx0 + rx1) / 2, 0.02, h.lane, rx1 - rx0 - 0.08, 0.012, 0.94, '#4f7f93');
      // left end wall
      const ez0 = z0 - HALL_GAP, ez1 = z1 + T;
      B.box(-T / 2, H / 2, (ez0 + ez1) / 2, T, H, ez1 - ez0, endWall);
      B.box(-T / 2, H + 0.025, (ez0 + ez1) / 2, T + 0.03, 0.05, ez1 - ez0 + 0.03, endCap);
      B.box(0.012, 0.43, (z0 + z1) / 2, 0.024, 0.86, hd, endWain);
      B.box(0.022, 0.875, (z0 + z1) / 2, 0.044, 0.045, hd, '#f3ead9');
      // the open hall is the building's front facade: low wall
      if (h.open) {
        B.box((Wb - T) / 2, LOW_H / 2, z1 + T / 2, Wb + T, LOW_H, T, endWall);
        B.box((Wb - T) / 2, LOW_H + 0.02, z1 + T / 2, Wb + T + 0.03, 0.04, T + 0.03, endCap);
      }
      // entrance (right end): doormat and two planters
      B.box(Wb + 0.3, 0.02, h.lane, 0.55, 0.02, 1.3, '#3b3f48');
      for (const dz of [-1.05, 1.05]) {
        const pz = h.lane + dz;
        if (pz < z0 + 0.3 || pz > z1 - 0.3) continue;
        B.put(GEO.pot, Wb - 0.1, 0.24, pz, 0.4, 0.48, 0.4, '#d9d2c4');
        B.put(GEO.ico, Wb - 0.1, 0.72, pz, 0.56, 0.62, 0.56, '#4f9f55', pz);
        B.put(GEO.ico, Wb - 0.14, 1.0, pz + 0.04, 0.38, 0.42, 0.38, '#66b35d', pz * 2);
      }

      // furniture along the back edge: keep the doors that open onto the hall clear
      const busy = [];
      for (const it of items) if (it.hall === hi && it.door === 'front') busy.push([it.X + it.W - 1.0 - 0.85, it.X + it.W - 1.0 + 0.85]);
      for (const ar of areas) if (ar.hall === hi && ar.door === 'front') busy.push([ar.x + ar.w - 1.0 - 0.85, ar.x + ar.w - 1.0 + 0.85]);
      let cur = 0.35;
      const place = w => {
        let x = cur;
        for (let guard = 0; guard < 50; guard++) {
          const hit = busy.find(([a, b2]) => x < b2 && x + w > a);
          if (!hit) break;
          x = hit[1] + 0.05;
        }
        if (x + w > Wb - 1.4) return null;
        cur = x + w + 0.4;
        return x;
      };
      const bz = z0 + 0.55;
      const plant = x => {
        B.put(GEO.pot, x + 0.3, 0.22, bz, 0.4, 0.44, 0.4, '#c8704a');
        B.put(GEO.ico, x + 0.3, 0.72, bz, 0.62, 0.7, 0.62, '#4c9a4f', x);
        B.put(GEO.ico, x + 0.25, 1.05, bz + 0.05, 0.42, 0.44, 0.42, '#63b25c', x * 2);
      };
      if (lobby) {
        let x;
        if ((x = place(2.5)) != null) {                       // reception desk
          const cx = x + 1.25;
          B.box(cx, 0.5, bz, 2.4, 1.0, 0.62, '#f4f1ea');
          B.box(cx, 0.55, bz + 0.315, 2.2, 0.14, 0.012, '#35596b');
          B.rbox(cx, 1.025, bz, 2.54, 0.05, 0.74, 0.02, '#8a5a3a');
          B.box(cx - 0.55, 1.23, bz - 0.12, 0.5, 0.32, 0.04, BEZEL);
          B.box(cx - 0.55, 1.23, bz - 0.098, 0.44, 0.26, 0.006, '#7fb0e6');
          B.put(GEO.cyl, cx + 0.55, 1.07, bz + 0.12, 0.12, 0.05, 0.12, '#d9b25a');
          B.put(GEO.pot, cx + 0.95, 1.12, bz - 0.1, 0.18, 0.14, 0.18, '#e9e4da');
          B.put(GEO.ico, cx + 0.95, 1.26, bz - 0.1, 0.26, 0.24, 0.26, '#5aa85a', 1);
        }
        if ((x = place(0.6)) != null) plant(x);
        if ((x = place(1.4)) != null) {                       // coffee corner and water cooler
          B.box(x + 0.45, 0.42, bz, 0.9, 0.84, 0.5, '#8a5a3a');
          B.box(x + 0.45, 0.855, bz, 0.94, 0.03, 0.54, '#e9e4da');
          B.box(x + 0.3, 1.12, bz - 0.05, 0.4, 0.5, 0.36, '#2b2f38');
          B.box(x + 0.3, 1.22, bz + 0.135, 0.3, 0.12, 0.01, '#d8484a');
          B.put(GEO.cyl, x + 0.62, 0.92, bz + 0.1, 0.1, 0.1, 0.1, '#f7f4ee');
          B.put(GEO.cyl, x + 0.74, 0.92, bz + 0.02, 0.1, 0.1, 0.1, '#f7f4ee');
          B.box(x + 1.15, 0.42, bz, 0.34, 0.84, 0.34, '#e9edf2');
          B.box(x + 1.15, 0.86, bz, 0.3, 0.04, 0.3, '#cfd5de');
          B.put(GEO.cyl, x + 1.15, 1.07, bz, 0.26, 0.38, 0.26, '#8fd0ee');
        }
        if ((x = place(2.1)) != null) {                       // waiting chairs
          for (let k = 0; k < 3; k++) {
            const sx = x + 0.37 + k * 0.68;
            B.rbox(sx, 0.42, bz + 0.02, 0.62, 0.1, 0.56, 0.04, '#e07a5f');
            B.rbox(sx, 0.72, bz - 0.24, 0.62, 0.52, 0.09, 0.04, '#e07a5f');
          }
          B.box(x + 1.05, 0.2, bz, 2.05, 0.4, 0.5, '#4a505d');
        }
        if ((x = place(0.6)) != null) plant(x);
        // live summary board on the left end wall
        const sz0 = z0 + 0.35, sz1 = h.open ? z1 - 0.35 : z1 - 1.55;
        const sw = Math.min(4.2, sz1 - sz0), sh = 1.1, scz = sz0 + sw / 2, sy = 1.48;
        B.box(0.035, sy, scz, 0.05, sh + 0.14, sw + 0.14, '#1d222c');
        const cv = document.createElement('canvas');
        cv.height = 300; cv.width = Math.round(300 * sw / sh);
        const tex = new THREE.CanvasTexture(cv);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = aniso;
        const m = new THREE.MeshBasicMaterial({ map: tex });
        const scr = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), m);
        scr.rotation.y = Math.PI / 2;
        scr.position.set(0.064, sy, scz);
        scr.userData.own = true;
        scr.userData.dispose = () => { m.dispose(); tex.dispose(); };
        g.add(scr);
        world.lobby = { cv, tex, key: '' };
      } else {
        for (let k = 0; k < 8; k++) { const x = place(0.6); if (x == null) break; plant(x); cur += 5.5; }
      }
    });
    drawLobby();
  }

  function drawLobby() {
    const L = world.lobby;
    if (!L) return;
    const c = ctx.counts();
    const n = world.rooms.size;
    const stats = [[c.working + c.subs, msg('of.lobbyWorking'), '#4ade80'], [c.waiting, msg('of.lobbyWaiting'), YELLOW], [n, msg('of.lobbyRooms', { n }), '#a9bbd6']];
    const key = stats.map(x => x[0]).join('|');
    if (L.key === key) return;
    L.key = key;
    const g = L.cv.getContext('2d'), w = L.cv.width, h = L.cv.height;
    const bg = g.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#16202f'); bg.addColorStop(1, '#0c121c');
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,.05)';
    for (let y = 0; y < h; y += 6) g.fillRect(0, y, w, 2);
    g.fillStyle = '#8ea3c2';
    g.font = `700 ${Math.round(h * 0.11)}px ${SIGN_FONT}`;
    g.textBaseline = 'alphabetic';
    g.fillText(fitText(g, msg('of.lobby'), w - h * 0.28), h * 0.14, h * 0.2);
    const cw = (w - h * 0.2) / 3;
    stats.forEach(([v, label, col], i) => {
      const x = h * 0.14 + i * cw;
      g.fillStyle = col;
      g.font = `800 ${Math.round(h * 0.44)}px ${SIGN_FONT_D}`;
      g.fillText(String(v), x, h * 0.66);
      g.fillStyle = '#d7deea';
      g.font = `600 ${Math.round(h * 0.12)}px ${SIGN_FONT}`;
      g.fillText(fitText(g, label, cw - h * 0.06), x, h * 0.86);
    });
    if (c.waiting) {
      g.strokeStyle = YELLOW;
      g.lineWidth = 8;
      g.strokeRect(4, 4, w - 8, h - 8);
    }
    L.tex.needsUpdate = true;
  }

  // ---------------------------------------------------------- room sign: wall-mounted acrylic plaque

  function makeSign(g, room, x, y, z, w, h) {
    const cv = document.createElement('canvas');
    cv.height = SIGN_PX;
    cv.width = Math.min(2048, Math.round(SIGN_PX * w / h));
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = aniso;
    const face = new THREE.MeshBasicMaterial({ map: tex });
    const geo = new THREE.BoxGeometry(w, h, 0.06);
    const mesh = new THREE.Mesh(geo, [MAT.signSide, MAT.signSide, MAT.signSide, MAT.signSide, face, MAT.signSide]);
    mesh.position.set(x, y, z + 0.055);
    mesh.userData.own = true;
    mesh.userData.dispose = () => { face.dispose(); tex.dispose(); };
    mesh.userData.pick = { t: 'agent', id: room.id };
    g.add(mesh);
    world.pick.push(mesh);
    // your-turn lamp: blinks at the sign's top-right corner
    const lamp = new THREE.Mesh(GEO.lamp, new THREE.MeshBasicMaterial({ color: YELLOW }));
    lamp.position.set(x + w / 2 - 0.26, y + h / 2 + 0.005, z + 0.1);
    lamp.userData.ownMat = true;
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glow, color: YELLOW, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    halo.position.set(lamp.position.x, lamp.position.y + 0.06, lamp.position.z + 0.08);
    halo.scale.setScalar(1.1);
    halo.userData.ownMat = true;
    halo.renderOrder = 6;
    lamp.visible = halo.visible = false;
    g.add(lamp, halo);
    Object.assign(room, { signCv: cv, signTex: tex, signFace: face, signKey: '', lamp, halo, signPos: new THREE.Vector3(x, y, z + 0.1) });
  }

  function fitText(g, s, max) {
    if (g.measureText(s).width <= max) return s;
    let lo = 0, hi = s.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (g.measureText(s.slice(0, mid).trimEnd() + '…').width <= max) lo = mid; else hi = mid - 1;
    }
    return lo ? s.slice(0, lo).trimEnd() + '…' : '';
  }

  function drawSign(room, a) {
    paintPlaque(room.signCv, { name: a.project || msg('of.session'), title: a.title || a.name || '', color: a.color, status: a.status, overflow: room.overflow });
    room.signTex.needsUpdate = true;
  }

  // Wall sign: dark acrylic plaque in the project color, a colored band, a large name and a small second line.
  function paintPlaque(cv, o) {
    const g = cv.getContext('2d'), w = cv.width, h = cv.height;
    const st = o.status || '', wait = st === 'waiting' || st === 'ask';
    const col = o.color || '#9a9a9a';
    g.clearRect(0, 0, w, h);
    // plaque: a dark shade of the project color with a soft sheen at the top
    const bg = g.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, shade(col, -0.62));
    bg.addColorStop(1, shade(col, -0.78));
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    const gl = g.createLinearGradient(0, 0, 0, h * 0.55);
    gl.addColorStop(0, 'rgba(255,255,255,.13)');
    gl.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gl;
    g.fillRect(0, 0, w, h * 0.55);
    // project-color band and frame
    const band = Math.round(h * 0.11);
    g.fillStyle = col;
    g.fillRect(0, 0, band, h);
    g.fillStyle = 'rgba(255,255,255,.18)';
    g.fillRect(band, 0, 3, h);
    g.lineWidth = wait ? 12 : 7;
    g.strokeStyle = wait ? YELLOW : shade(col, 0.15);
    g.strokeRect(g.lineWidth / 2, g.lineWidth / 2, w - g.lineWidth, h - g.lineWidth);
    // screws
    g.fillStyle = 'rgba(255,255,255,.55)';
    for (const [sx, sy] of [[band + 22, 22], [w - 22, 22], [band + 22, h - 22], [w - 22, h - 22]]) {
      g.beginPath(); g.arc(sx, sy, 6, 0, Math.PI * 2); g.fill();
    }
    // top-right badge: your turn / asleep / +N
    let badgeW = 0;
    const badge = (txt, fill, ink) => {
      g.font = `700 ${Math.round(h * 0.15)}px ${SIGN_FONT}`;
      const tw = g.measureText(txt).width, bh = Math.round(h * 0.25), bw = tw + h * 0.16;
      const bx = w - bw - h * 0.12 - badgeW, by = Math.round(h * 0.1);
      g.fillStyle = fill;
      g.beginPath(); g.roundRect(bx, by, bw, bh, bh / 2); g.fill();
      g.fillStyle = ink;
      g.textBaseline = 'middle';
      g.fillText(txt, bx + h * 0.08, by + bh / 2 + 1);
      badgeW += bw + h * 0.05;
    };
    if (wait) badge(msg(st === 'ask' ? 'of.badgeAsk' : 'of.badgeWait'), YELLOW, '#1b1405');
    else if (st === 'dormant') badge(msg('of.badgeSleep'), 'rgba(255,255,255,.16)', 'rgba(255,255,255,.75)');
    if (o.overflow) badge(`+${o.overflow}`, 'rgba(255,255,255,.2)', '#ffffff');
    // text
    const x0 = band + h * 0.2, right = w - h * 0.14;
    g.textBaseline = 'alphabetic';
    g.fillStyle = '#ffffff';
    let fs = Math.round(h * 0.47);
    g.font = `700 ${fs}px ${SIGN_FONT_D}`;
    const nameMax = right - x0 - (badgeW ? badgeW + h * 0.06 : 0);
    const name = o.name || '';
    while (fs > h * 0.28 && g.measureText(name).width > nameMax) { fs -= 4; g.font = `700 ${fs}px ${SIGN_FONT_D}`; }
    g.fillText(fitText(g, name, nameMax), x0, h * 0.56);
    g.fillStyle = 'rgba(236,240,247,.78)';
    g.font = `500 ${Math.round(h * 0.21)}px ${SIGN_FONT}`;
    g.fillText(fitText(g, o.title || '', right - x0), x0, h * 0.85);
  }

  // ---------------------------------------------------------- optional local decorations (not in git)
  // Loaded if local/ofis-extras.js exists next to the page. The module asks for space with `areas`:
  //   [{ id, w, row: 'last' | 'first' }]  → 'last' = start of the last row (bottom-left front corner), 'first' = start of the first row.
  // The layout reserves these areas and calls `decorate(api)`; api.areas[id] draws in that area's local coordinates.

  /**
   * Local plugin contract. `decorate(api)` is called on every rebuild (it may be async); the plugin puts its
   * objects into `api.group`, a lot group or `api.areas[id].group` (never directly into the scene),
   * so they are cleaned up on rebuild. Units match the office: 1 unit ≈ 1 meter, y = 0 is the floor.
   * The camera looks from the +x +z side: on screen +x is down-right, +z down-left, -x up-left, -z up-right.
   *
   * api.THREE, api.scene, api.group, api.unit (=1), api.wallH, api.roomD
   * api.lot({ key, width, depth, side }) → THREE.Group
   *     side: 'front' (+z, bottom-left of the screen) | 'back' (-z, top-right) | 'left' (-x, top-left) | 'right' (+x, bottom-right).
   *     width runs along the edge, depth away from the building. The group is not rotated: local x ∈ [0, size.x], z ∈ [0, size.z]
   *     (group.userData.size; size = {x: width, z: depth} for front/back, {x: depth, z: width} for left/right).
   *     Lots on the same side are laid out next to each other; a ground plinth is drawn; framing and shadows cover them all.
   * api.person({ skin, hair, hairStyle 0-4, shirt, pants, skirt, sleeve, blush, pose }) → figure
   *     pose: 'stand' | 'sit' | 'sleep' | 'salute' | 'wave'; figure.setPose(p), figure.root (you add it to a group).
   *     'sit': hips at y≈0.5 (chair seat ~0.45). 'sleep': lies on its back along the z axis, root.position.y = top of the bed.
   * api.sign(text, { sub, color, width, height }) → wall sign facing +z (Mesh); same style as the office signs.
   * api.nameTag(object3d, text) → office-style name tag below the object (follows it every frame).
   * api.tooltip(object3d, html) → tooltip on hover.
   * api.onFrame(fn) → fn(tSeconds, dt) on every frame.
   * api.batch(group) → { box, rbox, cyl, pot, blob }: vertex-colored geometry merged into one mesh in the group's local space.
   * api.mat(hex) (shared Lambert), api.material(m) (disposed on rebuild), api.palette, api.shade(hex, t),
   * api.fonts, api.geo, api.rounded(w, h, d, r), api.canvasTexture(w, h, draw).
   * api.areas[id]: the areas the module reserved inside the building via `areas` (start of a row; facing the hall).
   *
   * Interaction (for interactive add-ons; everything below is optional and a no-op when unused):
   * api.camera (THREE.OrthographicCamera; zoom = screen pixels per unit), api.renderer (THREE.WebGLRenderer),
   * api.dom: the office view's root element (for overlay UI and cursor classes). Pointer events on elements the module
   *     adds to it bubble into the office handlers (pan, click); stop their propagation to keep them out.
   * api.bounds → { x0, x1, z0, z1 }: ground area of the building and the lots (a copy), or null before the first build.
   * api.footprint → [{ x0, x1, z0, z1 }]: the rectangles that actually have a floor (the building and each lot);
   *     api.bounds is their bounding box, which can include empty corners.
   * api.pickGround(clientX, clientY, y = 0) → THREE.Vector3 where the view ray under that screen point meets the
   *     horizontal plane at height y (world coordinates), or null.
   * api.onPointer(fn) → fn(type, event) with type 'move' | 'click' | 'dblclick' | 'leave' on the office view.
   *     'move' fires for pointer moves that are not a drag; 'click' for a press released without dragging.
   *     Return true to take the event over: the default action (hover tooltip, opening the drawer, resetting the view)
   *     is skipped. Registered per build, like onFrame.
   *     Drags: 'down' on every primary press (a notice). When the press moves past a few pixels, 'dragstart' is asked:
   *     return true to own that drag, and it no longer pans the view; its moves then come as 'drag' and its end as
   *     'drop' (released) or 'cancel'. A press the module did not own ends with 'up' (before any 'click').
   * api.shake(px): shakes the camera by about px screen pixels; decays in about half a second, calls add up.
   * api.wake(): counts as user activity, so the adaptive frame rate stays at full speed (call it while an animation runs).
   * api.figures() → [{ root, hip, upper, head, armL, armR, legL, legR, staff }]: every person in the office right now,
   *     the agents (staff: true) and the people made with api.person / area.person (staff: false). The office sets the
   *     staff poses every frame before onFrame callbacks run, so temporary offsets written in onFrame are safe.
   * api.pickFigure(clientX, clientY) → the person under that screen point (same shape as an api.figures() entry, plus
   *     id for an agent), or null. Tall walls in front hide the people behind them.
   * api.seatOf(figure) → { x, z, aisleX, room } for a seated agent: its seat and the walking line in front of the desk
   *     (world coordinates), or null (not an agent, or walking in or out).
   * api.layout() → { width, depth, entryX, halls: [{ z0, z1, lane }], rooms: [{ id, x0, x1, z0, z1, door, doorX, hall }] }:
   *     the building interior is x ∈ [0, width], z ∈ [0, depth]. Halls run along x; lane is their walking line and each
   *     hall is entered from outside at x = entryX. rooms lists the office rooms and the walled local areas; each one has
   *     its door at x = doorX on the hall side (z0 for door 'back', z1 for 'front'), opening onto halls[hall].
   * api.openDoorsNear(x, z): call it every frame while something walks through a door; the doors near that point open
   *     as they do for the agents.
   * api.fitInclude(object3d | box3): keeps that object (the world corners of its meshes' bounding boxes, read whenever
   *     the view is fitted) inside the "fit" framing and the pan limits, e.g. something floating high above the building.
   *     Registered per build.
   * api.rooms() → [{ id, status, since, center: { x, y, z }, rect: { x0, x1, z0, z1 }, chief, errorAt }]: the rooms of
   *     the current layout, one per live session. status and since come from the store (the same values the signs
   *     show); center is the middle of the room floor and rect its floor area, in world coordinates; chief is the
   *     world position { x, y, z } of the session's main agent character, or null; errorAt is when the newest failed
   *     tool call of the session (its main agent or one of its subagents) ended, or 0. Times are store times in ms,
   *     comparable with api.now().
   * api.now() → the current store time in ms.
   * api.tool → the name of the active exclusive tool (an interaction mode of a local add-on, e.g. one that takes over
   *     clicks), or null.
   * api.setTool(name | null): makes that tool the active one (null: none). Every onToolChange listener is told, so
   *     the other tools can switch themselves off. Kept across rebuilds; also mirrored as data-tool on api.dom.
   * api.onToolChange(fn) → fn(name, prev) whenever the active tool changes. Registered per build, like onFrame.
   *
   * Roads (the surroundings, ofis-env.js; world coordinates, n = -z, s = +z, e = +x, w = -x):
   * api.connectRoad({ x, z, dir: 'n' | 's' | 'e' | 'w' | { x, z }, width = 3.2, key }) → { key, points: [{ x, z }, ...],
   *     junction: { x, z }, width } | null: links a road leaving a lot at the mouth (x, z) to the nearest main road
   *     (junction, curb cut, zebra; trees and decorations keep out). points run from the mouth to the junction on the main
   *     road's centerline. The object is live (updated in place after every layout). Register again on every build.
   * api.roadNetwork() → [[{ x, z }, ...], ...]: main road centerlines; one lane each way, right-hand traffic, lane
   *     centers 1.55 to the right of the centerline.
   * api.onRoadsChange(fn) → fn({ network, roads }) after every layout of the surroundings. Registered per build.
   */
  function runExtras(g, areas) {
    const batches = [];
    const lotCur = { front: 0, back: 0, left: 0, right: 0 };
    const tips = [];
    const people = [];
    const root3 = new THREE.Group();
    g.add(root3);
    const LOT_GAP = 1.4;
    const api = {
      THREE, scene, group: root3, unit: 1, wallH: WALL_H, gap: GAP, roomD: ROOM_D,
      fonts: { text: SIGN_FONT, display: SIGN_FONT_D }, shade, rounded,
      palette: {
        skins: SKINS, hairs: HAIRS, pants: PANTS, wood: WOOD, woodDark: WOOD_D, metal: METAL, chair: CHAIR, chairSeat: CHAIR_S,
        bezel: BEZEL, books: BOOKS, posters: POSTERS, walls: THEMES.map(t => t.wall), floors: THEMES.map(t => t.floor), yellow: YELLOW,
      },
      mat: hex => mat(hex),
      material(m) { extraMats.push(m); return m; },
      geo: { box: GEO.unit, cyl: GEO.cyl, pot: GEO.pot, sphere: GEO.head, ico: GEO.ico, torso: GEO.torso, arm: GEO.arm, leg: GEO.leg, hair: GEO.hair, hairLong: GEO.hairLong, hand: GEO.hand, eye: GEO.eye },
      canvasTexture(w, h, draw) {
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        draw(cv.getContext('2d'), w, h);
        const t = new THREE.CanvasTexture(cv);
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = aniso;
        extraMats.push(t);
        return t;
      },
      onFrame(fn) { extraFrame.push(fn); },
      batch(group) {
        const B = new Batch();
        batches.push({ B, grp: group || root3 });
        return {
          box: (x, y, z, sx, sy, sz, color, ry = 0) => B.box(x, y, z, sx, sy, sz, color, ry),
          rbox: (x, y, z, sx, sy, sz, r, color, ry = 0) => B.rbox(x, y, z, sx, sy, sz, r, color, ry),
          cyl: (x, y, z, dia, h, color, rx = 0, rz = 0) => B.put(GEO.cyl, x, y, z, dia, h, dia, color, 0, rx, rz),
          pot: (x, y, z, dia, h, color) => B.put(GEO.pot, x, y, z, dia, h, dia, color),
          blob: (x, y, z, sx, sy, sz, color, ry = 0) => B.put(GEO.ico, x, y, z, sx, sy, sz, color, ry),
        };
      },
      lot({ key = '', width = 8, depth = 8, side = 'front' } = {}) {
        const sd = ['front', 'back', 'left', 'right'].includes(side) ? side : 'front';
        const wd = clamp(Number(width) || 8, 1, 80), dp = clamp(Number(depth) || 8, 1, 80);
        const bb = world.baseBounds;
        const cur = lotCur[sd];
        let x0, z0, sx, sz;
        if (sd === 'front') { sx = wd; sz = dp; x0 = bb.x0 + cur; z0 = bb.z1 + LOT_GAP; }
        else if (sd === 'back') { sx = wd; sz = dp; x0 = bb.x0 + cur; z0 = bb.z0 - LOT_GAP - dp; }
        else if (sd === 'right') { sx = dp; sz = wd; x0 = bb.x1 + LOT_GAP; z0 = bb.z0 + cur; }
        else { sx = dp; sz = wd; x0 = bb.x0 - LOT_GAP - dp; z0 = bb.z0 + cur; }
        lotCur[sd] = cur + wd + LOT_GAP;
        // plinth: extends toward the building and half a gap to each side, so the lots and the building form one campus
        const h = LOT_GAP, hh = LOT_GAP / 2;
        let bx0 = x0, bx1 = x0 + sx, bz0 = z0, bz1 = z0 + sz;
        if (sd === 'front') { bz0 -= h; bx0 -= hh; bx1 += hh; }
        else if (sd === 'back') { bz1 += h; bx0 -= hh; bx1 += hh; }
        else if (sd === 'right') { bx0 -= h; bz0 -= hh; bz1 += hh; }
        else { bx1 += h; bz0 -= hh; bz1 += hh; }
        const pw = bx1 - bx0, pd = bz1 - bz0;
        const pg = new THREE.PlaneGeometry(pw, pd).rotateX(-Math.PI / 2);
        const puv = pg.attributes.uv;
        for (let i = 0; i < puv.count; i++) puv.setXY(i, puv.getX(i) * pw / 1.2, puv.getY(i) * pd / 1.2);
        const plane = new THREE.Mesh(pg, MAT.slab);
        plane.position.set((bx0 + bx1) / 2, -0.002, (bz0 + bz1) / 2);
        plane.receiveShadow = true;
        plane.userData.own = true;
        g.add(plane);
        const base = new THREE.Mesh(new THREE.BoxGeometry(pw, 0.46, pd), mat('#4a5163'));
        base.position.set((bx0 + bx1) / 2, -0.235, (bz0 + bz1) / 2);
        base.userData.own = true;
        g.add(base);
        world.lots.push({ x0: bx0, x1: bx1, z0: bz0, z1: bz1 });
        const grp = new THREE.Group();
        grp.position.set(x0, 0, z0);
        grp.userData.size = { x: sx, z: sz };
        grp.userData.key = key;
        grp.userData.side = sd;
        g.add(grp);
        return grp;
      },
      person(o = {}) {
        const f = buildFigure({
          skin: o.skin || SKINS[0], hair: o.hair || HAIRS[0], style: o.hairStyle ?? o.style ?? 0,
          pants: o.pants || PANTS[0], shirt: o.shirt || '#5b8fb8', sleeve: o.sleeve, skirt: o.skirt, blush: o.blush,
        });
        f.pose = o.pose || 'stand';
        f.ph = Math.random() * 6.28;
        f.setPose = p => { f.pose = p; };
        people.push(f);
        extraFigs.push(f);
        return f;
      },
      sign(text, o = {}) {
        const sh = o.height || SIGN_H;
        const sw = o.width || clamp(1.6 + String(text).length * 0.3, 2.4, 6);
        const cv = document.createElement('canvas');
        cv.height = SIGN_PX; cv.width = Math.min(2048, Math.round(SIGN_PX * sw / sh));
        paintPlaque(cv, { name: String(text), title: o.sub || '', color: o.color || '#5b8fb8' });
        const tex = new THREE.CanvasTexture(cv);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = aniso;
        const face = new THREE.MeshBasicMaterial({ map: tex });
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(sw, sh, 0.06), [MAT.signSide, MAT.signSide, MAT.signSide, MAT.signSide, face, MAT.signSide]);
        mesh.userData.own = true;
        mesh.userData.dispose = () => { face.dispose(); tex.dispose(); };
        return mesh;
      },
      nameTag(obj, text) {
        const L = mkLabel('of-tagl', 45, 'down', 3, 12);
        setLabel(L, `<div class="of-tag">${esc(text)}</div>`);
        extraLabels.push(L);
        const wp = new THREE.Vector3();
        extraFrame.push(() => { obj.getWorldPosition(wp); L.pos.copy(wp); L.want = obj.visible !== false; });
        return L;
      },
      tooltip(obj, html) { tips.push([obj, html]); },
      areas: {},
      camera, renderer, dom: root,
      get bounds() { return world.bounds ? { ...world.bounds } : null; },
      get footprint() { return [world.baseBounds, ...(world.lots || [])].filter(Boolean).map(b => ({ x0: b.x0, x1: b.x1, z0: b.z0, z1: b.z1 })); },
      pickGround(cx, cy, y = 0) {
        const r = root.getBoundingClientRect();
        gNdc.set((cx - r.left) / vw * 2 - 1, -((cy - r.top) / vh) * 2 + 1);
        gRay.setFromCamera(gNdc, camera);
        gPlane.set(gUp, -(Number(y) || 0));
        return gRay.ray.intersectPlane(gPlane, new THREE.Vector3());
      },
      onPointer(fn) { if (typeof fn === 'function') extraPointer.push(fn); },
      shake(px) { shakeAmp = clamp(shakeAmp + (Number(px) || 0), 0, 40); },
      wake() { lastInput = performance.now(); },
      figures() {
        const out = [];
        for (const c of chars.values()) out.push({ root: c.root, hip: c.hip, upper: c.upper, head: c.head, armL: c.armL, armR: c.armR, legL: c.legL, legR: c.legR, staff: true });
        for (const f of extraFigs) out.push({ root: f.root, hip: f.hip, upper: f.upper, head: f.head, armL: f.armL, armR: f.armR, legL: f.legL, legR: f.legR, staff: false });
        return out;
      },
      pickFigure(cx, cy) {
        const r = root.getBoundingClientRect();
        gNdc.set((cx - r.left) / vw * 2 - 1, -((cy - r.top) / vh) * 2 + 1);
        gRay.setFromCamera(gNdc, camera);
        // a tall wall in front hides the people behind it
        const walls = world.pick.filter(o => o.userData.pick && o.userData.pick.t === 'block');
        const wh = walls.length ? gRay.intersectObjects(walls, false)[0] : null;
        let best = null, bd = wh ? wh.distance : Infinity;
        const test = (f, staff, id) => {
          if (!f.root.parent || f.root.visible === false) return;
          f.hip.getWorldPosition(gV1);
          const s = f.root.getWorldScale(gV2).y;
          gBox.min.set(gV1.x - 0.34 * s, gV1.y - 0.5 * s, gV1.z - 0.34 * s);
          gBox.max.set(gV1.x + 0.34 * s, gV1.y + 1.1 * s, gV1.z + 0.34 * s);
          if (!gRay.ray.intersectBox(gBox, gV3)) return;
          const d = gV3.distanceTo(gRay.ray.origin);
          if (d < bd) { bd = d; best = { f, staff, id }; }
        };
        for (const c of chars.values()) test(c, true, c.id);
        for (const f of extraFigs) test(f, false, null);
        if (!best) return null;
        const f = best.f;
        return { root: f.root, hip: f.hip, upper: f.upper, head: f.head, armL: f.armL, armR: f.armR, legL: f.legL, legR: f.legR, staff: best.staff, id: best.id };
      },
      seatOf(fig) {
        for (const c of chars.values()) {
          if (!fig || c.root !== fig.root) continue;
          const room = world.rooms.get(c.roomId);
          if (!room || c.mode !== 'seated' || c.after === 'gone') return null;
          if (c.main) return { x: room.chefSeat.x, z: room.chefSeat.z, aisleX: room.chefSeat.x + 0.7, room: room.id };
          if (c.slot < 0) return null;
          const s = slotGeom(room, c.slot);
          return { x: s.seat.x, z: s.seat.z, aisleX: s.aisle, room: room.id };
        }
        return null;
      },
      layout() {
        const rooms = [];
        for (const r of world.rooms.values()) rooms.push({ id: r.id, x0: r.X, x1: r.X + r.W, z0: r.Z, z1: r.Z + ROOM_D, door: r.door, doorX: r.doorX, hall: r.hall });
        for (const a of world.areaList || []) {
          if (a.walled) rooms.push({ id: a.id, x0: a.x, x1: a.x + a.w, z0: a.z, z1: a.z + ROOM_D, door: a.door, doorX: a.x + a.w - 1.0, hall: a.hall });
        }
        const halls = (world.halls || []).map(h => ({ z0: h.z0, z1: h.z1, lane: h.lane }));
        return { width: world.width || 0, depth: world.depth || 0, entryX: world.entryX || 0, halls, rooms };
      },
      openDoorsNear(x, z) { doorWalkers.push(Number(x) || 0, Number(z) || 0); },
      fitInclude(t) { if (world.group === g && t && (t.isObject3D || t.isBox3)) world.fitExtra.push(t); },
      rooms() {
        const out = [];
        for (const room of world.rooms.values()) {
          const a = store.agents.get(room.id);
          if (!a) continue;
          let errorAt = 0;
          for (const id of [a.id, ...(a.subs || [])]) {
            const evs = (typeof store.events === 'function' && store.events(id)) || [];
            for (let i = evs.length - 1; i >= 0; i--) if (evs[i].x === 1) { errorAt = Math.max(errorAt, evs[i].e || evs[i].s || 0); break; }
          }
          const c = chars.get(room.id), cp = c && c.root.position;
          out.push({
            id: room.id, status: a.status, since: a.since, errorAt,
            center: { x: room.X + room.W / 2, y: 0, z: room.Z + ROOM_D / 2 },
            rect: { x0: room.X, x1: room.X + room.W, z0: room.Z, z1: room.Z + ROOM_D },
            chief: cp ? { x: cp.x, y: cp.y, z: cp.z } : null,
          });
        }
        return out;
      },
      now() { return store.now(); },
      get tool() { return activeTool; },
      setTool(name) {
        const n = name ? String(name) : null;
        if (n === activeTool) return;
        const prev = activeTool;
        activeTool = n;
        if (n) root.dataset.tool = n; else delete root.dataset.tool;
        for (const fn of toolFns.slice()) { try { fn(n, prev); } catch { /* add-on hook */ } }
      },
      onToolChange(fn) { if (typeof fn === 'function') toolFns.push(fn); },
      // connectRoad, roadNetwork, onRoadsChange: roads from the lots to the main street (see ofis-env.js)
      ...env.roadApi(() => ({ base: world.baseBounds, lots: world.lots || [] })),
    };
    for (const ar of areas) api.areas[ar.id] = areaApi(g, ar, batches);

    // subtle idle motion for posed people
    extraFrame.push((T, dt) => {
      const k = Math.min(1, dt * 8);
      for (const f of people) {
        const p = f.pose, ph = f.ph;
        const L = (o, prop, v) => { o[prop] += (v - o[prop]) * k; };
        f.hip.rotation.x = p === 'sleep' ? -Math.PI / 2 : 0;
        f.hip.position.y = p === 'sleep' ? 0.16 : p === 'sit' ? 0.5 : 0.42;
        const legs = p === 'sit' ? -1.5 : 0;
        f.legL.rotation.x = f.legR.rotation.x = legs;
        L(f.upper.rotation, 'x', p === 'sit' ? 0.04 : Math.sin(T * 1.4 + ph) * 0.015);
        L(f.head.rotation, 'x', p === 'sleep' ? 0 : Math.sin(T * 0.9 + ph) * 0.04);
        if (p === 'wave') { L(f.armR.rotation, 'z', -2.45 + Math.sin(T * 8 + ph) * 0.38); L(f.armR.rotation, 'x', -0.25); }
        else if (p === 'salute') { L(f.armR.rotation, 'x', -2.55); L(f.armR.rotation, 'z', 0.75); }
        else if (p === 'sleep') { L(f.armR.rotation, 'x', 0); L(f.armR.rotation, 'z', 0.12); }
        else if (p === 'sit') { L(f.armR.rotation, 'x', -0.55); L(f.armR.rotation, 'z', 0.1); }
        else { L(f.armR.rotation, 'x', Math.sin(T * 1.2 + ph) * 0.05); L(f.armR.rotation, 'z', 0.08); }
        L(f.armL.rotation, 'x', p === 'sit' ? -0.55 : p === 'sleep' ? 0 : Math.sin(T * 1.2 + ph + 1) * 0.05);
        L(f.armL.rotation, 'z', p === 'sleep' ? -0.12 : -0.08);
      }
    });

    const finish = () => {
      if (world.group !== g) return;               // rebuilt in the meantime: drop the stale one
      for (const { B, grp } of batches.splice(0)) {
        if (!B.v) continue;
        const m = new THREE.Mesh(B.build(), MAT.stat);
        m.castShadow = m.receiveShadow = true;
        m.userData.own = true;
        grp.add(m);
      }
      g.updateMatrixWorld(true);
      for (const [obj, html] of tips.splice(0)) {
        if (obj.isMesh) { obj.userData.pick = { t: 'extra', html }; world.pick.push(obj); continue; }
        const box = new THREE.Box3().setFromObject(obj);
        if (box.isEmpty()) continue;
        const c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
        const hb = hitBox(g, c.x, c.y, c.z, sz.x, sz.y, sz.z);
        hb.userData.pick = { t: 'extra', html };
      }
      applyBounds();
    };
    let ret;
    try { ret = extras.mod.decorate(api); } catch (err) { root.dataset.ekHata = String((err && err.message) || err); }
    if (ret && typeof ret.then === 'function') {
      finish();                                     // show the synchronous part right away
      ret.then(finish, err => { root.dataset.ekHata = String((err && err.message) || err); finish(); });
    } else finish();
  }

  function areaApi(g, ar, batches) {
    const grp = new THREE.Group();
    grp.position.set(ar.x, 0, ar.z);
    g.add(grp);
    const B = new Batch();
    batches.push({ B, grp });
    const own = obj => { obj.userData.own = true; return obj; };
    return {
      id: ar.id, w: ar.w, d: ROOM_D, door: ar.door, doorX: ar.w - 1.0, group: grp, origin: { x: ar.x, z: ar.z },
      // merged static geometry (one draw call, vertex-colored, shadowed)
      box: (x, y, z, sx, sy, sz, color, ry = 0) => B.box(x, y, z, sx, sy, sz, color, ry),
      rbox: (x, y, z, sx, sy, sz, r, color, ry = 0) => B.rbox(x, y, z, sx, sy, sz, r, color, ry),
      cyl: (x, y, z, dia, h, color, rx = 0, rz = 0) => B.put(GEO.cyl, x, y, z, dia, h, dia, color, 0, rx, rz),
      pot: (x, y, z, dia, h, color) => B.put(GEO.pot, x, y, z, dia, h, dia, color),
      blob: (x, y, z, sx, sy, sz, color, ry = 0) => B.put(GEO.ico, x, y, z, sx, sy, sz, color, ry),
      // same shell as the office rooms: carpet, walls, a door facing the hall and an optional wall sign
      shell(o = {}) {
        ar.walled = true;                          // walls and a door: api.layout lists it like a room
        const th = { wall: o.wall || '#e6cf9f', floor: o.floor || '#5aa877' };
        const sh = buildShell(B, grp, 0, 0, ar.w, ROOM_D, th, ar.door);
        if (o.sign) {
          const sw = Math.min(sh.signX1 - sh.signX0, o.sign.width || 5.4), sx = sh.signX0 + sw / 2 + 0.2;
          const cv = document.createElement('canvas');
          cv.height = SIGN_PX; cv.width = Math.min(2048, Math.round(SIGN_PX * sw / SIGN_H));
          paintPlaque(cv, o.sign);
          const tex = new THREE.CanvasTexture(cv);
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.anisotropy = aniso;
          const face = new THREE.MeshBasicMaterial({ map: tex });
          const mesh = new THREE.Mesh(new THREE.BoxGeometry(sw, SIGN_H, 0.06), [MAT.signSide, MAT.signSide, MAT.signSide, MAT.signSide, face, MAT.signSide]);
          mesh.position.set(sx, SIGN_Y, 0.055);
          mesh.userData.own = true;
          mesh.userData.dispose = () => { face.dispose(); tex.dispose(); };
          grp.add(mesh);
          B.box(sx, SIGN_Y, 0.012, sw + 0.1, SIGN_H + 0.1, 0.024, sh.cap);
          sh.signX0 = sx - sw / 2; sh.signX1b = sx + sw / 2;
        }
        return sh;
      },
      // a person in the same style as the office staff; the module sets the pose in its own frame callback
      person(o = {}) {
        const f = buildFigure({
          skin: o.skin || SKINS[0], hair: o.hair || HAIRS[0], style: o.style || 0, pants: o.pants || PANTS[0],
          shirt: o.shirt || '#5b8fb8', sleeve: o.sleeve, skirt: o.skirt, blush: o.blush,
        });
        grp.add(f.root);
        extraFigs.push(f);
        return f;
      },
      add(obj, shadow = true) {
        grp.add(obj);
        obj.traverse(m => { if (m.isMesh) { m.castShadow = shadow; m.receiveShadow = true; if (!m.userData.shared) m.userData.own = true; } });
        return obj;
      },
      canvasPlane(pw, ph, px, draw) {
        const cv = document.createElement('canvas');
        cv.height = px; cv.width = Math.min(2048, Math.round(px * pw / ph));
        draw(cv.getContext('2d'), cv.width, cv.height);
        const tex = new THREE.CanvasTexture(cv);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = aniso;
        const m = new THREE.MeshBasicMaterial({ map: tex });
        const mesh = own(new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), m));
        mesh.userData.dispose = () => { m.dispose(); tex.dispose(); };
        grp.add(mesh);
        return mesh;
      },
      glow(color, size) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glow, color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
        sp.scale.setScalar(size); sp.renderOrder = 6; sp.userData.ownMat = true;
        grp.add(sp);
        return sp;
      },
      beam(color, height, r0, r1, opacity = 0.2) {
        const m = new THREE.MeshBasicMaterial({ color, vertexColors: true, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
        const mesh = new THREE.Mesh(GEO.beam, m);
        mesh.scale.set(r1 / 0.95, height / 6, r1 / 0.95);
        mesh.userData.ownMat = true; mesh.renderOrder = 5;
        grp.add(mesh);
        return mesh;
      },
      label(html, x, y, z, o = {}) {
        const L = mkLabel(o.cls || '', o.pri ?? 80, o.mode || 'down', o.gap ?? 4, o.minZoom || 0);
        if (o.maxZoom) L.maxZoom = o.maxZoom;
        L.pos.set(ar.x + x, y, ar.z + z);
        setLabel(L, html);
        extraLabels.push(L);
        return L;
      },
      hover(x, y, z, sx, sy, sz, html) {
        const hb = hitBox(grp, x, y, z, sx, sy, sz);
        hb.userData.pick = { t: 'extra', html };
        return hb;
      },
    };
  }

  function hitBox(g, x, y, z, w, h, d) {
    const m = new THREE.Mesh(GEO.unit, MAT.stat);
    m.scale.set(w, h, d);
    m.position.set(x, y, z);
    m.visible = false;
    g.add(m);
    world.pick.push(m);
    return m;
  }

  // ---------------------------------------------------------- characters

  function shirtFor(id, base, main) {
    if (main) return base;
    const k = ((hash(id + 'g') % 7) - 3) * 0.1;
    return shade(base, k);
  }

  // Cute cartoon person: everyone in the office and the local add-ons use the same figure.
  function buildFigure(o) {
    const M = (geo, col, shadow) => { const m = new THREE.Mesh(geo, mat(col)); m.castShadow = !!shadow; return m; };
    const root = new THREE.Group();
    const hip = new THREE.Group(); root.add(hip);
    const legL = M(GEO.leg, o.pants, true); legL.position.x = 0.1; hip.add(legL);
    const legR = M(GEO.leg, o.pants, true); legR.position.x = -0.1; hip.add(legR);
    const upper = new THREE.Group(); hip.add(upper);
    const torso = M(GEO.torso, o.shirt, true); torso.position.y = 0.25; upper.add(torso);
    if (o.skirt) { const sk = M(GEO.pot, o.skirt, true); sk.scale.set(0.5, 0.34, 0.4); sk.rotation.x = Math.PI; sk.position.y = -0.06; hip.add(sk); }
    const mkArm = x => {
      const a = new THREE.Group(); a.position.set(x, 0.42, 0);
      a.add(M(GEO.arm, o.sleeve || o.shirt, true));
      const hand = M(GEO.hand, o.skin); hand.position.y = -0.34; a.add(hand);
      upper.add(a);
      return a;
    };
    const armL = mkArm(0.27), armR = mkArm(-0.27);
    const head = new THREE.Group(); head.position.y = 0.72; upper.add(head);
    head.add(M(GEO.head, o.skin, true));
    const hair = M(GEO.hair, o.hair, true); hair.rotation.x = -0.38; head.add(hair);
    if (o.style === 1) { const bun = M(GEO.bun, o.hair, true); bun.position.set(0, 0.2, -0.17); head.add(bun); }
    if (o.style === 2) { const lh = M(GEO.hairLong, o.hair, true); lh.position.set(0, -0.12, -0.15); head.add(lh); }
    if (o.style === 3) hair.scale.set(1.04, 1.25, 1.04);
    if (o.style === 4) {
      const lh = M(GEO.hairLong, o.hair, true); lh.position.set(0, -0.2, -0.15); lh.scale.set(1.05, 1.35, 1.1); head.add(lh);
      for (const x of [0.2, -0.2]) { const side = M(GEO.hairLong, o.hair, true); side.scale.set(0.2, 1.05, 1.4); side.position.set(x, -0.16, -0.05); head.add(side); }
    }
    for (const x of [0.09, -0.09]) { const e = M(GEO.eye, '#23252d'); e.position.set(x, -0.005, 0.228); head.add(e); }
    if (o.blush) for (const x of [0.14, -0.14]) { const b = M(GEO.eye, '#f09a9a'); b.scale.set(1.3, 0.8, 0.5); b.position.set(x, -0.075, 0.2); head.add(b); }
    return { root, hip, upper, head, armL, armR, legL, legR };
  }

  function makeChar(id, main, shirt) {
    const h = hash(id);
    const f = buildFigure({ skin: SKINS[h % SKINS.length], hair: HAIRS[(h >>> 4) % HAIRS.length], style: (h >>> 9) % 4, pants: PANTS[(h >>> 12) % PANTS.length], shirt });
    const { root, hip, upper, head, armL, armR, legL, legR } = f;
    const M = (geo, col, shadow) => { const m = new THREE.Mesh(geo, mat(col)); m.castShadow = !!shadow; return m; };
    if (main) {
      const band = M(GEO.band, '#2b2f3a'); band.position.y = 0.02; head.add(band);
      for (const x of [0.27, -0.27]) { const cp = M(GEO.cup, '#2b2f3a'); cp.position.set(x, 0, 0); head.add(cp); }
      const mic = M(GEO.mic, '#2b2f3a'); mic.position.set(0.2, -0.12, 0.13); mic.rotation.y = -0.6; head.add(mic);
      const tip = M(GEO.hand, '#e24d4d'); tip.scale.setScalar(0.45); tip.position.set(0.13, -0.13, 0.22); head.add(tip);
      // the chief's chair turns with the character
      const chair = new THREE.Group(); root.add(chair);
      const cm = (geo, col, x, y, z) => { const m = M(geo, col, true); m.position.set(x, y, z); chair.add(m); return m; };
      cm(GEO.base, METAL, 0, 0.03, 0);
      cm(GEO.post, METAL, 0, 0.24, 0);
      cm(GEO.seat, '#343a46', 0, 0.45, 0);
      cm(GEO.back, '#262a33', 0, 0.86, -0.27);
      cm(GEO.arm2, '#262a33', 0.29, 0.64, 0.02);
      cm(GEO.arm2, '#262a33', -0.29, 0.64, 0.02);
    }
    const hit = new THREE.Mesh(GEO.hit, MAT.stat);
    hit.visible = false;
    hit.userData.pick = { t: 'agent', id };
    root.add(hit);
    scene.add(root);
    const c = {
      id, main, root, hip, upper, head, armL, armR, legL, legR, hit,
      roomId: null, slot: -1, mode: 'seated', path: null, pi: 0, after: null,
      heading: -Math.PI / 2, th: -Math.PI / 2, sit: 1, walkPh: 0, ph: (h % 1000) / 159, doneAt: 0,
      tag: null, bal: null,
    };
    c.tag = mkLabel('of-tagl', main ? 70 : 40, 'down', 3, main ? 8 : 17);
    c.bal = mkLabel('of-ball', main ? 60 : 30, 'up', 6, main ? 0 : 22);
    c.tag.el.dataset.id = id;
    c.bal.el.dataset.id = id;
    return c;
  }

  function removeChar(c) {
    scene.remove(c.root);
    dropLabel(c.tag);
    dropLabel(c.bal);
    const room = world.rooms.get(c.roomId);
    if (room && c.slot >= 0 && room.slotChar[c.slot] === c) room.slotChar[c.slot] = null;
    chars.delete(c.id);
  }

  function seatChef(c, room) {
    c.root.position.copy(room.chefSeat);
    c.mode = 'seated'; c.path = null; c.sit = 1;
  }
  function slotGeom(room, slot) {
    const col = Math.floor(slot / 3), row = slot % 3;
    const ax = room.X + CHEF_W + col * COL_W, z = room.Z + ROWS_Z[row];
    return { seat: new THREE.Vector3(ax + 1.15, 0, z), aisle: ax + 1.9, z };
  }
  function seatSub(c, room) {
    const s = slotGeom(room, c.slot);
    c.root.position.copy(s.seat);
    c.mode = 'seated'; c.path = null; c.after = null; c.sit = 1;
    c.heading = c.th = -Math.PI / 2;
  }
  // A newcomer comes in at the building entrance (right end of the hall), walks along the hall to its room's door and sits at its desk.
  function pathFor(room, slot) {
    const s = slotGeom(room, slot);
    const V = (x, z) => new THREE.Vector3(x, 0, z);
    const hall = world.halls[room.hall];
    const lane = hall ? hall.lane : room.Z - 0.9;
    const p = [V(world.entryX, lane), V(room.doorX, lane)];
    if (room.door === 'front') {
      const fz = room.Z + ROOM_D;
      p.push(V(room.doorX, fz + 0.45), V(room.doorX, fz - 0.5), V(s.aisle, fz - 0.5));
    } else {
      p.push(V(room.doorX, room.Z - 0.75), V(room.doorX, room.Z + LANE_Z), V(s.aisle, room.Z + LANE_Z));
    }
    p.push(V(s.aisle, s.z), s.seat.clone());
    return p;
  }
  function enter(c, room) {
    const p = pathFor(room, c.slot);
    c.root.position.copy(p[0]);
    c.path = p; c.pi = 1; c.mode = 'walk'; c.after = 'sit'; c.sit = 0;
    c.heading = -Math.PI / 2;
  }
  function leave(c, room) {
    const p = pathFor(room, c.slot).reverse();
    if (room.slotChar[c.slot] === c) room.slotChar[c.slot] = null;
    c.slot = -1;
    c.path = p; c.pi = 1; c.mode = 'walk'; c.after = 'gone';
  }

  // ---------------------------------------------------------- sync with the data

  function syncRooms(instant) {
    const mains = store.mains();
    const list = [...mains.filter(a => a.status !== 'dormant'), ...mains.filter(a => a.status === 'dormant')];
    const nowMs = performance.now();
    const out = [];
    for (const m of list) {
      let st = roomState.get(m.id);
      if (!st) roomState.set(m.id, st = { cls: null, low: 0 });
      let have = 0;
      for (const c of chars.values()) if (!c.main && c.roomId === m.id && c.after !== 'gone') have++;
      let queued = 0;
      for (const s of store.subsOf(m.id)) if (s.status === 'working' && !chars.has(s.id)) queued++;
      const demand = have + queued;
      const want = demand <= CAP[0] ? 0 : demand <= CAP[1] ? 1 : 2;
      if (instant || st.cls == null) { st.cls = want; st.low = 0; }
      else if (want > st.cls) { st.cls = want; st.low = 0; }
      else if (want < st.cls) {
        if (!st.low) st.low = nowMs;
        if (nowMs - st.low > 60e3 && have <= CAP[want]) { st.cls = want; st.low = 0; }
      } else st.low = 0;
      out.push({ id: m.id, cls: st.cls });
    }
    for (const id of roomState.keys()) if (!mains.some(m => m.id === id)) roomState.delete(id);
    const sig = out.map(o => o.id + ':' + o.cls).join('|');
    if (sig !== world.sig || !world.group) {
      world.sig = sig;
      rebuild(out);
    }
  }

  function syncChars(instant) {
    const nowMs = performance.now();
    const seen = new Set();
    for (const room of world.rooms.values()) {
      const m = store.agents.get(room.id);
      if (!m) continue;
      let chef = chars.get(room.id);
      if (!chef) {
        chef = makeChar(room.id, true, m.color);
        chef.roomId = room.id;
        chars.set(room.id, chef);
        seatChef(chef, room);
        chef.heading = chef.th = (m.status === 'waiting' || m.status === 'ask') ? Math.PI / 4 : -Math.PI / 2;
      }
      seen.add(room.id);
      let overflow = 0;
      for (const s of store.subsOf(room.id)) {
        let c = chars.get(s.id);
        if (!c) {
          if (s.status !== 'working') continue;
          const slot = room.slotChar.indexOf(null);
          if (slot < 0) { overflow++; continue; }
          c = makeChar(s.id, false, shirtFor(s.id, m.color, false));
          c.roomId = room.id; c.slot = slot;
          room.slotChar[slot] = c;
          chars.set(s.id, c);
          if (instant) seatSub(c, room); else enter(c, room);
        }
        seen.add(s.id);
        if (s.status === 'working') c.doneAt = 0;
        else if (!c.doneAt) c.doneAt = nowMs;
        if (c.mode === 'seated' && c.after !== 'gone' && c.doneAt && nowMs - c.doneAt > 4500) {
          if (instant) removeChar(c); else leave(c, room);
        }
      }
      room.overflow = overflow;
    }
    for (const c of [...chars.values()]) {
      if (seen.has(c.id)) continue;
      const room = world.rooms.get(c.roomId);
      if (!room || instant || c.main) removeChar(c);
      else if (c.after !== 'gone') {
        if (c.mode === 'seated' && c.slot >= 0) leave(c, room);
        else if (c.mode === 'walk' && c.path) {
          c.path = [c.root.position.clone(), ...c.path.slice(0, c.pi).reverse()];
          c.pi = 1; c.after = 'gone';
          if (c.slot >= 0 && room.slotChar[c.slot] === c) room.slotChar[c.slot] = null;
          c.slot = -1;
        }
      }
    }
  }

  // ---------------------------------------------------------- label contents

  function balloonHtml(a, c) {
    if (!a) return '';
    const st = a.status;
    if (c.main) {
      if (st === 'waiting') return '<div class="of-bal wait">!</div>';
      if (st === 'ask') return '<div class="of-bal wait">?</div>';
      if (st === 'dormant') return '<div class="of-bal zz">Zz</div>';
    } else {
      if (st === 'done') return `<div class="of-bal done">${icon('check')}</div>`;
      if (st !== 'working') return `<div class="of-bal zz">${icon('zz')}</div>`;
    }
    if (st !== 'working') return '';
    const cat = (a.act && a.act.c) || 'think';
    const sm = c.main ? '' : ' sm';
    if (cat === 'think') return `<div class="of-bal think${sm}" style="--c:${catColor('think')}"><i></i><i></i><i></i></div>`;
    return `<div class="of-bal${sm}" style="--c:${catColor(cat)}">${icon(cat)}</div>`;
  }

  function refreshLabels() {
    const t = store.now();
    for (const room of world.rooms.values()) {
      const a = store.agents.get(room.id);
      if (!a) continue;
      const st = a.status;
      const wait = st === 'waiting' || st === 'ask';
      // 3D wall sign: redrawn only when its content changes
      const key = [a.project, a.title, a.name, a.color, st, room.overflow].join('|');
      if (room.signCv && room.signKey !== key) { room.signKey = key; drawSign(room, a); }
      if (room.signFace) room.signFace.color.set(st === 'dormant' ? '#9aa0ab' : '#ffffff');
      // from far away the wall text is unreadable, so a plain HTML fallback sign appears instead
      let L = signs.get(room.id);
      if (!L) { L = mkLabel('of-signl', 90, 'mid', 0); L.maxZoom = SIGN_HTML_BELOW; signs.set(room.id, L); }
      if (room.signPos) L.pos.copy(room.signPos);
      const chip = wait ? `<span class="of-chip w">${esc(msg(st === 'ask' ? 'of.chipAsk' : 'of.chipWait'))} · ${fmtShort(t - a.since)}</span>` : '';
      setLabel(L, `<div class="of-sign ${st}"><div class="r1"><span class="sw" style="background:${esc(a.color)}"></span><b>${esc(a.project)}</b>${chip}</div></div>`, room.id, wait ? 95 : 90);
    }
    for (const c of chars.values()) {
      const a = store.agents.get(c.id);
      if (!a) continue;
      const wait = c.main && (a.status === 'waiting' || a.status === 'ask');
      const txt = c.main ? a.name || a.project : shortDesc(a);
      setLabel(c.tag, `<div class="of-tag ${c.main ? 'chef' : ''} ${a.status}">${esc(txt)}</div>`);
      const bh = balloonHtml(a, c);
      setLabel(c.bal, bh, undefined, wait ? 100 : c.main ? 60 : a.status === 'done' ? 50 : 30);
      c.bal.want = !!bh;
      c.bal.force = wait;
      c.bal.minZoom = c.main || a.status === 'done' ? 0 : 22;
    }
  }

  function renderSum() {
    drawLobby();
    const c = ctx.counts();
    const n = world.rooms.size;
    const people = c.working + c.subs;
    sumEl.innerHTML = `<span>${msg('of.rooms', { n, b: `<b>${n}</b>` })}</span><span class="sep">·</span><span>${msg('of.working', { n: people, b: `<b>${people}</b>` })}</span><span class="sep">·</span>` +
      (c.waiting ? `<span class="w">${msg('of.waiting', { n: c.waiting, b: `<b>${c.waiting}</b>` })}</span>` : `<span>${esc(msg('of.nobody'))}</span>`);
    emptyEl.hidden = !store.ready || n > 0;
    if (store.ready && !n) emptyEl.textContent = msg('of.empty');
  }

  // ---------------------------------------------------------- frame-by-frame animation

  const tgt = { lx: 0, lz: 0, rx: 0, rz: 0, up: 0, hx: 0, hz: 0 };
  function animChar(c, dt, T) {
    const a = store.agents.get(c.id);
    const pos = c.root.position;

    if (c.mode === 'walk' && c.path) {
      const p = c.path[c.pi];
      const dx = p.x - pos.x, dz = p.z - pos.z, d = Math.hypot(dx, dz), stp = WALK * dt;
      if (d <= stp) {
        pos.x = p.x; pos.z = p.z; c.pi++;
        if (c.pi >= c.path.length) {
          c.path = null;
          if (c.after === 'gone') { removeChar(c); return; }
          c.mode = 'seated'; c.after = null; c.th = -Math.PI / 2;
        }
      } else {
        pos.x += dx / d * stp; pos.z += dz / d * stp;
        c.th = Math.atan2(dx, dz);
      }
      c.walkPh += dt * 10;
    }

    let pose = 'idle';
    const st = a ? a.status : 'done';
    const cat = a && a.act ? a.act.c : 'think';
    if (c.mode === 'walk') pose = 'walk';
    else if (st === 'working') pose = cat === 'think' ? 'think' : 'type';
    else if (c.main && (st === 'waiting' || st === 'ask')) pose = 'wave';
    else if (st === 'dormant') pose = 'sleep';
    if (c.mode === 'seated') c.th = pose === 'wave' ? Math.PI / 4 : -Math.PI / 2;

    c.heading = angTo(c.heading, c.th, Math.min(1, dt * (c.mode === 'walk' ? 12 : 5)));
    c.root.rotation.y = c.heading;
    c.sit = lerp(c.sit, c.mode === 'seated' ? 1 : 0, Math.min(1, dt * 7));

    const ph = c.ph, sw = Math.sin(c.walkPh);
    tgt.lx = tgt.rx = -0.25; tgt.lz = -0.06; tgt.rz = 0.06; tgt.up = 0; tgt.hx = 0; tgt.hz = 0;
    if (pose === 'walk') {
      tgt.lx = sw * 0.55; tgt.rx = -sw * 0.55; tgt.up = 0.05;
    } else if (pose === 'type') {
      tgt.lx = -1.05 + Math.sin(T * 15 + ph) * 0.1; tgt.rx = -1.05 + Math.sin(T * 15 + ph + 2.4) * 0.1;
      tgt.lz = -0.16; tgt.rz = 0.16; tgt.up = 0.12; tgt.hx = 0.1 + Math.sin(T * 2 + ph) * 0.03;
    } else if (pose === 'think') {
      tgt.rx = -2.05; tgt.rz = 0.5; tgt.lx = -0.9; tgt.lz = -0.15; tgt.up = 0.04; tgt.hx = -0.06; tgt.hz = 0.12 + Math.sin(T * 1.3 + ph) * 0.05;
    } else if (pose === 'wave') {
      tgt.rx = -0.25; tgt.rz = -2.45 + Math.sin(T * 8) * 0.38; tgt.lx = -0.3; tgt.up = -0.05; tgt.hx = -0.1; tgt.hz = Math.sin(T * 3) * 0.08;
    } else if (pose === 'sleep') {
      tgt.lx = tgt.rx = -1.35; tgt.lz = -0.4; tgt.rz = 0.4; tgt.up = 0.95 + Math.sin(T * 1.6 + ph) * 0.025; tgt.hx = 0.25;
    } else {
      tgt.up = -0.06; tgt.hx = -0.04 + Math.sin(T * 1.2 + ph) * 0.03; tgt.lx = tgt.rx = -0.45;
    }
    const k = Math.min(1, dt * 10);
    c.armL.rotation.x = lerp(c.armL.rotation.x, tgt.lx, k);
    c.armL.rotation.z = lerp(c.armL.rotation.z, tgt.lz, k);
    c.armR.rotation.x = lerp(c.armR.rotation.x, tgt.rx, k);
    c.armR.rotation.z = lerp(c.armR.rotation.z, tgt.rz, k);
    c.upper.rotation.x = lerp(c.upper.rotation.x, tgt.up, k);
    c.head.rotation.x = lerp(c.head.rotation.x, tgt.hx, k);
    c.head.rotation.z = lerp(c.head.rotation.z, tgt.hz, k);
    const legSwing = pose === 'walk' ? sw * 0.6 : 0;
    c.legL.rotation.x = -1.5 * c.sit + legSwing * (1 - c.sit);
    c.legR.rotation.x = -1.5 * c.sit - legSwing * (1 - c.sit);
    c.hip.position.y = lerp(0.42, 0.5, c.sit) + (pose === 'walk' ? Math.abs(Math.cos(c.walkPh)) * 0.03 : 0);

    const sc = c.mode === 'walk' ? clamp((world.entryX + 0.15 - pos.x) / 0.9, 0.02, 1) : 1;
    c.root.scale.setScalar(sc);
    c.tag.off = c.bal.off = sc < 0.7;
    c.tag.pos.set(pos.x, 0, pos.z);
    c.bal.pos.set(pos.x, c.hip.position.y + 1.08, pos.z);
  }

  const SC = new THREE.Color();
  function stepScreens(T) {
    const sm = world.screenMesh;
    if (!sm || !sm.count) return;
    world.screens.forEach((s, i) => {
      const room = world.rooms.get(s.room);
      const m = store.agents.get(s.room);
      let col = SCR_OFF, pulse = 1;
      if (s.kind === 'chef') {
        if (m && m.status === 'working') { col = catColor(m.act ? m.act.c : 'think'); pulse = s.slot ? 0.78 : 0.95 + Math.sin(T * 2.4 + i) * 0.08; }
        else if (m && m.status !== 'dormant') { col = SCR_IDLE; pulse = s.slot ? 0.8 : 1; }
      } else if (room) {
        const c = room.slotChar[s.slot];
        if (c && c.mode === 'seated' && c.sit > 0.85) {
          const a = store.agents.get(c.id);
          if (a && a.status === 'working') { col = catColor(a.act ? a.act.c : 'think'); pulse = 0.92 + Math.sin(T * 2.4 + i * 1.7) * 0.08; }
          else col = SCR_DONE;
        }
      }
      SC.set(col).multiplyScalar(pulse);
      sm.setColorAt(i, SC);
    });
    sm.instanceColor.needsUpdate = true;
  }

  function stepRooms(dt, T) {
    for (const room of world.rooms.values()) {
      const a = store.agents.get(room.id);
      const st = a ? a.status : 'dormant';
      const wait = st === 'waiting' || st === 'ask';
      room.ovl.visible = st === 'dormant';
      room.beam.visible = room.disc.visible = wait;
      room.rings.forEach((m, i) => {
        m.visible = wait;
        if (!wait) return;
        const p = (T * 0.65 + i * 0.5) % 1;
        m.scale.setScalar(1 + p * 1.7);
        m.material.opacity = 0.8 * (1 - p);
      });
      if (room.lamp) room.lamp.visible = room.halo.visible = wait;
      if (wait) {
        room.beam.material.opacity = 0.2 + Math.sin(T * 3) * 0.06;
        room.disc.material.opacity = 0.3 + Math.sin(T * 3) * 0.08;
        if (room.lamp) {
          const blink = 0.5 + 0.5 * Math.sin(T * 6);
          room.halo.material.opacity = 0.35 + 0.65 * blink;
          room.halo.scale.setScalar(0.9 + 0.5 * blink);
          room.lamp.material.color.set(YELLOW).multiplyScalar(0.75 + 0.35 * blink);
        }
      }
      let near = false;
      for (const c of chars.values()) {
        if (c.roomId !== room.id || c.mode !== 'walk') continue;
        const p = c.root.position;
        if (room.doorPivot && Math.abs(p.x - room.doorPt.x) < 0.9 && Math.abs(p.z - room.doorPt.z) < 1.15) { near = true; break; }
      }
      for (let i = 0; !near && room.doorPivot && i < doorWalkers.length; i += 2) {
        if (Math.abs(doorWalkers[i] - room.doorPt.x) < 0.9 && Math.abs(doorWalkers[i + 1] - room.doorPt.z) < 1.15) near = true;
      }
      room.doorOpen = lerp(room.doorOpen, near ? 1 : 0, Math.min(1, dt * 6));
      if (room.doorPivot) room.doorPivot.rotation.y = -1.35 * room.doorOpen;
    }
  }

  function step(dt, T) {
    for (const c of [...chars.values()]) animChar(c, dt, T);
    for (const fn of extraFrame) { try { fn(T, dt); } catch { /* decoration frame callback */ } }
    stepScreens(T);
    stepRooms(dt, T);
    doorWalkers.length = 0;
    env.frame(T, dt);
    for (const [id, L] of signs) {
      const room = world.rooms.get(id);
      L.want = !!room;
    }
    if (hover && hover.t === 'agent') {
      const c = chars.get(hover.id);
      if (c) { hoverRing.visible = true; hoverRing.position.set(c.root.position.x, 0.035, c.root.position.z); }
      else hoverRing.visible = false;
    } else hoverRing.visible = false;
  }

  // ---------------------------------------------------------- camera: fit, pan, zoom

  function projBounds() {
    const b = world.bounds;
    if (!b) return null;
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const x of [b.x0, b.x1]) for (const z of [b.z0, b.z1]) for (const y of [-0.5, WALL_H + 0.7]) {
      _v.set(x, y, z);
      const pa = _v.dot(R), pb = _v.dot(U);
      a0 = Math.min(a0, pa); a1 = Math.max(a1, pa); b0 = Math.min(b0, pb); b1 = Math.max(b1, pb);
    }
    // objects the local module asked to keep in view (api.fitInclude): the corners of each mesh's own bounding box,
    // transformed to the world, so rotated objects do not inflate the framing
    const put = (box, m) => {
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
        _v.set(x, y, z);
        if (m) _v.applyMatrix4(m);
        const pa = _v.dot(R), pb = _v.dot(U);
        a0 = Math.min(a0, pa); a1 = Math.max(a1, pa); b0 = Math.min(b0, pb); b1 = Math.max(b1, pb);
      }
    };
    for (const t of world.fitExtra || []) {
      if (t.isBox3) { if (!t.isEmpty()) put(t, null); continue; }
      t.updateWorldMatrix(true, true);
      t.traverse(o => {
        if (!o.geometry) return;
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        if (!o.geometry.boundingBox.isEmpty()) put(o.geometry.boundingBox, o.matrixWorld);
      });
    }
    return { a0, a1, b0, b1 };
  }
  function computeLimits() {
    const p = projBounds();
    if (!p) { lim = { a0: -1e9, a1: 1e9, b0: -1e9, b1: 1e9 }; return; }
    lim = p;
  }
  function fit() {
    const p = projBounds();
    if (!p) return;
    const narrow = vw < 640;
    const padT = narrow ? 52 : 18, padB = narrow ? 12 : 16, padL = narrow ? 8 : 18, padR = narrow ? 8 : 24;
    const zf = Math.min((vw - padL - padR) / (p.a1 - p.a0), (vh - padT - padB) / (p.b1 - p.b0));
    zoom = clamp(zf, 3, 70);
    zMin = Math.min(zoom * 0.7, 8);
    zMax = 110;
    const ox = (padL - padR) / 2, oy = (padB - padT) / 2;
    camA = (p.a0 + p.a1) / 2 - ox / zoom;
    camB = (p.b0 + p.b1) / 2 - oy / zoom;
    applyCam();
  }
  function pan(dx, dy) {
    camA -= dx / zoom;
    camB += dy / zoom;
    autoFit = false;
    applyCam();
  }
  function zoomAt(px, py, z2) {
    z2 = clamp(z2, zMin, zMax);
    if (Math.abs(z2 - zoom) < 1e-4) return;
    const sx = px - vw / 2, sy = vh / 2 - py, k = 1 / zoom - 1 / z2;
    camA += sx * k;
    camB += sy * k;
    zoom = z2;
    autoFit = false;
    applyCam();
  }
  function doResize() {
    vw = Math.max(1, root.clientWidth);
    vh = Math.max(1, root.clientHeight);
    renderer.setSize(vw, vh, false);
    if (autoFit) fit(); else applyCam();
    renderer.shadowMap.needsUpdate = true;
  }
  new ResizeObserver(() => { resized = true; }).observe(root);

  // ---------------------------------------------------------- mouse and touch

  const ray = new THREE.Raycaster();
  const NDC = new THREE.Vector2();
  let hover = null;
  function pickAt(x, y) {
    if (!world.group) return null;
    NDC.set(x / vw * 2 - 1, -(y / vh) * 2 + 1);
    ray.setFromCamera(NDC, camera);
    const objs = world.pick.slice();
    for (const c of chars.values()) objs.push(c.hit);
    const hits = ray.intersectObjects(objs, false);
    for (const h of hits) {
      const p = h.object.userData.pick;
      if (!p) continue;
      if (p.t === 'block') return null;
      if (p.t === 'extra') return p;
      if (p.t === 'slot') {
        const room = world.rooms.get(p.room);
        const c = room && room.slotChar[p.slot];
        if (c) return { t: 'agent', id: c.id };
        continue;
      }
      return p;
    }
    return null;
  }

  function tipHtml(a) {
    const t = store.now();
    const head = a.kind === 'main'
      ? `<div class="h"><span class="sq" style="background:${esc(a.color)}"></span>${esc(a.project)}<span class="of-tn">${esc(a.name || '')}</span></div>${a.title ? `<div class="m">${esc(a.title)}</div>` : ''}`
      : `<div class="h"><span class="sq" style="background:${esc(a.color)}"></span>${esc(a.desc || a.atype || msg('agent.sub'))}</div><div class="m">${esc(a.project)} · ${esc(msg('of.subTip'))}${a.atype ? ' · ' + esc(a.atype) : ''}</div>`;
    return `<div class="of-tip">${head}<div class="of-tp">${ctx.statusPill(a, t)}</div>${ctx.activityHtml(a, t)}</div>`;
  }

  function hoverAt(e) {
    const r = root.getBoundingClientRect();
    const lab = e.target && e.target.closest ? e.target.closest('.of-l[data-id]') : null;
    let h = null;
    if (lab && root.contains(lab)) h = { t: lab.classList.contains('of-signl') ? 'room' : 'agent', id: lab.dataset.id, label: true };
    else h = pickAt(e.clientX - r.left, e.clientY - r.top);
    hover = h;
    stage.classList.toggle('hover', !!h);
    const id = h && (h.t === 'agent' || h.label) ? h.id : null;
    const a = id && store.agents.get(id);
    if (a) ctx.tip.show(tipHtml(a), e.clientX, e.clientY);
    else if (h && h.t === 'extra' && h.html) ctx.tip.show(h.html, e.clientX, e.clientY);
    else ctx.tip.hide();
  }

  const ptrs = new Map();
  let drag = null, pinch = null, clickTimer = 0;
  root.addEventListener('pointerdown', e => {
    if (e.target.closest('.of-ctl')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 1) {
      drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, lx: e.clientX, ly: e.clientY, moved: false, ext: false, target: e.target };
      emitPointer('down', e);
    } else if (ptrs.size === 2) {
      const [p1, p2] = [...ptrs.values()];
      pinch = { d: Math.hypot(p1.x - p2.x, p1.y - p2.y) || 1, z: zoom };
      if (drag) {
        if (drag.ext) { drag.ext = false; emitPointer('cancel', e); }
        drag.moved = true;
      }
    }
    try { root.setPointerCapture(e.pointerId); } catch { /* unavailable */ }
  });
  root.addEventListener('pointermove', e => {
    if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && ptrs.size >= 2) {
      const [p1, p2] = [...ptrs.values()];
      const d = Math.hypot(p1.x - p2.x, p1.y - p2.y) || 1;
      const r = root.getBoundingClientRect();
      zoomAt((p1.x + p2.x) / 2 - r.left, (p1.y + p2.y) / 2 - r.top, pinch.z * d / pinch.d);
      return;
    }
    if (drag && drag.id === e.pointerId) {
      if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 4) {
        drag.moved = true;
        // a local module may take the drag over (api.onPointer 'dragstart'); otherwise it pans the view
        if (!pinch && emitPointer('dragstart', e)) drag.ext = true;
        else stage.classList.add('drag');
        ctx.tip.hide();
        hover = null;
      }
      if (drag.ext) { emitPointer('drag', e); return; }
      if (drag.moved) { pan(e.clientX - drag.lx, e.clientY - drag.ly); drag.lx = e.clientX; drag.ly = e.clientY; }
      return;
    }
    if (emitPointer('move', e)) { clearHover(); return; }
    if (e.pointerType === 'mouse') hoverAt(e);
  });
  const endPtr = e => {
    ptrs.delete(e.pointerId);
    if (ptrs.size < 2) pinch = null;
    if (drag && drag.id === e.pointerId) {
      const d = drag;
      drag = null;
      stage.classList.remove('drag');
      if (d.ext) { emitPointer(e.type === 'pointerup' ? 'drop' : 'cancel', e); return; }
      emitPointer('up', e);
      if (!d.moved && e.type === 'pointerup') click(e, d.target);
    }
  };
  root.addEventListener('pointerup', endPtr);
  root.addEventListener('pointercancel', endPtr);
  root.addEventListener('pointerleave', e => { emitPointer('leave', e); if (!drag) clearHover(); });

  function clearHover() { hover = null; ctx.tip.hide(); stage.classList.remove('hover'); }
  // local module pointer hooks (api.onPointer): true from any hook means the event was taken over
  function emitPointer(type, e) {
    let used = false;
    for (const fn of extraPointer) { try { if (fn(type, e) === true) used = true; } catch { /* add-on hook */ } }
    return used;
  }

  function click(e, target) {
    if (emitPointer('click', e)) return;
    const lab = target && target.closest ? target.closest('.of-l[data-id]') : null;
    if (lab && root.contains(lab)) { ctx.tip.hide(); ctx.openDrawer(lab.dataset.id); return; }
    const r = root.getBoundingClientRect();
    const h = pickAt(e.clientX - r.left, e.clientY - r.top);
    if (!h || h.t === 'extra') return;
    if (h.t === 'agent') { ctx.tip.hide(); ctx.openDrawer(h.id); return; }
    if (h.t === 'room') {
      // a single click on empty floor opens the main agent; wait briefly so a double-click can reset the view
      clearTimeout(clickTimer);
      clickTimer = setTimeout(() => { ctx.tip.hide(); ctx.openDrawer(h.id); }, 240);
    }
  }
  root.addEventListener('dblclick', e => {
    if (e.target.closest('.of-ctl')) return;
    if (emitPointer('dblclick', e)) return;
    clearTimeout(clickTimer);
    autoFit = true;
    fit();
  });
  root.addEventListener('wheel', e => {
    e.preventDefault();
    const r = root.getBoundingClientRect();
    const f = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0016));
    zoomAt(e.clientX - r.left, e.clientY - r.top, zoom * f);
    ctx.tip.hide();
  }, { passive: false });
  root.querySelector('.of-ctl').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.z === 'fit') { autoFit = true; fit(); }
    else zoomAt(vw / 2, vh / 2, zoom * (b.dataset.z === 'in' ? 1.3 : 1 / 1.3));
  });

  // ---------------------------------------------------------- loop

  let errLogged = false, frameMs = 0;
  function logOnce(where, err) {
    if (errLogged) return;
    errLogged = true;
    root.dataset.hata = `${where}: ${(err && err.message) || err}`;
    console.error(`Office (${where}):`, err);
  }

  function sync() {
    try {
      if (!store.ready) { renderSum(); return; }
      const instant = instantNext;
      syncRooms(instant);
      syncChars(instant);
      instantNext = false;
      refreshLabels();
      renderSum();
      renderer.shadowMap.needsUpdate = true;
    } catch (err) { logOnce('sync', err); }
  }

  // Adaptive frame rate: full speed only while someone is interacting with a focused window;
  // idle, unfocused, slow or software-rendered pages draw far fewer frames.
  let lastInput = performance.now(), frameNo = 0;
  for (const ev of ['pointermove', 'pointerdown', 'wheel', 'keydown']) {
    root.addEventListener(ev, () => { lastInput = performance.now(); }, { passive: true });
  }
  function frameInterval(now) {
    if (SOFTWARE_GL) return 1000 / 8;
    let fps = now - lastInput > 45e3 || !document.hasFocus() ? 15 : 1000 / FRAME_MS;
    if (frameMs > 18) fps = Math.min(fps, 15);
    return 1000 / fps;
  }

  function loop(now) {
    raf = requestAnimationFrame(loop);
    if (!visible || document.hidden) { lastT = 0; return; }
    if (lastT && now - lastT < frameInterval(now) - 2) return;
    if (++frameNo % 12 === 0) renderer.shadowMap.needsUpdate = true;
    const dt = lastT ? Math.min(0.1, (now - lastT) / 1000) : 1 / 30;
    lastT = now;
    try {
      const t0 = performance.now();
      if (resized) { resized = false; doResize(); }
      step(dt, now / 1000);
      // camera shake (api.shake): a temporary screen-space offset that is removed again right after drawing
      let shX = 0, shY = 0;
      if (shakeAmp > 0.2) {
        const T = now / 1000;
        shX = shakeAmp * (Math.sin(T * 91) * 0.6 + Math.sin(T * 57 + 1.3) * 0.4);
        shY = shakeAmp * (Math.sin(T * 83 + 2.1) * 0.6 + Math.sin(T * 49 + 0.4) * 0.4);
        shakeAmp *= Math.exp(-dt * 6);
        camera.position.addScaledVector(R, shX / zoom).addScaledVector(U, shY / zoom);
        camera.updateMatrixWorld();
      } else shakeAmp = 0;
      try {
        renderer.render(scene, camera);
        placeLabels();
      } finally {
        if (shX || shY) { camera.position.addScaledVector(R, -shX / zoom).addScaledVector(U, -shY / zoom); camera.updateMatrixWorld(); }
      }
      frameMs = frameMs * 0.9 + (performance.now() - t0) * 0.1;
    } catch (err) { logOnce('frame', err); }
  }

  // optional local decoration module: if missing (404) or broken it is skipped silently and no space is reserved
  (async () => {
    try {
      const url = new URL('local/ofis-extras.js', document.baseURI).href;
      const res = await fetch(url, { method: 'HEAD', cache: 'no-store' });
      if (!res.ok) return;
      const mod = await import(url);
      if (typeof mod.decorate !== 'function') return;
      const list = Array.isArray(mod.areas) ? mod.areas : [{ id: 'main', w: mod.width, row: 'last' }];
      const areas = list.filter(x => x && x.id).map(x => ({ id: String(x.id), w: clamp(Number(x.w) || 6.5, 3, 16), row: x.row === 'first' ? 'first' : 'last' }));
      if (!areas.length) return;
      extras = { mod, areas };
      world.sig = '';
      if (visible) sync();
    } catch { /* no add-on */ }
  })();

  // read-only state for verification (from the console: document.querySelector('#view-ofis').__ofis)
  root.__ofis = {
    get zoom() { return zoom; }, get size() { return [vw, vh]; }, get autoFit() { return autoFit; },
    get rooms() { return [...world.rooms.values()].map(r => ({ id: r.id, W: +r.W.toFixed(2), X: +r.X.toFixed(2), Z: r.Z, cls: r.cls })); },
    get chars() { return chars.size; },
    project(x, y, z) { PV.set(x, y, z).project(camera); return [(PV.x + 1) / 2 * vw, (1 - PV.y) / 2 * vh]; },
    charScreen(id) { const c = chars.get(id); if (!c) return null; const p = c.root.position; return this.project(p.x, 0.8, p.z); },
    get frameMs() { return +frameMs.toFixed(2); },
    get calls() { return renderer.info.render.calls; },
    get env() { return env.stats; },
    get walking() { return [...chars.values()].filter(c => c.mode === 'walk').map(c => c.id); },
    subs() { return [...chars.values()].filter(c => !c.main).map(c => ({ id: c.id, mode: c.mode, room: c.roomId })); },
    // verification only: replay a seated subagent's walk in from the entrance
    replayEnter(id) { const c = chars.get(id), room = c && world.rooms.get(c.roomId); if (!c || c.main || !room || c.slot < 0) return false; enter(c, room); return true; },
  };

  return {
    show() {
      visible = true;
      instantNext = true;
      resized = true;
      sync();
      lastT = 0;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(loop);
    },
    hide() {
      visible = false;
      cancelAnimationFrame(raf);
      clearTimeout(clickTimer);
      ctx.tip.hide();
    },
    update() {
      if (visible) sync();
    },
  };
}
