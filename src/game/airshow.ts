import * as THREE from "three";
import { block, fin, lightPlane, merge, propDisk, rgb, showJet, tube } from "./aircraft";
import { WIND_X, WIND_Z } from "./constants";

// The show over the lakefront: an airship cruising slow laps off the shore, a light plane
// towing a banner up and down the beach, and a four-ship jet team that runs down the shore
// trailing smoke in the Chicago flag's colors and breaks into a bomb burst past the beach.
// Everything here is a function of the clock (and of when each team pass began), so a replay
// can show the sky exactly as it was by asking for an earlier time.

const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _m = new THREE.Matrix4();

/** Points `obj` along `fwd` with its top toward `up` (models fly toward -z). */
function orient(q: THREE.Quaternion, fwd: THREE.Vector3, up: THREE.Vector3) {
  _c.crossVectors(fwd, up).normalize();
  _b.crossVectors(_c, fwd).normalize();
  _a.copy(fwd).negate();
  return q.setFromRotationMatrix(_m.makeBasis(_c, _b, _a));
}

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  if (g) draw(g);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  // Lettered again once the page's display font has loaded, in case it was still on its way.
  void document.fonts?.load("700 64px 'Barlow Condensed'").then(() => {
    if (!g) return;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, w, h);
    draw(g);
    tex.needsUpdate = true;
  });
  return tex;
}

/** A six-pointed star, as on the Chicago flag. */
function star(g: CanvasRenderingContext2D, x: number, y: number, r: number) {
  g.beginPath();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
    const k = i % 2 ? r * 0.5 : r;
    g.lineTo(x + Math.cos(a) * k, y + Math.sin(a) * k);
  }
  g.closePath();
  g.fill();
}

const FLAG_BLUE = "#41b6e6";
const FLAG_RED = "#e4002b";

// ---- The airship ----

const SHIP_LEN = 62;
const SHIP_R = 8.6;
/** Its lap: an oval off the shore between the beach and Navy Pier, about 1,000 ft up. */
const LAP = { x: 1350, y: 320, z: -1500, rx: 420, rz: 2500, mps: 13 };

function airship(night: boolean) {
  const group = new THREE.Group();
  const pts: THREE.Vector2[] = [];
  const n = 28;
  for (let i = 0; i <= n; i++) {
    // From the tail (y < 0) to a blunt nose (y > 0).
    const y = -SHIP_LEN / 2 + (i / n) * SHIP_LEN;
    const u = (2 * y) / SHIP_LEN;
    const r = SHIP_R * Math.max(0, 1 - u * u) ** (u > 0 ? 0.42 : 0.62);
    pts.push(new THREE.Vector2(Math.max(r, 0.01), y));
  }
  const env = new THREE.LatheGeometry(pts, 32);
  // Nose toward -z; around the hull, u = 0 is the top, 0.25 the right side, 0.75 the left.
  env.rotateX(-Math.PI / 2);
  const tex = canvasTex(1024, 1024, (g) => {
    g.fillStyle = "#f4f6f8";
    g.fillRect(0, 0, 1024, 1024);
    // Down each side the flag: two light blue stripes, red stars and the city's name between.
    for (const [cx, turn] of [
      [256, -Math.PI / 2],
      [768, Math.PI / 2],
    ] as const) {
      g.fillStyle = FLAG_BLUE;
      g.fillRect(cx - 92, 170, 22, 700);
      g.fillRect(cx + 70, 170, 22, 700);
      g.save();
      g.translate(cx, 520);
      g.rotate(turn);
      g.fillStyle = FLAG_RED;
      for (const x of [-300, -250, 250, 300]) star(g, x, 0, 20);
      g.font = "bold 92px 'Barlow Condensed', 'Arial Narrow', sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillStyle = "#1b2a3a";
      g.fillText("CHICAGO", 0, 4);
      g.restore();
    }
  });
  const skin = new THREE.MeshStandardMaterial({
    map: tex,
    roughness: 0.55,
    emissive: night ? new THREE.Color(1, 1, 1) : new THREE.Color(0, 0, 0),
    emissiveMap: night ? tex : null,
    emissiveIntensity: night ? 0.55 : 0,
  });
  group.add(new THREE.Mesh(env, skin));

  const BLUE = rgb(FLAG_BLUE);
  const GREY = rgb("#5d6670");
  const fins: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 4; k++) {
    const f = fin(6.2, 8.5, 5, 0.55, 0.45, 0, 3.2, 21.5, BLUE);
    f.rotateZ((k * Math.PI) / 2 + Math.PI / 4);
    fins.push(f);
  }
  const frame = merge([
    ...fins,
    // The gondola under the front, its windows, and an engine pod either side.
    block(3.2, 2.4, 11, 0, -SHIP_R - 0.9, -6, rgb("#e9ecef")),
    block(3.3, 0.8, 9, 0, -SHIP_R - 0.6, -6.6, rgb("#1c2733")),
    tube(0.5, 0.7, 2.6, -2.6, -SHIP_R - 0.6, -2.5, GREY, 10),
    tube(0.5, 0.7, 2.6, 2.6, -SHIP_R - 0.6, -2.5, GREY, 10),
    block(2, 0.2, 0.3, 0, -SHIP_R - 0.6, -2.5, GREY),
  ]);
  const frameMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 });
  group.add(new THREE.Mesh(frame, frameMat));
  return { group, tex, skin, frame, frameMat };
}

