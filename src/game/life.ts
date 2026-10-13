import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { DZ_X, DZ_Z, SHORE_X } from "./constants";
import { CITY, OPEN_GROUND } from "./skyline";
import { rng } from "./world";

// The city going about its evening: traffic on Lake Shore Drive and the streets, boats on the
// lake, airliners crossing high over the water, and people on the beach and the lakefront trail.
// Everything moves on the GPU: each instance has a start point and heading in its matrix and
// a speed, path length and phase in `aMove`, and the vertex shader slides it along its path
// from the clock, so thousands of cars cost no work per frame on the CPU.

type Rgb = readonly [number, number, number];

type Mover = {
  x: number;
  y: number;
  z: number;
  /** Heading: 0 travels toward -z (north), PI toward +z. */
  yaw: number;
  speed: number;
  /** Path length; the mover wraps back to the start, or turns around if `pingpong`. */
  span: number;
  phase: number;
  pingpong?: boolean;
  color?: THREE.Color;
};

const MOVE_SHADER = /* glsl */ `
  uniform float uTime;
  attribute vec4 aMove;
  // Distance along the path, and +1 going out or -1 coming back.
  vec2 moverAt() {
    float t = aMove.z + uTime * aMove.x;
    if (aMove.w > 0.5) {
      float f = fract(t / aMove.y * 0.5);
      return f < 0.5 ? vec2(aMove.y * f * 2.0, 1.0) : vec2(aMove.y * (2.0 - f * 2.0), -1.0);
    }
    return vec2(mod(t, aMove.y), 1.0);
  }`;

/** Patches a material so each instance slides along its local -z by its `aMove` path. */
function moving<M extends THREE.Material>(mat: M, time: THREE.IUniform<number>, key: string): M {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${MOVE_SHADER}`)
      .replace(
        "#include <beginnormal_vertex>",
        "#include <beginnormal_vertex>\nobjectNormal.xz *= moverAt().y;",
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
         vec2 mv = moverAt();
         transformed.xz *= mv.y;
         transformed.z -= mv.x;`,
      );
  };
  mat.customProgramCacheKey = () => `mover-${key}`;
  return mat;
}

/** A box with one shade on top and another on the sides, as RGBA vertex colors. */
function box(
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  top: Rgb,
  side: Rgb = top,
  a = 1,
) {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  g.translate(x, y, z);
  return paint(g, (face) => (face === 2 ? top : side), a);
}

/** RGBA vertex colors by face: a non-indexed box has faces +x, -x, +y, -y, +z, -z, 6 vertices each. */
function paint(g: THREE.BufferGeometry, color: (face: number) => Rgb, alpha: number) {
  const n = g.getAttribute("position").count;
  const c = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const rgb = color(Math.floor(i / 6));
    c.set([rgb[0], rgb[1], rgb[2], alpha], i * 4);
  }
  g.setAttribute("color", new THREE.Float32BufferAttribute(c, 4));
  if (g.getAttribute("uv")) g.deleteAttribute("uv");
  return g;
}

/** A flat shape on the ground from `pts` (x, z, alpha), as a triangle fan around the first point. */
function decal(pts: readonly (readonly [number, number, number])[], y: number, rgb: Rgb) {
  const pos: number[] = [];
  const col: number[] = [];
  for (let i = 1; i < pts.length - 1; i++) {
    for (const p of [pts[0]!, pts[i]!, pts[i + 1]!]) {
      pos.push(p[0], y, p[1]);
      col.push(rgb[0], rgb[1], rgb[2], p[2]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute(
    "normal",
    new THREE.Float32BufferAttribute(
      pos.map((_, i) => (i % 3 === 1 ? 1 : 0)),
      3,
    ),
  );
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 4));
  return g;
}

function merge(parts: THREE.BufferGeometry[]) {
  const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)));
  if (!g) throw new Error("life: geometry merge failed");
  return g;
}