// ---- The banner plane ----

/** A racetrack off the beach, 600 ft up: south near the shore, back north farther out. */
const TRACK = { xIn: 650, xOut: 1250, zN: -5200, zS: 2400, y: 185, mps: 38 };
const TURN_R = (TRACK.xOut - TRACK.xIn) / 2;
const LEG = TRACK.zS - TRACK.zN;
const TRACK_LEN = 2 * LEG + 2 * Math.PI * TURN_R;
const BANNER_LEN = 50;
const BANNER_H = 6;
const BANNER_TEXT = "BLUE SKIES · LAKESHORE EXIT";

/** The banner's lettering, filling its length; `mirror` prints the far side. */
function letterBanner(g: CanvasRenderingContext2D, mirror: boolean) {
  const w = g.canvas.width;
  const h = g.canvas.height;
  g.fillStyle = "#fbfbf7";
  g.fillRect(0, 0, w, h);
  if (mirror) g.setTransform(-1, 0, 0, 1, w, 0);
  const font = (px: number) => `bold ${px}px 'Barlow Condensed', 'Arial Narrow', sans-serif`;
  g.font = font(h * 0.82);
  g.font = font(Math.floor(h * 0.82 * Math.min(1, (w * 0.95) / g.measureText(BANNER_TEXT).width)));
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = FLAG_RED;
  g.fillText(BANNER_TEXT, w / 2, h * 0.53);
}
const TOW_M = 42;

/** Where along the racetrack `s` meters is, and which way it heads (a level unit vector). */
function trackAt(s: number, pos: THREE.Vector3, dir: THREE.Vector3) {
  s = ((s % TRACK_LEN) + TRACK_LEN) % TRACK_LEN;
  const cx = (TRACK.xIn + TRACK.xOut) / 2;
  if (s < LEG) {
    pos.set(TRACK.xIn, TRACK.y, TRACK.zN + s);
    dir.set(0, 0, 1);
    return;
  }
  s -= LEG;
  const arc = Math.PI * TURN_R;
  if (s < arc) {
    // Round the south end, turning east and back north.
    const a = s / TURN_R;
    pos.set(cx - Math.cos(a) * TURN_R, TRACK.y, TRACK.zS + Math.sin(a) * TURN_R);
    dir.set(Math.sin(a), 0, Math.cos(a));
    return;
  }
  s -= arc;
  if (s < LEG) {
    pos.set(TRACK.xOut, TRACK.y, TRACK.zS - s);
    dir.set(0, 0, -1);
    return;
  }
  s -= LEG;
  const a = s / TURN_R;
  pos.set(cx + Math.cos(a) * TURN_R, TRACK.y, TRACK.zN - Math.sin(a) * TURN_R);
  dir.set(-Math.sin(a), 0, -Math.cos(a));
}