/** One instanced mesh per part, all sharing the movers' paths. */
function fleet(
  root: THREE.Object3D,
  movers: readonly Mover[],
  parts: readonly { geo: THREE.BufferGeometry; mat: THREE.Material; tint?: boolean }[],
) {
  if (!movers.length) return;
  const move = new THREE.InstancedBufferAttribute(new Float32Array(movers.length * 4), 4);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const one = new THREE.Vector3(1, 1, 1);
  const at = new THREE.Vector3();
  movers.forEach((v, i) =>
    move.setXYZW(i, v.speed, Math.max(v.span, 0.01), v.phase, v.pingpong ? 1 : 0),
  );
  for (const part of parts) {
    const geo = part.geo.clone();
    geo.setAttribute("aMove", move);
    const mesh = new THREE.InstancedMesh(geo, part.mat, movers.length);
    movers.forEach((v, i) => {
      q.setFromAxisAngle(up, v.yaw);
      mesh.setMatrixAt(i, m.compose(at.set(v.x, v.y, v.z), q, one));
      if (part.tint) mesh.setColorAt(i, v.color ?? new THREE.Color(1, 1, 1));
    });
    // Instances travel far from where their matrices put them.
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    root.add(mesh);
  }
}

const pick = <T>(r: () => number, list: readonly T[]) => list[Math.floor(r() * list.length)]!;
const hex = (h: string) => new THREE.Color(h);

const CAR_PAINT = [
  "#f2f3f4",
  "#f2f3f4",
  "#e9eaeb",
  "#16181b",
  "#16181b",
  "#22262b",
  "#9aa1a8",
  "#8b9197",
  "#5f666d",
  "#1e3354",
  "#7d1d1d",
  "#a8261f",
  "#2f4f3a",
  "#d9b23a",
].map(hex);
const SHIRTS = [
  "#e8463c",
  "#f2a33a",
  "#f4d35e",
  "#2f8fd8",
  "#1f4f8f",
  "#f4f4f2",
  "#2a2a2e",
  "#43a36b",
  "#d1497e",
  "#8a5bd6",
].map(hex);
const SKIN = ["#f1c7a1", "#e0ac84", "#c68a62", "#9a6440", "#6e4429"].map(hex);
const BRIGHT = [
  "#e8463c",
  "#f2a33a",
  "#f4d35e",
  "#2f8fd8",
  "#43a36b",
  "#d1497e",
  "#f4f4f2",
  "#18a3a8",
].map(hex);

export type Life = { update: (time: number) => void };