function bannerPlane() {
  const group = new THREE.Group();
  const lp = lightPlane();
  const tint = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.45,
    color: FLAG_RED,
  });
  const body = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45 });
  const plane = new THREE.Group();
  plane.add(new THREE.Mesh(lp.body, body), new THREE.Mesh(lp.colors, tint));
  const prop = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  plane.add(new THREE.Mesh(propDisk(), prop));
  group.add(plane);

  const tex = canvasTex(2048, 256, (g) => letterBanner(g, false));
  // The banner's length runs along +z from its leading edge, which the rope pulls.
  const geo = new THREE.PlaneGeometry(BANNER_LEN, BANNER_H, 24, 1);
  geo.rotateY(Math.PI / 2);
  geo.translate(0, 0, BANNER_LEN / 2);
  const rest = Float32Array.from(geo.getAttribute("position").array);
  const cloth = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 });
  const banner = new THREE.Mesh(geo, cloth);
  group.add(banner);
  // The far side is printed too, mirrored, so it reads from the lake as well as the beach.
  const backTex = canvasTex(2048, 256, (g) => letterBanner(g, true));
  const backCloth = new THREE.MeshStandardMaterial({
    map: backTex,
    side: THREE.BackSide,
    roughness: 0.8,
  });
  banner.add(new THREE.Mesh(geo, backCloth));
  const ropeGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(),
    new THREE.Vector3(),
  ]);
  const ropeMat = new THREE.LineBasicMaterial({ color: "#3a3f45" });
  const rope = new THREE.Line(ropeGeo, ropeMat);
  rope.frustumCulled = false;
  group.add(rope);
  return {
    group,
    plane,
    banner,
    rest,
    rope,
    texs: [tex, backTex],
    mats: [tint, body, prop, cloth, backCloth, ropeMat],
    geos: [lp.body, lp.colors, geo, ropeGeo],
  };
}

// ---- The jet team ----

const TEAM_HZ = 20;
const V = 165;
/** The run down the shore, offshore of the beach: in from the north, pulling up off the beach. */
const RUN = { x: 520, y: 300, z0: -7600, pullZ: -200 };
const PULL_R = 650;
const BURST_R = 480;
/** Seconds into a pass: the pull, straight up, and the burst. */
const T_PULL = (RUN.pullZ - RUN.z0) / V;
const T_TOP = T_PULL + (Math.PI / 2) * (PULL_R / V);
const T_BURST = T_TOP + 1.5;
/** Seconds from the start of a pass to the end of the show. */
export const SHOW_S = Math.ceil(T_BURST + 30);
/** The best of it for a replay: the pull up into the vertical and the burst. */
const HIGHLIGHT = [T_PULL, T_BURST + 6] as const;
const SMOKE_ON_Z = -5200;
const SMOKE_S = 18;
/** Diamond: lead, left wing, right wing, slot. Offsets right, up and back from the lead. */
const SLOTS = [
  [0, 0, 0],
  [-11, -1, 9],
  [11, -1, 9],
  [0, -2.5, 18],
] as const;
/** Where each breaks to in the burst: the lead back north over the top, the wings out to the sides. */
const BURST = [
  new THREE.Vector3(0, 0, -1),
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(-1, 0, 0),
  new THREE.Vector3(0, 0, 1),
];
const SMOKE = [rgb("#f4f6f8"), rgb(FLAG_RED), rgb(FLAG_BLUE), rgb("#f4f6f8")];

type Flight = { pos: Float32Array; quat: Float32Array; smoke: Uint8Array };

/** Flies the whole show once, TEAM_HZ samples a second for each jet. */
function planShow(): Flight[] {
  const n = SHOW_S * TEAM_HZ + 1;
  const dt = 1 / TEAM_HZ;
  const flights = SLOTS.map(() => ({
    pos: new Float32Array(n * 3),
    quat: new Float32Array(n * 4),
    smoke: new Uint8Array(n),
  }));
  const lead = new THREE.Vector3(RUN.x, RUN.y, RUN.z0);
  const fwd = new THREE.Vector3(0, 0, 1);
  const right = new THREE.Vector3(-1, 0, 0);
  const up = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  // Each jet's own flight after the burst.
  const own = SLOTS.map(() => ({ p: new THREE.Vector3(), up: new THREE.Vector3(), turn: 0 }));
  for (let i = 0; i < n; i++) {
    const t = i * dt;
    if (t < T_BURST) {
      if (t > T_PULL)
        fwd.applyAxisAngle(right, Math.min(t - T_PULL, dt) * (V / PULL_R) * (t < T_TOP ? 1 : 0));
      if (t >= T_TOP) fwd.set(0, 1, 0);
      up.crossVectors(right, fwd).normalize();
      orient(q, fwd, up);
      SLOTS.forEach(([r, u, b], k) => {
        p.copy(lead).addScaledVector(right, r).addScaledVector(up, u).addScaledVector(fwd, -b);
        own[k]!.p.copy(p);
        own[k]!.up.copy(up);
        const f = flights[k]!;
        f.pos.set([p.x, p.y, p.z], i * 3);
        f.quat.set([q.x, q.y, q.z, q.w], i * 4);
        f.smoke[i] = lead.z > SMOKE_ON_Z ? 1 : 0;
      });
      lead.addScaledVector(fwd, V * dt);
      continue;
    }
    // The burst: each pulls away toward its own side until a little past level, then rolls
    // upright and flies on.
    own.forEach((o, k) => {
      o.turn = Math.min(1.75, o.turn + dt * (V / BURST_R));
      const d = BURST[k]!;
      _a.copy(UP).multiplyScalar(Math.cos(o.turn)).addScaledVector(d, Math.sin(o.turn));
      // Rolled to pull toward its side, then once through the turn, rolled upright again.
      if (o.turn < 1.75)
        _b.copy(UP).multiplyScalar(-Math.sin(o.turn)).addScaledVector(d, Math.cos(o.turn));
      else _b.copy(UP).addScaledVector(_a, -_a.y).normalize();
      o.up.lerp(_b, 1 - Math.exp(-(o.turn < 1.75 ? 7 : 2.4) * dt)).normalize();
      o.p.addScaledVector(_a, V * dt);
      orient(q, _a, o.up);
      const f = flights[k]!;
      f.pos.set([o.p.x, o.p.y, o.p.z], i * 3);
      f.quat.set([q.x, q.y, q.z, q.w], i * 4);
      f.smoke[i] = t < T_BURST + 9 ? 1 : 0;
    });
  }
  return flights;
}