export function createLife(
  scene: THREE.Scene,
  opts: {
    coarse: boolean;
    night: boolean;
    onTop: (m: THREE.Material, k: number) => THREE.Material;
  },
): Life {
  const { coarse, night, onTop } = opts;
  const time = { value: 0 };
  const root = new THREE.Group();
  root.name = "life";
  scene.add(root);
  const r = rng(91);

  const solid = (key: string, side: THREE.Side = THREE.FrontSide) =>
    moving(
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.2, side }),
      time,
      key,
    );
  // Cars sit a hair over the road, which is itself pulled forward in depth; keep them on top of it.
  const carMat = onTop(solid("car"), 4);
  const glowMat = (key: string) =>
    onTop(
      moving(
        new THREE.MeshBasicMaterial({
          vertexColors: true,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        }),
        time,
        key,
      ),
      6,
    );

  // ---- Vehicles ----
  const glass: Rgb = [0.18, 0.2, 0.23];
  const car = merge([
    box(1.8, 0.85, 4.4, 0, 0.55, 0, [1, 1, 1]),
    box(1.6, 0.6, 2.3, 0, 1.27, 0.25, [1, 1, 1], glass),
  ]);
  const bus = merge([
    box(2.55, 2.9, 12, 0, 1.6, 0, [0.92, 0.93, 0.94], [0.92, 0.93, 0.94]),
    box(2.6, 0.9, 10.6, 0, 2.1, 0.2, [0.92, 0.93, 0.94], glass),
  ]);
  // Headlights throw a fan of warm light down the road; taillights glow red behind.
  const lights = (front: number, back: number) =>
    merge([
      decal(
        [
          [0, front, 0.55],
          [-1.1, front - 1, 0.5],
          [-3.6, front - 20, 0],
          [0, front - 22, 0],
          [3.6, front - 20, 0],
          [1.1, front - 1, 0.5],
        ],
        0.22,
        [1, 0.84, 0.6],
      ),
      box(1.7, 0.08, 0.35, 0, 0.75, front, [1, 0.93, 0.78], [1, 0.93, 0.78]),
      box(1.7, 0.08, 0.3, 0, 0.8, back, [1, 0.06, 0.04], [1, 0.06, 0.04]),
      decal(
        [
          [0, back, 0.35],
          [-1.2, back, 0.3],
          [0, back + 4, 0],
          [1.2, back, 0.3],
        ],
        0.21,
        [1, 0.08, 0.04],
      ),
    ]);
  const carLights = lights(-2.25, 2.25);
  const busLights = lights(-6.05, 6.05);

  const cars: Mover[] = [];
  const buses: Mover[] = [];
  const add = (m: Mover) => (r() < 0.03 ? buses : cars).push({ ...m, color: pick(r, CAR_PAINT) });

  // Lake Shore Drive: three lanes each way, northbound nearest the lake.
  const LSD_Z0 = -8000;
  const LSD_Z1 = 6000;
  const lanes: { x: number; north: boolean; speed: number }[] = [
    { x: -15.2, north: true, speed: 24 },
    { x: -12.0, north: true, speed: 27.5 },
    { x: -8.8, north: true, speed: 30 },
    { x: -20.8, north: false, speed: 30.5 },
    { x: -24.0, north: false, speed: 27 },
    { x: -27.2, north: false, speed: 23.5 },
  ];
  const lsdGap = coarse ? 150 : 72;
  for (const lane of lanes) {
    const span = LSD_Z1 - LSD_Z0;
    for (let s = r() * 40; s < span; s += lsdGap * (0.35 + r() * 1.3)) {
      add({
        x: lane.x,
        y: 0.07,
        z: lane.north ? LSD_Z1 : LSD_Z0,
        yaw: lane.north ? 0 : Math.PI,
        speed: lane.speed,
        span,
        phase: s,
      });
    }
  }

  // City streets on the ground texture's grid, skipping the parks; every fourth is an arterial.
  const B = CITY.block;
  const blocked = (x: number, z: number) =>
    OPEN_GROUND.some((g) => x > g.x0 - 12 && x < g.x1 + 12 && z > g.z0 - 12 && z < g.z1 + 12);
  const runs: { a: THREE.Vector2; b: THREE.Vector2; major: boolean }[] = [];
  const walk = (from: THREE.Vector2, step: THREE.Vector2, n: number, major: boolean) => {
    let start: THREE.Vector2 | null = null;
    for (let k = 0; k <= n; k++) {
      const p = from.clone().addScaledVector(step, k);
      const ok = !blocked(p.x, p.y) && p.x < -60;
      if (ok && !start) start = p;
      if ((!ok || k === n) && start) {
        const end = ok ? p : p.clone().addScaledVector(step, -1);
        if (end.distanceTo(start) > 300) runs.push({ a: start, b: end, major });
        start = null;
      }
    }
  };
  const cols = Math.round((CITY.x1 - CITY.x0) / B);
  const rows = Math.round((CITY.z1 - CITY.z0) / B);
  for (let j = 1; j < rows; j++)
    walk(
      new THREE.Vector2(CITY.x0 + B, CITY.z1 - j * B),
      new THREE.Vector2(B, 0),
      cols - 2,
      j % 4 === 0,
    );
  for (let i = 1; i < cols - 1; i++)
    walk(
      new THREE.Vector2(CITY.x0 + i * B, CITY.z1 - B),
      new THREE.Vector2(0, -B),
      rows - 2,
      i % 4 === 0,
    );
  const cap = coarse ? 600 : 1700;
  const total = runs.reduce((s, run) => s + run.a.distanceTo(run.b) * (run.major ? 1 : 0.22), 0);
  const per = cap / Math.max(total, 1);
  const dir = new THREE.Vector2();
  for (const run of runs) {
    const len = run.a.distanceTo(run.b);
    dir.subVectors(run.b, run.a).normalize();
    const n = Math.round(len * per * (run.major ? 1 : 0.22));
    for (let k = 0; k < n; k++) {
      const back = r() < 0.5;
      const from = back ? run.b : run.a;
      const d = back ? -1 : 1;
      // Drive on the right: offset to the right of travel.
      const ox = -dir.y * d * 3.2;
      const oz = dir.x * d * 3.2;
      add({
        x: from.x + ox,
        y: 0.07,
        z: from.y + oz,
        yaw: Math.atan2(-dir.x * d, -dir.y * d),
        speed: (run.major ? 12 : 9) + r() * 3,
        span: len,
        phase: r() * len,
      });
    }
  }

  fleet(root, cars, [
    { geo: car, mat: carMat, tint: true },
    ...(night ? [{ geo: carLights, mat: glowMat("car-lights") }] : []),
  ]);
  fleet(root, buses, [
    { geo: bus, mat: carMat },
    ...(night ? [{ geo: busLights, mat: glowMat("bus-lights") }] : []),
  ]);

  // ---- Boats ----
  const white: Rgb = [0.95, 0.96, 0.96];
  const motor = merge([
    box(2.4, 1, 7, 0, 0.4, 0, white),
    box(1.2, 1, 1.2, 0, 0.4, -3.9, white),
    box(1.8, 0.9, 2.2, 0, 1.3, 0.6, white, [0.25, 0.3, 0.35]),
  ]);
  const tour = merge([
    box(7, 2.4, 30, 0, 0.7, 0, white),
    box(6.2, 2.2, 22, 0, 3, 1.5, white, [0.2, 0.24, 0.3]),
    box(5.6, 1.8, 12, 0, 5, 3, white, [0.2, 0.24, 0.3]),
  ]);
  const sailGeo = (() => {
    const sail = new THREE.BufferGeometry();
    sail.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([0, 1.6, -0.6, 0, 12.5, -0.4, 0, 1.6, 3.6], 3),
    );
    sail.setAttribute("normal", new THREE.Float32BufferAttribute([1, 0, 0, 1, 0, 0, 1, 0, 0], 3));
    paint(sail, () => [0.97, 0.96, 0.92], 1);
    const jib = new THREE.BufferGeometry();
    jib.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([0, 1.4, -3.8, 0, 11.5, -0.7, 0, 1.4, -0.9], 3),
    );
    jib.setAttribute("normal", new THREE.Float32BufferAttribute([1, 0, 0, 1, 0, 0, 1, 0, 0], 3));
    paint(jib, () => [0.95, 0.95, 0.93], 1);
    return merge([
      box(2, 0.9, 8, 0, 0.35, 0, white),
      box(0.12, 12, 0.12, 0, 6.5, -0.6, [0.7, 0.7, 0.72]),
      sail,
      jib,
    ]);
  })();
  const wake = (len: number, half: number, stern: number) =>
    merge([
      decal(
        [
          [0, stern, 0.55],
          [-half * 0.5, stern + 1, 0.5],
          [-half * 4, stern + len, 0],
          [half * 4, stern + len, 0],
          [half * 0.5, stern + 1, 0.5],
        ],
        0.25,
        [0.92, 0.96, 0.97],
      ),
      decal(
        [
          [0, stern, 0.6],
          [-half, stern + 0.5, 0.55],
          [-half * 0.6, stern + len * 0.6, 0],
          [half * 0.6, stern + len * 0.6, 0],
          [half, stern + 0.5, 0.55],
        ],
        0.27,
        [0.97, 0.99, 1],
      ),
    ]);
  const foamMat = moving(
    new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }),
    time,
    "wake",
  );

  const motors: Mover[] = [];
  const sails: Mover[] = [];
  const tours: Mover[] = [];
  const boatN = coarse ? 0.5 : 1;
  // Open water: east of the lighthouse breakwater, which is the farthest thing out from shore.
  const OPEN_X = 2050;
  const offshore = (x: number, yaw: number, len: number) => {
    const end = x - Math.sin(yaw) * len;
    return x + Math.max(0, OPEN_X - Math.min(x, end));
  };
  for (let i = 0; i < Math.round(18 * boatN); i++) {
    const north = r() < 0.5;
    const yaw = (north ? 0 : Math.PI) + (r() - 0.5) * 0.24;
    const span = 9000;
    motors.push({
      // Start far enough back that each crossing passes the beach.
      x: offshore(OPEN_X + r() * 3200, yaw, span),
      y: 0.35,
      z: north ? 4500 : -4500,
      yaw,
      speed: 9 + r() * 8,
      span,
      phase: r() * span,
      color:
        r() < 0.75 ? hex("#ffffff") : pick(r, [hex("#1f3a66"), hex("#a8261f"), hex("#262a30")]),
    });
  }
  for (let i = 0; i < Math.round(22 * boatN); i++) {
    const yaw = r() * Math.PI * 2;
    sails.push({
      x: offshore(OPEN_X + 200 + r() * 3000, yaw, 1600),
      y: 0.3,
      z: -4200 + r() * 7000,
      yaw,
      speed: 2.5 + r() * 2.5,
      span: 1600,
      phase: r() * 3200,
      pingpong: true,
    });
  }
  // Lake cruises run between Navy Pier and Museum Campus, inside the lighthouse breakwater.
  for (let i = 0; i < 2; i++) {
    tours.push({
      x: 1000 + i * 130,
      y: 0.4,
      z: -2900,
      yaw: Math.PI,
      speed: 5.5,
      span: 3600,
      phase: i * 3600,
      pingpong: true,
    });
  }
  fleet(root, motors, [
    { geo: motor, mat: solid("motor"), tint: true },
    { geo: wake(38, 1.2, 3.6), mat: foamMat },
  ]);
  fleet(root, sails, [{ geo: sailGeo, mat: solid("sail", THREE.DoubleSide) }]);
  fleet(root, tours, [
    { geo: tour, mat: solid("tour") },
    { geo: wake(70, 3.4, 15), mat: foamMat },
  ]);

  // ---- Airliners crossing high over the lake toward Midway and O'Hare ----
  const jet = merge([
    box(3.6, 3.6, 38, 0, 0, 0, [0.96, 0.97, 0.98]),
    box(34, 0.5, 6, 0, -0.6, 1, [0.82, 0.84, 0.86]),
    box(12, 0.35, 3.2, 0, 0.6, 17, [0.82, 0.84, 0.86]),
    box(0.4, 6.5, 4, 0, 4, 17.5, [0.2, 0.3, 0.6]),
    box(2.2, 2.2, 4.4, -6.5, -2, -1, [0.7, 0.72, 0.75]),
    box(2.2, 2.2, 4.4, 6.5, -2, -1, [0.7, 0.72, 0.75]),
  ]);
  const jets: Mover[] = [
    {
      x: -30000,
      y: 1900,
      z: 9000,
      yaw: -Math.PI / 2 + 0.06,
      speed: 125,
      span: 60000,
      phase: 21000,
    },
    { x: 30000, y: 2700, z: -12000, yaw: Math.PI / 2 - 0.1, speed: 150, span: 60000, phase: 34000 },
    {
      x: -30000,
      y: 1300,
      z: 15000,
      yaw: -Math.PI / 2 - 0.04,
      speed: 110,
      span: 60000,
      phase: 5000,
    },
  ];
  fleet(root, jets, [
    {
      geo: jet,
      mat: moving(
        new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.3 }),
        time,
        "jet",
      ),
    },
  ]);
  if (night) {
    const nav = merge([
      box(0.9, 0.9, 0.9, -17, -0.6, 1, [1, 0.1, 0.08]),
      box(0.9, 0.9, 0.9, 17, -0.6, 1, [0.1, 1, 0.3]),
      box(0.8, 0.8, 0.8, 0, 7.4, 19, [1, 1, 1]),
      box(0.7, 0.4, 0.7, 0, -1.9, 0, [1, 0.15, 0.1]),
    ]);
    fleet(root, jets, [
      {
        geo: nav,
        mat: moving(
          new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
          time,
          "nav",
        ),
      },
    ]);
  }

  // ---- People ----
  const skinPart = merge([
    box(0.22, 0.24, 0.22, 0, 1.6, 0, [1, 1, 1]),
    box(0.13, 0.8, 0.13, -0.11, 0.4, 0, [1, 1, 1]),
    box(0.13, 0.8, 0.13, 0.11, 0.4, 0, [1, 1, 1]),
    box(0.1, 0.55, 0.1, -0.29, 1.12, 0, [1, 1, 1]),
    box(0.1, 0.55, 0.1, 0.29, 1.12, 0, [1, 1, 1]),
  ]);
  const clothesPart = merge([
    box(0.46, 0.62, 0.26, 0, 1.15, 0, [1, 1, 1]),
    box(0.42, 0.26, 0.24, 0, 0.74, 0, [0.35, 0.37, 0.42]),
  ]);
  // Lying on a towel: the same body tipped onto its back.
  const lie = (g: THREE.BufferGeometry) => {
    const c = g.clone();
    c.rotateX(-Math.PI / 2);
    c.translate(0, 0.12, -0.85);
    return c;
  };
  const towel = box(0.9, 0.02, 1.9, 0, 0.03, 0, [1, 1, 1]);
  const umbrella = merge([
    paint(
      new THREE.ConeGeometry(1.35, 0.55, 10, 1, true).translate(0, 2.25, 0).toNonIndexed(),
      () => [1, 1, 1],
      1,
    ),
    box(0.05, 2.2, 0.05, 0, 1.1, 0, [0.85, 0.85, 0.85]),
  ]);

  const standing: Mover[] = [];
  const lying: Mover[] = [];
  const umbrellas: Mover[] = [];
  const keepClear = (x: number, z: number) =>
    Math.hypot(x - DZ_X, z - DZ_Z) < 48 ||
    (Math.abs(x - (DZ_X - 10)) < 22 && Math.abs(z - (DZ_Z - 2)) < 26);
  const person = (m: Omit<Mover, "color">, list = standing) =>
    list.push({ ...m, color: undefined });
  const n = coarse ? 0.5 : 1;
  for (let i = 0, made = 0; i < 400 && made < 60 * n; i++) {
    const x = 34 + r() * 112;
    const z = -900 + r() * 1700;
    if (keepClear(x, z)) continue;
    person({ x, y: 0.05, z, yaw: r() * 6.28, speed: 0, span: 1, phase: 0 });
    made++;
  }
  for (let i = 0, made = 0; i < 400 && made < 50 * n; i++) {
    const x = 40 + r() * 100;
    const span = 60 + r() * 260;
    const z = -900 + r() * 1500;
    if (keepClear(x, z) || keepClear(x, z - span) || keepClear(x, z - span / 2)) continue;
    person({
      x,
      y: 0.05,
      z,
      yaw: 0,
      speed: 1.1 + r() * 0.5,
      span,
      phase: r() * span * 2,
      pingpong: true,
    });
    made++;
  }
  // Wading at the water's edge.
  for (let i = 0; i < 14 * n; i++) {
    const z = -700 + r() * 1300;
    if (Math.abs(z - DZ_Z) < 30) continue;
    person({
      x: SHORE_X + 2 + r() * 22,
      y: -0.55,
      z,
      yaw: r() * 6.28,
      speed: 0,
      span: 1,
      phase: 0,
    });
  }
  // Runners and cyclists on the Lakefront Trail.
  for (let i = 0; i < 50 * n; i++) {
    const north = r() < 0.5;
    const bike = r() < 0.4;
    person({
      x: (north ? 8 : 4) + r() * 1.5,
      y: 0.09,
      z: north ? 1600 : -1600,
      yaw: north ? 0 : Math.PI,
      speed: bike ? 5.5 + r() * 2 : 2.6 + r(),
      span: 3200,
      phase: r() * 3200,
    });
  }
  // Watching the landings from beside the tent.
  for (let i = 0; i < 9; i++) {
    const x = DZ_X - 20 + r() * 9;
    const z = DZ_Z + 18 + r() * 6;
    // Facing the target: local -z points along (DZ - here).
    person({
      x,
      y: 0.05,
      z,
      yaw: Math.atan2(x - DZ_X, z - DZ_Z) + (r() - 0.5) * 0.6,
      speed: 0,
      span: 1,
      phase: 0,
    });
  }
  for (let i = 0, made = 0; i < 300 && made < 34 * n; i++) {
    const x = 46 + r() * 80;
    const z = -800 + r() * 1500;
    if (keepClear(x, z)) continue;
    const yaw = r() * 6.28;
    person({ x, y: 0.05, z, yaw, speed: 0, span: 1, phase: 0 }, lying);
    if (r() < 0.6)
      umbrellas.push({
        x: x + 1.4,
        y: 0,
        z: z - 0.4,
        yaw: 0,
        speed: 0,
        span: 1,
        phase: 0,
        color: pick(r, BRIGHT),
      });
    made++;
  }
  for (const p of standing) p.color = pick(r, SHIRTS);
  for (const p of lying) p.color = pick(r, BRIGHT);
  const skinTone = (list: Mover[]) => list.map((p) => ({ ...p, color: pick(r, SKIN) }));
  const flesh = solid("flesh");
  const cloth = solid("cloth");
  fleet(root, skinTone(standing), [{ geo: skinPart, mat: flesh, tint: true }]);
  fleet(root, standing, [{ geo: clothesPart, mat: cloth, tint: true }]);
  fleet(root, skinTone(lying), [{ geo: lie(skinPart), mat: flesh, tint: true }]);
  fleet(root, lying, [
    { geo: lie(clothesPart), mat: cloth },
    { geo: towel, mat: cloth, tint: true },
  ]);
  fleet(root, umbrellas, [{ geo: umbrella, mat: solid("umbrella", THREE.DoubleSide), tint: true }]);

  return {
    update(t) {
      time.value = t;
    },
  };
}