/** A trail of smoke from one jet: a ribbon turned to face the camera, spreading as it drifts. */
const TRAIL_N = 72;
const TRAIL_DT = SMOKE_S / TRAIL_N;

/** Puffs of smoke, soft at the edges, tiling along the trail. */
function puffs() {
  const tex = canvasTex(256, 128, (g) => {
    // A soft continuous core, so the trail never breaks into dashes from afar.
    const core = g.createLinearGradient(0, 0, 0, 128);
    core.addColorStop(0.12, "rgba(255,255,255,0)");
    core.addColorStop(0.5, "rgba(255,255,255,0.5)");
    core.addColorStop(0.88, "rgba(255,255,255,0)");
    g.fillStyle = core;
    g.fillRect(0, 0, 256, 128);
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 56; i++) {
      const r = 12 + rnd() * 22;
      const x = rnd() * 256;
      const y = 64 + (rnd() - 0.5) * (100 - 2 * r);
      const a = 0.22 + rnd() * 0.36;
      // Drawn three times so the tile wraps without a seam.
      for (const dx of [-256, 0, 256]) {
        const grad = g.createRadialGradient(x + dx, y, 0, x + dx, y, r);
        grad.addColorStop(0, `rgba(255,255,255,${a})`);
        grad.addColorStop(1, "rgba(255,255,255,0)");
        g.fillStyle = grad;
        g.fillRect(x + dx - r, y - r, r * 2, r * 2);
      }
    }
  });
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

function smokeRibbon(color: readonly [number, number, number]) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array((TRAIL_N + 1) * 2 * 3);
  const col = new Float32Array((TRAIL_N + 1) * 2 * 4);
  const uv = new Float32Array((TRAIL_N + 1) * 2 * 2);
  for (let i = 0; i <= TRAIL_N * 2 + 1; i++) col.set([color[0], color[1], color[2], 0], i * 4);
  for (let i = 0; i <= TRAIL_N; i++) uv.set([0, 0, 0, 1], i * 4);
  const index: number[] = [];
  for (let i = 0; i < TRAIL_N; i++) {
    const a = i * 2;
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  geo.setIndex(index);
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 4));
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return geo;
}

export type Airshow = {
  group: THREE.Group;
  /** Starts a jet team pass at `time` unless one is still flying; true if it started one. */
  pass: (time: number) => boolean;
  /** The sky as it is at `time`, seen from `eye`. */
  update: (time: number, eye: THREE.Vector3) => void;
  /** How loud the jets and the propellers are at `eye`, each 0..1. */
  noise: (eye: THREE.Vector3) => { jets: number; props: number };
  /** The pull-up and burst of a pass flown wholly between `from` and `to`. */
  highlight: (from: number, to: number) => { from: number; to: number } | null;
  /** The middle of the jet team at `time`, into `out`; false if none is flying. */
  team: (time: number, out: THREE.Vector3) => boolean;
  dispose: () => void;
};

export function createAirshow(
  scene: THREE.Scene,
  opts: { night: boolean; sunColor: string },
): Airshow {
  const group = new THREE.Group();
  group.name = "airshow";
  scene.add(group);

  const ship = airship(opts.night);
  group.add(ship.group);
  const tow = bannerPlane();
  group.add(tow.group);

  const flights = planShow();
  const jetGeo = showJet();
  const jetMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.35,
    metalness: 0.25,
  });
  const jets = flights.map(() => {
    const m = new THREE.Mesh(jetGeo, jetMat);
    m.visible = false;
    group.add(m);
    return m;
  });
  // Smoke takes the light: bright in the sun, warm at golden hour, grey at dusk.
  const light = new THREE.Color(opts.sunColor).lerp(new THREE.Color(1, 1, 1), 0.5);
  if (opts.night) light.multiplyScalar(0.55);
  const puffTex = puffs();
  const smokeMat = new THREE.MeshBasicMaterial({
    map: puffTex,
    vertexColors: true,
    color: light,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const trails = flights.map((_, k) => {
    const geo = smokeRibbon(SMOKE[k]!);
    const mesh = new THREE.Mesh(geo, smokeMat);
    mesh.frustumCulled = false;
    mesh.visible = false;
    group.add(mesh);
    return mesh;
  });

  const starts: number[] = [];
  const shipFwd = new THREE.Vector3();
  const tp = new THREE.Vector3();
  const td = new THREE.Vector3();
  const bp = new THREE.Vector3();
  const bd = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const side = new THREE.Vector3();
  const along = new THREE.Vector3();
  const toEye = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  let showAt: number | null = null;

  /** Jet k of a pass `s` seconds in, into p and q; false if not yet or long gone. */
  function jetAt(k: number, s: number) {
    if (s < 0 || s > SHOW_S) return false;
    const f = flights[k]!;
    const x = s * TEAM_HZ;
    const i = Math.min(Math.floor(x), SHOW_S * TEAM_HZ - 1);
    const u = x - i;
    p.fromArray(f.pos, i * 3).lerp(_a.fromArray(f.pos, i * 3 + 3), u);
    q.fromArray(f.quat, i * 4).slerp(_q.fromArray(f.quat, i * 4 + 4), u);
    return true;
  }

  function smokeAt(k: number, s: number) {
    if (s < 0 || s > SHOW_S) return 0;
    return flights[k]!.smoke[Math.min(Math.floor(s * TEAM_HZ), SHOW_S * TEAM_HZ)]!;
  }

  /** When the pass still in the sky at `time` began (it can be before zero), or null. */
  function current(time: number) {
    for (let i = starts.length - 1; i >= 0; i--) {
      if (starts[i]! <= time) return time - starts[i]! <= SHOW_S + SMOKE_S ? starts[i]! : null;
    }
    return null;
  }

  return {
    group,
    pass(time) {
      const now = current(time);
      if (now !== null && time - now < SHOW_S) return false;
      starts.push(time);
      starts.sort((x, y) => x - y);
      return true;
    },
    update(time, eye) {
      // The airship: slow laps of its oval, nodding gently.
      const a = (time * LAP.mps) / ((LAP.rx + LAP.rz) / 2) + 2.85;
      ship.group.position.set(
        LAP.x + Math.cos(a) * LAP.rx,
        LAP.y + Math.sin(time * 0.05) * 6,
        LAP.z + Math.sin(a) * LAP.rz,
      );
      shipFwd.set(-Math.sin(a) * LAP.rx, 0, Math.cos(a) * LAP.rz).normalize();
      ship.group.quaternion.copy(orient(q, shipFwd, UP));
      ship.group.rotateX(Math.sin(time * 0.11) * 0.025);

      // The banner plane, and its banner towed along the same track behind it, flapping.
      // Started partway down the beach so it is soon in view from the menu.
      const s = time * TRACK.mps + 1650;
      trackAt(s, tp, td);
      tow.plane.position.copy(tp);
      // Banked into the turns at each end.
      trackAt(s + 25, bp, bd);
      const turn = Math.atan2(td.x * bd.z - td.z * bd.x, td.dot(bd));
      tow.plane.quaternion
        .copy(orient(q, td, UP))
        .multiply(_q.setFromAxisAngle(_b.set(0, 0, 1), -turn * 5));
      trackAt(s - TOW_M, bp, bd);
      tow.banner.position.copy(bp);
      tow.banner.position.y -= 3;
      tow.banner.quaternion.copy(orient(q, bd, UP));
      const pos = tow.banner.geometry.getAttribute("position") as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const z = tow.rest[i * 3 + 2]!;
        const k = z / BANNER_LEN;
        pos.setX(i, tow.rest[i * 3]! + Math.sin(z * 0.32 - time * 7.5) * 0.55 * k);
      }
      pos.needsUpdate = true;
      tow.banner.geometry.computeVertexNormals();
      const rp = tow.rope.geometry.getAttribute("position") as THREE.BufferAttribute;
      _a.set(0, -0.2, 4.4).applyQuaternion(tow.plane.quaternion).add(tp);
      rp.setXYZ(0, _a.x, _a.y, _a.z);
      rp.setXYZ(1, bp.x, bp.y - 0.4, bp.z);
      rp.needsUpdate = true;

      // The jet team.
      const at = current(time);
      showAt = at;
      const sNow = at !== null ? time - at : -1;
      for (let k = 0; k < jets.length; k++) {
        const jet = jets[k]!;
        jet.visible = jetAt(k, sNow);
        if (jet.visible) {
          jet.position.copy(p);
          jet.quaternion.copy(q);
        }
        const trail = trails[k]!;
        trail.visible = at !== null;
        if (!trail.visible) continue;
        const g = trail.geometry;
        const tPos = g.getAttribute("position") as THREE.BufferAttribute;
        const tCol = g.getAttribute("color") as THREE.BufferAttribute;
        const tUv = g.getAttribute("uv") as THREE.BufferAttribute;
        for (let i = 0; i <= TRAIL_N; i++) {
          const age = i * TRAIL_DT;
          const ts = sNow - age;
          const alpha = smokeAt(k, ts)
            ? 0.82 * (1 - age / SMOKE_S) ** 1.6 * Math.min(1, age * 6)
            : 0;
          jetAt(k, THREE.MathUtils.clamp(ts, 0, SHOW_S));
          // Out of the tail, drifting with the wind and spreading.
          along.set(0, 0, 1).applyQuaternion(q);
          p.addScaledVector(along, 8).add(_b.set(WIND_X * age, -0.25 * age, WIND_Z * age));
          toEye.subVectors(eye, p);
          side
            .crossVectors(along, toEye)
            .normalize()
            .multiplyScalar(1.2 + 6 * (1 - Math.exp(-age / 1.2)) + age * 1.4);
          tPos.setXYZ(i * 2, p.x - side.x, p.y - side.y, p.z - side.z);
          tPos.setXYZ(i * 2 + 1, p.x + side.x, p.y + side.y, p.z + side.z);
          tCol.setW(i * 2, alpha);
          tCol.setW(i * 2 + 1, alpha);
          // The puffs stay where they were left, in the air, as the trail ages.
          tUv.setX(i * 2, ts * 0.55 + k * 0.29);
          tUv.setX(i * 2 + 1, ts * 0.55 + k * 0.29);
        }
        tPos.needsUpdate = true;
        tCol.needsUpdate = true;
        tUv.needsUpdate = true;
      }
    },
    noise(eye) {
      let jetsN = 0;
      if (showAt !== null) {
        for (const jet of jets) {
          if (jet.visible)
            jetsN = Math.max(jetsN, Math.max(0, 1 - jet.position.distanceTo(eye) / 5000) ** 2);
        }
      }
      const props = Math.max(
        Math.max(0, 1 - tow.plane.position.distanceTo(eye) / 900) ** 2,
        0.6 * Math.max(0, 1 - ship.group.position.distanceTo(eye) / 500) ** 2,
      );
      return { jets: jetsN, props };
    },
    highlight(from, to) {
      for (let i = starts.length - 1; i >= 0; i--) {
        const a = starts[i]! + HIGHLIGHT[0];
        const b = starts[i]! + HIGHLIGHT[1];
        if (a >= from && b <= to) return { from: a, to: b };
      }
      return null;
    },
    team(time, out) {
      const at = current(time);
      if (at === null) return false;
      out.set(0, 0, 0);
      for (let k = 0; k < jets.length; k++) {
        if (!jetAt(k, time - at)) return false;
        out.addScaledVector(p, 1 / jets.length);
      }
      return true;
    },
    dispose() {
      scene.remove(group);
      ship.group.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
      ship.tex.dispose();
      ship.skin.dispose();
      ship.frameMat.dispose();
      for (const t of tow.texs) t.dispose();
      for (const m of tow.mats) m.dispose();
      for (const g of tow.geos) g.dispose();
      jetGeo.dispose();
      jetMat.dispose();
      smokeMat.dispose();
      puffTex.dispose();
      for (const t of trails) t.geometry.dispose();
    },
  };
}
