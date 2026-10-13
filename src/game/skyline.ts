import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { SHORE_X } from "./constants";
import { Solids } from "./solids";
import { rng } from "./world";

// Downtown Chicago at true scale, so the skyline stands where it really does from 12th Street
// Beach: Willis about 2.4 km to the northwest, the Hancock 4 km up the shore, Navy Pier a
// kilometer out into the lake 3 km north. Places come from real latitude and longitude: z is
// meters south of the beach, and x is meters from the lake edge at that latitude, because the
// game's shore runs straight where the real one bends around harbors and Northerly Island.
// Museum Campus sits on Northerly Island's neck in real life, so it is placed by hand.

const LAT0 = 41.8638;
const M_PER_LAT = 111_050;
const M_PER_LON = 82_850; // at 41.87° N

/** The real lake edge by latitude, ignoring harbor breakwaters and piers. */
const SHORE: readonly (readonly [number, number])[] = [
  [41.85, -87.614],
  [41.8885, -87.613],
  [41.8917, -87.611],
  [41.8945, -87.6115],
  [41.8975, -87.6165],
  [41.91, -87.625],
  [41.925, -87.63],
];

function shoreLon(lat: number) {
  let prev = SHORE[0]!;
  if (lat <= prev[0]) return prev[1];
  for (const next of SHORE) {
    if (lat <= next[0])
      return prev[1] + ((lat - prev[0]) / (next[0] - prev[0] || 1)) * (next[1] - prev[1]);
    prev = next;
  }
  return prev[1];
}

/** Where a real place sits in the game. */
export function geo(lat: number, lon: number) {
  return { x: SHORE_X + (lon - shoreLon(lat)) * M_PER_LON, z: -(lat - LAT0) * M_PER_LAT };
}

/** The near city ground. Its texture's street grid is the grid the blocks of buildings sit on. */
export const CITY = { x0: -2508, x1: -8, z0: -5300, z1: 3100, block: 820 / 8 } as const;

// Facade tiles are four bays (3 m) wide by four floors (4 m) tall. Every UV below is in meters.
const TILE_W = 12;
const TILE_H = 16;

type Painter = (g: CanvasRenderingContext2D, r: () => number) => void;

function facadeTex(seed: number, aniso: number, paint: Painter) {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const g = c.getContext("2d");
  if (g) paint(g, rng(seed));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1 / TILE_W, 1 / TILE_H);
  tex.anisotropy = aniso;
  return tex;
}

type Rect4 = readonly [number, number, number, number];

/** Where the glass is in one 32 px bay of a facade tile: x, y, width, height. */
const PANE: Rect4 = [6, 4, 20, 20];
const FIN_PANE: Rect4 = [19, 3, 11, 26];
const BAND_PANE: Rect4 = [2, 3, 28, 17];

/**
 * Lit offices for an emissive map: eight bays by eight floors, so the pattern repeats every
 * 24 m by 32 m. Some floors burn bright end to end; most are a scatter of lit rooms.
 */
function litWindows(seed: number, aniso: number, pane: Rect4) {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const g = c.getContext("2d");
  if (g) {
    const r = rng(seed + 100);
    g.fillStyle = "#000";
    g.fillRect(0, 0, 256, 256);
    for (let row = 0; row < 8; row++) {
      const share = r() < 0.18 ? 0.9 : 0.1 + r() * 0.35;
      for (let col = 0; col < 8; col++) {
        if (r() > share) continue;
        const k = r();
        g.fillStyle = k < 0.55 ? "#ffcf8f" : k < 0.85 ? "#fff0d6" : "#d6e6ff";
        g.globalAlpha = 0.55 + r() * 0.45;
        g.fillRect(col * 32 + pane[0], row * 32 + pane[1], pane[2], pane[3]);
      }
    }
    g.globalAlpha = 1;
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1 / (TILE_W * 2), 1 / (TILE_H * 2));
  tex.anisotropy = aniso;
  return tex;
}

const tint = (hex: string, k: number) => new THREE.Color(hex).multiplyScalar(k).getStyle();

/** Glass curtain wall: panes, a spandrel band per floor and mullions between bays. */
function curtain(glass: string, mullion: string, spandrel: string, band = 0.22): Painter {
  return (g, r) => {
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) {
        g.fillStyle = tint(glass, 0.85 + r() * 0.3);
        g.fillRect(col * 32, row * 32, 32, 32);
      }
      g.fillStyle = spandrel;
      g.fillRect(0, row * 32 + 32 * (1 - band), 128, 32 * band);
    }
    g.fillStyle = mullion;
    for (let col = 0; col < 4; col++) g.fillRect(col * 32, 0, 3, 128);
  };
}

/** Masonry with punched windows. */
function punched(wall: string, window: string): Painter {
  return (g, r) => {
    g.fillStyle = wall;
    g.fillRect(0, 0, 128, 128);
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) {
        g.fillStyle = tint(window, 0.8 + r() * 0.4);
        g.fillRect(col * 32 + 8, row * 32 + 6, 16, 18);
      }
    }
  };
}

/** Tall stone fins with dark glass between them. */
function fins(stone: string, glass: string): Painter {
  return (g) => {
    g.fillStyle = glass;
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = stone;
    for (let col = 0; col < 4; col++) g.fillRect(col * 32, 0, 18, 128);
    g.fillStyle = "rgba(0,0,0,0.12)";
    for (let row = 0; row < 4; row++) g.fillRect(0, row * 32, 128, 2);
  };
}

/** Balcony slabs: a white band per floor, optionally rippling. */
function bands(glass: string, slab: string, ripple: number): Painter {
  return (g) => {
    g.fillStyle = glass;
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = slab;
    for (let row = 0; row < 4; row++) {
      g.beginPath();
      g.moveTo(0, row * 32 + 32);
      for (let x = 0; x <= 128; x += 8)
        g.lineTo(x, row * 32 + 22 - Math.sin((x / 128) * Math.PI * 2 + row) * ripple);
      g.lineTo(128, row * 32 + 32);
      g.closePath();
      g.fill();
    }
  };
}

/** A box standing on y = 0 with UVs in meters, optionally tapered to a smaller top. */
function block(w: number, h: number, d: number, top?: readonly [number, number]) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.getAttribute("uv") as THREE.BufferAttribute;
  const faces = [d, d, w, w, w, w];
  const ups = [h, h, d, d, h, h];
  for (let f = 0; f < 6; f++) {
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      uv.setXY(k, uv.getX(k) * (faces[f] ?? 1), uv.getY(k) * (ups[f] ?? 1));
    }
  }
  geo.translate(0, h / 2, 0);
  if (top) {
    const pos = geo.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) > h / 2)
        pos.setXYZ(i, (pos.getX(i) * top[0]) / w, pos.getY(i), (pos.getZ(i) * top[1]) / d);
    }
    geo.computeVertexNormals();
    // So the solid you can land on narrows with it.
    geo.userData.taper = [top[0] / w, top[1] / d];
  }
  return geo;
}

/** A cylinder or cone standing on y = 0 with UVs in meters. */
function tube(rTop: number, rBottom: number, h: number, segments: number) {
  const geo = new THREE.CylinderGeometry(rTop, rBottom, h, segments, 1);
  const uv = geo.getAttribute("uv") as THREE.BufferAttribute;
  const side = (segments + 1) * 2;
  const around = Math.PI * (rTop + rBottom);
  for (let i = 0; i < uv.count; i++) {
    if (i < side) uv.setXY(i, uv.getX(i) * around, uv.getY(i) * h);
    else uv.setXY(i, uv.getX(i) * rBottom * 2, uv.getY(i) * rBottom * 2);
  }
  geo.translate(0, h / 2, 0);
  return geo;
}

/** A plan shape (x east, y north) extruded up from y = 0. Extrusion UVs are already in meters. */
function prism(shape: THREE.Shape, h: number) {
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: h,
    bevelEnabled: false,
    curveSegments: 24,
  });
  geo.rotateX(-Math.PI / 2);
  return geo;
}

/** Thin bars between point pairs, merged into one mesh. */
function bars(pairs: readonly (readonly [THREE.Vector3, THREE.Vector3])[], r: number) {
  const parts: THREE.BufferGeometry[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  const dir = new THREE.Vector3();
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  for (const [a, b] of pairs) {
    dir.subVectors(b, a);
    const len = dir.length() || 1;
    const geo = new THREE.CylinderGeometry(r, r, len, 5, 1, true);
    q.setFromUnitVectors(up, dir.normalize());
    m.compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1));
    geo.applyMatrix4(m);
    parts.push(geo);
  }
  const merged = mergeGeometries(parts) ?? new THREE.BufferGeometry();
  for (const p of parts) p.dispose();
  return merged;
}

type Skin = { wall: THREE.Material; roof: THREE.Material };

function put(
  parent: THREE.Object3D,
  geo: THREE.BufferGeometry,
  skin: Skin | THREE.Material,
  x: number,
  y: number,
  z: number,
  ry = 0,
) {
  let material: THREE.Material | THREE.Material[];
  if (skin instanceof THREE.Material) material = skin;
  else if (geo instanceof THREE.BoxGeometry)
    material = [skin.wall, skin.wall, skin.roof, skin.roof, skin.wall, skin.wall];
  else if (geo instanceof THREE.CylinderGeometry) material = [skin.wall, skin.roof, skin.roof];
  else if (geo instanceof THREE.ExtrudeGeometry) material = [skin.roof, skin.wall];
  else material = skin.wall;
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(x, y, z);
  mesh.rotation.y = ry;
  parent.add(mesh);
  return mesh;
}

/** Boxes stacked one on another, each [width, depth, height]. Returns the height reached. */
function stack(
  parent: THREE.Object3D,
  skin: Skin,
  tiers: readonly (readonly [number, number, number])[],
  y0 = 0,
) {
  let y = y0;
  for (const [w, d, h] of tiers) {
    put(parent, block(w, h, d), skin, 0, y, 0);
    y += h;
  }
  return y;
}

function makeSkins(aniso: number, glow: number) {
  const roof = new THREE.MeshStandardMaterial({ color: "#5d6266", roughness: 0.92 });
  // Offices light up as the sun goes down; by day the towers keep their plain glass.
  const lit = (seed: number, pane: Rect4): THREE.MeshStandardMaterialParameters =>
    glow > 0
      ? { emissive: "#ffffff", emissiveMap: litWindows(seed, aniso, pane), emissiveIntensity: glow }
      : {};
  const glassSkin = (
    seed: number,
    paint: Painter,
    opts: THREE.MeshStandardMaterialParameters = {},
    pane = PANE,
  ): Skin => ({
    wall: new THREE.MeshStandardMaterial({
      map: facadeTex(seed, aniso, paint),
      roughness: 0.22,
      metalness: 0.62,
      ...lit(seed, pane),
      ...opts,
    }),
    roof,
  });
  const stoneSkin = (
    seed: number,
    paint: Painter,
    opts: THREE.MeshStandardMaterialParameters = {},
    pane = PANE,
  ): Skin => ({
    wall: new THREE.MeshStandardMaterial({
      map: facadeTex(seed, aniso, paint),
      roughness: 0.78,
      ...lit(seed, pane),
      ...opts,
    }),
    roof,
  });
  return {
    roof,
    willis: glassSkin(1, curtain("#2a2622", "#0d0f12", "#121418", 0.3), {
      metalness: 0.55,
      roughness: 0.3,
    }),
    hancock: glassSkin(2, curtain("#2c2b29", "#101215", "#15171a", 0.34), {
      metalness: 0.5,
      roughness: 0.32,
    }),
    trump: glassSkin(3, curtain("#9fb4c4", "#dfe6ea", "#7d8d98", 0.14), {
      metalness: 0.75,
      roughness: 0.14,
    }),
    aon: stoneSkin(4, fins("#e9e7e2", "#3a434b"), { roughness: 0.62 }, FIN_PANE),
    regis: glassSkin(5, curtain("#5f9fae", "#c9dde1", "#4b7f8b", 0.12), {
      metalness: 0.72,
      roughness: 0.14,
    }),
    pru: stoneSkin(6, punched("#b9a99e", "#3d434a")),
    aqua: glassSkin(
      7,
      bands("#5e8ea6", "#f2f3f1", 5),
      { metalness: 0.3, roughness: 0.4 },
      BAND_PANE,
    ),
    marina: stoneSkin(8, bands("#2a3138", "#efeee8", 3), { roughness: 0.6 }, BAND_PANE),
    bronze: glassSkin(9, curtain("#3a2e24", "#1a1612", "#2a221c", 0.25), {
      metalness: 0.65,
      roughness: 0.2,
    }),
    marble: stoneSkin(10, punched("#e4e0d8", "#4a525a")),
    limestone: stoneSkin(11, punched("#d6cbb6", "#3e444a")),
    pink: stoneSkin(12, punched("#c19a8c", "#30363d")),
    brown: stoneSkin(13, punched("#6f5047", "#22272d")),
    granite: stoneSkin(14, fins("#8d9aa4", "#2d363f"), { roughness: 0.55 }, FIN_PANE),
    green: glassSkin(15, curtain("#5f9a86", "#cfe0d8", "#4a7a6b", 0.1), {
      metalness: 0.7,
      roughness: 0.12,
    }),
    blue: glassSkin(16, curtain("#5b7b96", "#c5d2dc", "#46607a", 0.18)),
    silver: glassSkin(17, curtain("#8ea2b2", "#e1e7eb", "#6c7d8a", 0.2)),
    dark: glassSkin(18, curtain("#2b3540", "#11161c", "#1a2129", 0.24)),
    tan: stoneSkin(19, punched("#cdbb9f", "#3d444b")),
    terracotta: stoneSkin(20, punched("#f1ede4", "#46505a"), { roughness: 0.5 }),
    mast: new THREE.MeshStandardMaterial({ color: "#d9dde0", roughness: 0.45, metalness: 0.6 }),
    steel: new THREE.MeshStandardMaterial({ color: "#3a4047", roughness: 0.4, metalness: 0.7 }),
    lantern: new THREE.MeshStandardMaterial({
      color: "#f4f7fa",
      emissive: new THREE.Color("#fff3df"),
      emissiveIntensity: 0.6 + glow * 0.8,
      roughness: 0.2,
    }),
  };
}

type Skins = ReturnType<typeof makeSkins>;

type SkinName = { [K in keyof Skins]: Skins[K] extends Skin ? K : never }[keyof Skins];

type Landmark = { lat: number; lon: number; r: number; build: (s: Skins) => THREE.Object3D };

const tower =
  (skin: SkinName, tiers: readonly (readonly [number, number, number])[], spire = 0) =>
  (s: Skins) => {
    const g = new THREE.Group();
    const y = stack(g, s[skin], tiers);
    if (spire) put(g, tube(0.25, 1.2, spire, 6), s.mast, 0, y, 0);
    return g;
  };

// Heights are the real ones in meters; footprints are close.
const LANDMARKS: Landmark[] = [
  {
    // Willis Tower: nine bundled tubes that stop at 50, 66, 90 and 108 floors.
    lat: 41.8789,
    lon: -87.6359,
    r: 52,
    build: (s) => {
      const g = new THREE.Group();
      const side = 22.9;
      const tops = [
        [205, 369, 269],
        [442, 442, 369],
        [269, 369, 205],
      ];
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 3; col++) {
          const h = tops[row]?.[col] ?? 200;
          put(g, block(side, h, side), s.willis, (col - 1) * side, 0, (row - 1) * side);
        }
      }
      for (const x of [-side * 0.9, side * 0.1]) put(g, tube(0.5, 1.3, 85, 6), s.mast, x, 442, 0);
      return g;
    },
  },
  {
    // The Hancock: a tapering black tower braced by giant X's, with twin antennas.
    lat: 41.8989,
    lon: -87.6234,
    r: 50,
    build: (s) => {
      const g = new THREE.Group();
      const H = 344;
      put(g, block(50, H, 80, [30, 49]), s.hancock, 0, 0, 0);
      const hw = (y: number) => THREE.MathUtils.lerp(25, 15, y / H) + 0.5;
      const hd = (y: number) => THREE.MathUtils.lerp(40, 24.5, y / H) + 0.5;
      const pairs: [THREE.Vector3, THREE.Vector3][] = [];
      const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
      for (let t = 0; t < 5; t++) {
        const y0 = (t * H) / 5;
        const y1 = ((t + 1) * H) / 5;
        for (const sx of [-1, 1]) {
          pairs.push([V(sx * hw(y0), y0, -hd(y0)), V(sx * hw(y1), y1, hd(y1))]);
          pairs.push([V(sx * hw(y0), y0, hd(y0)), V(sx * hw(y1), y1, -hd(y1))]);
          pairs.push([V(sx * hw(y1), y1, -hd(y1)), V(sx * hw(y1), y1, hd(y1))]);
        }
        for (const sz of [-1, 1]) {
          pairs.push([V(-hw(y0), y0, sz * hd(y0)), V(hw(y1), y1, sz * hd(y1))]);
          pairs.push([V(hw(y0), y0, sz * hd(y0)), V(-hw(y1), y1, sz * hd(y1))]);
          pairs.push([V(-hw(y1), y1, sz * hd(y1)), V(hw(y1), y1, sz * hd(y1))]);
        }
      }
      put(g, bars(pairs, 0.9), s.steel, 0, 0, 0);
      for (const z of [-11, 11]) put(g, tube(0.6, 1.6, 105, 6), s.mast, 0, H, z);
      return g;
    },
  },
  {
    // Trump Tower: silver glass that steps back at the heights of its neighbors, then a spire.
    lat: 41.8889,
    lon: -87.6264,
    r: 45,
    build: tower(
      "trump",
      [
        [74, 40, 70],
        [64, 37, 45],
        [54, 33, 80],
        [44, 29, 162],
      ],
      66,
    ),
  },
  // Aon Center: a plain white slab of stone fins.
  { lat: 41.8853, lon: -87.6215, r: 45, build: tower("aon", [[59, 59, 346]]) },
  {
    // St. Regis: three stacks of tapering glass frustums, flaring in and out.
    lat: 41.8872,
    lon: -87.6178,
    r: 60,
    build: (s) => {
      const g = new THREE.Group();
      const heights = [245, 363, 165];
      for (let i = 0; i < 3; i++) {
        const h = heights[i] ?? 200;
        const n = Math.round(h / 38);
        const seg = h / n;
        for (let k = 0; k < n; k++) {
          const wide = k % 2 === 0;
          const a = wide ? 1 : 0.86;
          const b = wide ? 0.86 : 1;
          put(g, block(30 * a, seg, 36 * a, [30 * b, 36 * b]), s.regis, (i - 1) * 29, k * seg, 0);
        }
      }
      return g;
    },
  },
  {
    // Two Prudential Plaza: granite shaft, a stepped pyramid top and a spire.
    lat: 41.8852,
    lon: -87.6235,
    r: 40,
    build: (s) => {
      const g = new THREE.Group();
      const y = stack(g, s.pru, [
        [48, 48, 233],
        [40, 40, 14],
        [31, 31, 13],
        [22, 22, 11],
      ]);
      const cap = put(g, tube(0, 15, 18, 4), s.pru, 0, y, 0, Math.PI / 4);
      cap.material = s.roof;
      put(g, tube(0.3, 1, 22, 6), s.mast, 0, y + 18, 0);
      return g;
    },
  },
  // Aqua: rippling white balconies.
  { lat: 41.8863, lon: -87.6198, r: 35, build: tower("aqua", [[42, 30, 262]]) },
  {
    // Marina City: the twin corncobs on the north bank of the river.
    lat: 41.8882,
    lon: -87.6283,
    r: 60,
    build: (s) => {
      const g = new THREE.Group();
      for (const x of [-30, 30]) put(g, tube(16, 16, 179, 24), s.marina, x, 0, 0);
      return g;
    },
  },
  {
    // Lake Point Tower: three curved lobes of bronze glass, alone by the lake.
    lat: 41.8917,
    lon: -87.6141,
    r: 40,
    build: (s) => {
      const shape = new THREE.Shape();
      for (let i = 0; i <= 72; i++) {
        const a = (i / 72) * Math.PI * 2;
        const r = 22 + 9 * Math.cos(3 * a);
        if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      const g = new THREE.Group();
      put(g, prism(shape, 197), s.bronze, 0, 0, 0, Math.PI / 6);
      return g;
    },
  },
  // Water Tower Place: a white marble slab on Michigan Avenue.
  { lat: 41.8977, lon: -87.6245, r: 40, build: tower("marble", [[44, 32, 262]]) },
  {
    // 900 North Michigan: limestone with four corner pavilions and a lantern.
    lat: 41.8995,
    lon: -87.6248,
    r: 40,
    build: (s) => {
      const g = new THREE.Group();
      const y = stack(g, s.tan, [[46, 46, 228]]);
      for (const [x, z] of [
        [-17, -17],
        [17, -17],
        [-17, 17],
        [17, 17],
      ] as const) {
        put(g, block(10, 24, 10), s.tan, x, y, z);
        put(g, tube(0, 6, 9, 4), s.roof, x, y + 24, z, Math.PI / 4);
      }
      put(g, block(14, 37, 14), s.lantern, 0, y, 0);
      return g;
    },
  },
  {
    // Park Tower: slender glass with a pyramid cap.
    lat: 41.8966,
    lon: -87.6232,
    r: 30,
    build: (s) => {
      const g = new THREE.Group();
      const y = stack(g, s.silver, [[34, 34, 232]]);
      put(g, tube(0, 21, 25, 4), s.roof, 0, y, 0, Math.PI / 4);
      return g;
    },
  },
  {
    // 311 South Wacker: pink granite under a glowing glass crown.
    lat: 41.8774,
    lon: -87.636,
    r: 40,
    build: (s) => {
      const g = new THREE.Group();
      const y = stack(g, s.pink, [
        [46, 46, 222],
        [38, 38, 30],
      ]);
      put(g, tube(14, 15, 41, 16), s.lantern, 0, y, 0);
      return g;
    },
  },
  {
    // Franklin Center: dark red granite stepping up to four corner spires.
    lat: 41.8807,
    lon: -87.6345,
    r: 42,
    build: (s) => {
      const g = new THREE.Group();
      const y = stack(g, s.brown, [
        [52, 52, 200],
        [44, 44, 50],
        [34, 34, 37],
      ]);
      for (const [x, z] of [
        [-13, -13],
        [13, -13],
        [-13, 13],
        [13, 13],
      ] as const)
        put(g, tube(0.4, 2.2, 22, 6), s.brown, x, y, z);
      return g;
    },
  },
  // Chase Tower: blue granite that narrows as it rises.
  {
    lat: 41.8818,
    lon: -87.6301,
    r: 40,
    build: (s) => {
      const g = new THREE.Group();
      put(g, block(62, 259, 40, [36, 40]), s.granite, 0, 0, 0);
      return g;
    },
  },
  {
    // 110 North Wacker: glass with a sloped crown.
    lat: 41.8835,
    lon: -87.6372,
    r: 36,
    build: (s) => {
      const g = new THREE.Group();
      const y = stack(g, s.blue, [[44, 44, 222]]);
      put(g, block(44, 28, 44, [8, 44]), s.blue, 0, y, 0);
      return g;
    },
  },
  {
    // 333 Wacker: green glass curving with the bend in the river.
    lat: 41.8858,
    lon: -87.6366,
    r: 70,
    build: (s) => {
      const shape = new THREE.Shape();
      const a0 = THREE.MathUtils.degToRad(102);
      const a1 = THREE.MathUtils.degToRad(168);
      shape.absarc(0, 0, 150, a0, a1, false);
      shape.absarc(0, 0, 118, a1, a0, true);
      shape.closePath();
      const g = new THREE.Group();
      // The arc's middle sits on the geo point.
      put(g, prism(shape, 149), s.green, 95, 0, 95);
      return g;
    },
  },
  // Legacy at Millennium Park, BCBS Tower and the South Loop's tall pair.
  { lat: 41.8826, lon: -87.6253, r: 26, build: tower("silver", [[30, 34, 249]]) },
  { lat: 41.8849, lon: -87.619, r: 35, build: tower("dark", [[45, 30, 227]]) },
  {
    lat: 41.8676,
    lon: -87.6243,
    r: 30,
    build: tower("blue", [
      [36, 30, 140],
      [33, 27, 134],
    ]),
  },
  { lat: 41.8669, lon: -87.6215, r: 30, build: tower("tan", [[34, 40, 221]]) },
  {
    // The Wrigley Building: white terracotta with its clock tower.
    lat: 41.8892,
    lon: -87.6249,
    r: 40,
    build: (s) => {
      const g = new THREE.Group();
      put(g, block(56, 72, 30), s.terracotta, 0, 0, 0);
      put(g, block(20, 34, 20), s.terracotta, -12, 72, 0);
      put(g, tube(5, 7, 14, 8), s.terracotta, -12, 106, 0);
      put(g, tube(0, 4, 8, 8), s.roof, -12, 120, 0);
      return g;
    },
  },
  {
    // Tribune Tower: a Gothic crown of flying buttresses.
    lat: 41.8904,
    lon: -87.6235,
    r: 30,
    build: (s) => {
      const g = new THREE.Group();
      put(g, block(32, 104, 30), s.limestone, 0, 0, 0);
      put(g, tube(9, 11, 26, 8), s.limestone, 0, 104, 0);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        put(g, block(2.4, 30, 2.4, [1, 1]), s.limestone, Math.cos(a) * 13, 100, Math.sin(a) * 13);
      }
      return g;
    },
  },
];

// Where the taller buildings cluster. The first zone that holds a block decides its buildings.
type Zone = {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  min: number;
  max: number;
  /** Chance a building is a tower, and how tall towers get. */
  tall: number;
  tallMax: number;
  /** Buildings per block. */
  fill: number;
};

const ZONES: Zone[] = [
  // The Loop, between the river and Congress.
  {
    x0: -1880,
    x1: -760,
    z0: -2600,
    z1: -1240,
    min: 35,
    max: 125,
    tall: 0.16,
    tallMax: 210,
    fill: 3,
  },
  // Michigan Avenue's wall of buildings facing Grant Park.
  { x0: -840, x1: -735, z0: -2320, z1: -470, min: 40, max: 100, tall: 0.14, tallMax: 150, fill: 2 },
  // Lakeshore East and the New East Side.
  {
    x0: -735,
    x1: -100,
    z0: -2700,
    z1: -2320,
    min: 40,
    max: 145,
    tall: 0.25,
    tallMax: 200,
    fill: 2,
  },
  // Streeterville.
  { x0: -735, x1: -60, z0: -3700, z1: -2780, min: 35, max: 135, tall: 0.2, tallMax: 195, fill: 2 },
  // River North.
  { x0: -1880, x1: -735, z0: -3700, z1: -2780, min: 18, max: 85, tall: 0.1, tallMax: 160, fill: 3 },
  // The Gold Coast and the Magnificent Mile.
  { x0: -1000, x1: -60, z0: -4800, z1: -3700, min: 18, max: 95, tall: 0.14, tallMax: 170, fill: 2 },
  // South Loop.
  { x0: -1880, x1: -735, z0: -1240, z1: -250, min: 14, max: 65, tall: 0.1, tallMax: 160, fill: 2 },
  // West Loop.
  {
    x0: -2480,
    x1: -1950,
    z0: -3300,
    z1: -700,
    min: 12,
    max: 55,
    tall: 0.08,
    tallMax: 120,
    fill: 2,
  },
];

/** Low-rise everywhere else on the near city ground. */
const LOW: Zone = { x0: 0, x1: 0, z0: 0, z1: 0, min: 8, max: 26, tall: 0.03, tallMax: 55, fill: 1 };

type Rect = { x0: number; x1: number; z0: number; z1: number };

// Parks and Museum Campus, kept clear of city blocks.
const GRANT_PARK: Rect = { x0: -712, x1: -40, z0: -2320, z1: -700 };
const CAMPUS: Rect = { x0: -440, x1: -40, z0: -700, z1: 400 };
const LAKEFRONT: readonly Rect[] = [
  { x0: 0, x1: SHORE_X - 14, z0: -3060, z1: -700 },
  { x0: 0, x1: SHORE_X - 14, z0: -3860, z1: -3400 },
];

/** Parks and lawns inside the city rectangle: no streets or traffic run across them. */
export const OPEN_GROUND: readonly Rect[] = [GRANT_PARK, CAMPUS, ...LAKEFRONT];

export type Skyline = {
  update: (dt: number) => void;
  /** Every building as boxes, to land on and to hit. */
  solids: Solids;
};

export function createSkyline(
  scene: THREE.Scene,
  opts: {
    aniso: number;
    coarse: boolean;
    onTop: (m: THREE.Material, k: number) => THREE.Material;
    /** How bright lit windows burn, and how far the evening has gone toward streetlights (0 by day). */
    windows: number;
    streets: number;
  },
): Skyline {
  const { aniso, coarse, onTop, windows, streets } = opts;
  // Landmarks only light up once the sun is low; ordinary blocks always show a few lit rooms.
  const skins = makeSkins(aniso, windows > 0.5 ? windows * 0.8 : 0);
  const root = new THREE.Group();
  root.name = "skyline";
  scene.add(root);

  const occupied: { x: number; z: number; r: number }[] = [];
  for (const lm of LANDMARKS) {
    const at = geo(lm.lat, lm.lon);
    const obj = lm.build(skins);
    obj.position.set(at.x, 0, at.z);
    root.add(obj);
    occupied.push({ x: at.x, z: at.z, r: lm.r });
  }

  // The Chicago River: the main stem from the lake to Wolf Point, then the two branches.
  const riverPts = (pts: readonly (readonly [number, number])[]) =>
    pts.map(([lat, lon]) => {
      const p = geo(lat, lon);
      return new THREE.Vector2(p.x, p.z);
    });
  const mainStem = riverPts([
    [41.8886, -87.6129],
    [41.8886, -87.6165],
    [41.8884, -87.621],
    [41.8881, -87.6245],
    [41.8876, -87.6285],
    [41.8871, -87.6335],
    [41.8868, -87.6378],
  ]);
  const southBranch = riverPts([
    [41.8868, -87.6378],
    [41.8845, -87.6382],
    [41.88, -87.6385],
    [41.8755, -87.6384],
    [41.8705, -87.6372],
    [41.865, -87.6352],
    [41.856, -87.6362],
    [41.848, -87.642],
  ]);
  const northBranch = riverPts([
    [41.8868, -87.6378],
    [41.8895, -87.6392],
    [41.8935, -87.6425],
    [41.8975, -87.646],
    [41.903, -87.65],
    [41.91, -87.656],
  ]);
  const rivers = [
    { pts: mainStem, w: 70 },
    { pts: southBranch, w: 58 },
    { pts: northBranch, w: 52 },
  ];
  const riverMat = onTop(
    new THREE.MeshStandardMaterial({ color: "#2c463f", roughness: 0.45, metalness: 0 }),
    2.5,
  );
  for (const { pts, w } of rivers) root.add(ribbon(pts, w, 0.06, riverMat));

  const nearRiver = (x: number, z: number, pad: number) => {
    const p = new THREE.Vector2(x, z);
    for (const { pts, w } of rivers) {
      for (let i = 1; i < pts.length; i++) {
        if (distToSegment(p, pts[i - 1]!, pts[i]!) < w / 2 + pad) return true;
      }
    }
    return false;
  };

  // Grant Park and Museum Campus lawns, with paths, trees and Buckingham Fountain.
  const lawn = onTop(new THREE.MeshStandardMaterial({ color: "#4b7748", roughness: 1 }), 1.5);
  const path = onTop(new THREE.MeshStandardMaterial({ color: "#a9a693", roughness: 1 }), 2);
  for (const r of [GRANT_PARK, CAMPUS])
    root.add(flat(r.x1 - r.x0, r.z1 - r.z0, (r.x0 + r.x1) / 2, 0.08, (r.z0 + r.z1) / 2, lawn));
  const fountain = geo(41.8758, -87.6189);
  root.add(
    flat(
      8,
      GRANT_PARK.z1 - GRANT_PARK.z0,
      fountain.x,
      0.1,
      (GRANT_PARK.z0 + GRANT_PARK.z1) / 2,
      path,
    ),
  );
  root.add(
    flat(
      GRANT_PARK.x1 - GRANT_PARK.x0,
      8,
      (GRANT_PARK.x0 + GRANT_PARK.x1) / 2,
      0.1,
      fountain.z,
      path,
    ),
  );
  root.add(
    flat(
      24,
      GRANT_PARK.z1 - GRANT_PARK.z0,
      -420,
      0.1,
      (GRANT_PARK.z0 + GRANT_PARK.z1) / 2,
      onTop(roadMat(), 2),
    ),
  );
  buckingham(root, fountain.x, fountain.z, onTop, streets);
  // North of Museum Campus the lakefront is lawn behind a seawall, not beach.
  const seawall = onTop(new THREE.MeshStandardMaterial({ color: "#b3b0a6", roughness: 0.9 }), 2.6);
  for (const r of LAKEFRONT) {
    root.add(flat(r.x1 - r.x0, r.z1 - r.z0, (r.x0 + r.x1) / 2, 0.085, (r.z0 + r.z1) / 2, lawn));
    root.add(flat(14, r.z1 - r.z0, SHORE_X - 7, 0.1, (r.z0 + r.z1) / 2, seawall));
  }
  const bean = new THREE.Mesh(
    new THREE.SphereGeometry(1, 24, 12),
    new THREE.MeshStandardMaterial({ color: "#f2f4f6", metalness: 1, roughness: 0.06 }),
  );
  const beanAt = geo(41.8827, -87.6233);
  bean.scale.set(10, 5, 6.5);
  bean.position.set(beanAt.x, 4, beanAt.z);
  root.add(bean);

  const treeRnd = rng(23);
  const trees: THREE.Vector3[] = [];
  const treeTarget = coarse ? 260 : 520;
  for (let i = 0; i < treeTarget * 3 && trees.length < treeTarget; i++) {
    const pick = treeRnd();
    const inGrant = pick < 0.6;
    const r = inGrant ? GRANT_PARK : pick < 0.8 ? CAMPUS : LAKEFRONT[0]!;
    // Rows along the park's walks, with some loose groves.
    const row = treeRnd() < 0.6;
    let x = r.x0 + 8 + treeRnd() * (r.x1 - r.x0 - 16);
    let z = r.z0 + 8 + treeRnd() * (r.z1 - r.z0 - 16);
    if (row) {
      if (treeRnd() < 0.5) x = Math.round(x / 60) * 60 + 10;
      else z = Math.round(z / 80) * 80 + 10;
    }
    if (Math.hypot(x - fountain.x, z - fountain.z) < 70 || nearRiver(x, z, 6)) continue;
    if (inGrant && Math.abs(x + 420) < 20) continue;
    if (r === CAMPUS && (museumHit(x, z) || x > -60)) continue;
    if (r !== CAMPUS && !inGrant && (x < 38 || x > SHORE_X - 24)) continue;
    trees.push(new THREE.Vector3(x, 0, z));
  }
  const crowns = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(5.5, 0),
    new THREE.MeshStandardMaterial({ color: "#2f6a3b", roughness: 0.95, flatShading: true }),
    trees.length,
  );
  const dummy = new THREE.Object3D();
  trees.forEach((t, i) => {
    const s = 0.8 + treeRnd() * 0.6;
    dummy.position.set(t.x, 5 * s + 2, t.z);
    dummy.scale.set(s, s * 0.85, s);
    dummy.rotation.set(0, treeRnd() * 6, 0);
    dummy.updateMatrix();
    crowns.setMatrixAt(i, dummy.matrix);
  });
  crowns.frustumCulled = false;
  root.add(crowns);

  museumCampus(root, onTop);
  const wheel = navyPier(root, streets);
  if (streets > 0) driveLamps(root);
  harbor(root, coarse);

  // City blocks: one instanced mesh of boxes on the ground texture's street grid.
  const solids = new Solids();
  const city = cityBlocks(occupied, nearRiver, coarse ? 1500 : 2600, aniso, windows, solids);
  root.add(city);

  // Everything else that stands up off the ground, measured before it is merged away.
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const skip = (o: THREE.Object3D | null): boolean =>
    !!o && (o.userData.live === true || o.userData.hollow === true || skip(o.parent));
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || (mesh as THREE.InstancedMesh).isInstancedMesh || skip(mesh)) return;
    solids.addMesh(mesh, box);
  });

  bake(root);

  return {
    update(dt) {
      wheel(dt);
    },
    solids,
  };
}

/**
 * Merges every static mesh under root into one mesh per material, so the whole skyline costs a
 * few dozen draw calls instead of hundreds. Instanced meshes and anything marked live stay as is.
 */
function bake(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const doomed: THREE.Mesh[] = [];
  const live = (o: THREE.Object3D | null): boolean =>
    !!o && (o.userData.live === true || live(o.parent));
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || (mesh as THREE.InstancedMesh).isInstancedMesh || live(mesh)) return;
    if (!mesh.geometry.getAttribute("uv")) return;
    const geo = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    geo.applyMatrix4(mesh.matrixWorld);
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const count = geo.getAttribute("position").count;
    // A single material draws every group (a box has six), so only arrays split by group.
    const groups =
      Array.isArray(mesh.material) && geo.groups.length
        ? geo.groups
        : [{ start: 0, count, materialIndex: 0 }];
    for (const g of groups) {
      const mat = mats[g.materialIndex ?? 0];
      if (!mat) continue;
      const part = new THREE.BufferGeometry();
      for (const name of ["position", "normal", "uv"]) {
        const attr = geo.getAttribute(name) as THREE.BufferAttribute;
        const n = attr.itemSize;
        const end = Math.min(count, g.start + g.count);
        part.setAttribute(
          name,
          new THREE.BufferAttribute(attr.array.slice(g.start * n, end * n), n),
        );
      }
      const list = buckets.get(mat) ?? [];
      list.push(part);
      buckets.set(mat, list);
    }
    geo.dispose();
    doomed.push(mesh);
  });
  for (const mesh of doomed) {
    mesh.removeFromParent();
    mesh.geometry.dispose();
  }
  for (const [mat, parts] of buckets) {
    const merged = mergeGeometries(parts);
    for (const p of parts) p.dispose();
    if (!merged) continue;
    root.add(new THREE.Mesh(merged, mat));
  }
}

function distToSegment(p: THREE.Vector2, a: THREE.Vector2, b: THREE.Vector2) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const t = THREE.MathUtils.clamp(
    ((p.x - a.x) * abx + (p.y - a.y) * aby) / (abx * abx + aby * aby || 1),
    0,
    1,
  );
  return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t));
}

/** A flat strip along a polyline (x, z), lying just above the ground. */
function ribbon(pts: readonly THREE.Vector2[], width: number, y: number, mat: THREE.Material) {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[Math.max(0, i - 1)]!;
    const next = pts[Math.min(pts.length - 1, i + 1)]!;
    const dx = next.x - prev.x;
    const dz = next.y - prev.y;
    const len = Math.hypot(dx, dz) || 1;
    const nx = (-dz / len) * (width / 2);
    const nz = (dx / len) * (width / 2);
    const p = pts[i]!;
    pos.push(p.x + nx, y, p.y + nz, p.x - nx, y, p.y - nz);
    if (i > 0) {
      const k = (i - 1) * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // Winding varies with direction, so make sure every normal points up.
  const n = geo.getAttribute("normal") as THREE.BufferAttribute;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  const mesh = new THREE.Mesh(geo, mat);
  (mesh.material as THREE.Material).side = THREE.DoubleSide;
  mesh.frustumCulled = false;
  return mesh;
}

function flat(w: number, d: number, x: number, y: number, z: number, mat: THREE.Material) {
  // Cut into pieces about 100 m across, so big lawns keep their depth precision up close.
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d, Math.ceil(w / 100), Math.ceil(d / 100)),
    mat,
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x, y, z);
  return mesh;
}

function roadMat() {
  return new THREE.MeshStandardMaterial({ color: "#3a4047", roughness: 0.9 });
}

function buckingham(
  root: THREE.Object3D,
  x: number,
  z: number,
  onTop: (m: THREE.Material, k: number) => THREE.Material,
  night: number,
) {
  const pool = new THREE.Mesh(
    new THREE.CircleGeometry(42, 40),
    onTop(new THREE.MeshStandardMaterial({ color: "#5d8fa6", roughness: 0.15, metalness: 0.3 }), 3),
  );
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(x, 0.12, z);
  root.add(pool);
  const pink = new THREE.MeshStandardMaterial({ color: "#d8b4a6", roughness: 0.7 });
  put(root, tube(15, 17, 2.4, 24), pink, x, 0, z);
  put(root, tube(9, 10, 2.2, 20), pink, x, 2.4, z);
  put(root, tube(4.5, 5, 2.2, 16), pink, x, 4.6, z);
  // Lit from below after dark, as it is every summer evening.
  const spray = new THREE.MeshStandardMaterial({
    color: "#ffffff",
    emissive: "#9fd2ff",
    emissiveIntensity: night * 1.2,
    transparent: true,
    opacity: 0.55,
    roughness: 0.3,
    depthWrite: false,
  });
  put(root, tube(0.4, 3.2, 34, 12), spray, x, 6.8, z);
}

/** Field Museum, Shedd Aquarium, Adler Planetarium and Soldier Field around the beach. */
const MUSEUMS = {
  field: { x: -250, z: -320, w: 200, d: 100 },
  shedd: { x: -120, z: -600, r: 75 },
  adler: { x: 96, z: -330, r: 30 },
  soldier: { x: -270, z: 215, rx: 90, rz: 130 },
};

function museumHit(x: number, z: number) {
  const f = MUSEUMS.field;
  if (Math.abs(x - f.x) < f.w / 2 + 12 && Math.abs(z - f.z) < f.d / 2 + 12) return true;
  if (Math.hypot(x - MUSEUMS.shedd.x, z - MUSEUMS.shedd.z) < MUSEUMS.shedd.r + 10) return true;
  const s = MUSEUMS.soldier;
  return ((x - s.x) / (s.rx + 15)) ** 2 + ((z - s.z) / (s.rz + 15)) ** 2 < 1;
}

function museumCampus(
  root: THREE.Object3D,
  onTop: (m: THREE.Material, k: number) => THREE.Material,
) {
  const marble = new THREE.MeshStandardMaterial({ color: "#e6e0d2", roughness: 0.7 });
  const roof = new THREE.MeshStandardMaterial({ color: "#8d918f", roughness: 0.85 });
  const patina = new THREE.MeshStandardMaterial({
    color: "#6f9a8a",
    roughness: 0.6,
    metalness: 0.2,
  });
  const skin: Skin = { wall: marble, roof };

  const f = MUSEUMS.field;
  put(root, block(f.w, 24, f.d), skin, f.x, 0, f.z);
  put(root, block(84, 12, 52), skin, f.x, 24, f.z);
  for (let i = 0; i < 8; i++)
    put(root, tube(1.4, 1.4, 20, 8), marble, f.x - 21 + i * 6, 0, f.z - f.d / 2 - 4);

  const sh = MUSEUMS.shedd;
  put(root, tube(30, 32, 22, 8), skin, sh.x, 0, sh.z, Math.PI / 8);
  put(root, tube(0, 31, 13, 8), patina, sh.x, 22, sh.z, Math.PI / 8);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    put(root, block(54, 17, 26), skin, sh.x + Math.cos(a) * 52, 0, sh.z + Math.sin(a) * 52, -a);
  }

  const ad = MUSEUMS.adler;
  const granite = new THREE.MeshStandardMaterial({ color: "#a58f78", roughness: 0.75 });
  put(root, tube(24, 26, 12, 12), granite, ad.x, 0, ad.z);
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(13, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2),
    patina,
  );
  dome.position.set(ad.x, 12, ad.z);
  root.add(dome);
  root.add(
    flat(
      80,
      90,
      ad.x - 6,
      0.11,
      ad.z,
      onTop(new THREE.MeshStandardMaterial({ color: "#a9a59a", roughness: 1 }), 2),
    ),
  );

  // Soldier Field: the modern bowl inside the old colonnades.
  const s = MUSEUMS.soldier;
  const bowl = new THREE.Shape();
  bowl.absellipse(0, 0, s.rx * 0.78, s.rz * 0.8, 0, Math.PI * 2, false, 0);
  const hole = new THREE.Path();
  hole.absellipse(0, 0, 40, 72, 0, Math.PI * 2, true, 0);
  bowl.holes.push(hole);
  const stands = new THREE.MeshStandardMaterial({
    color: "#9aa2a8",
    roughness: 0.6,
    metalness: 0.3,
  });
  // Open in the middle, so it is not one solid box.
  put(root, prism(bowl, 34), stands, s.x, 0, s.z).userData.hollow = true;
  root.add(
    flat(
      52,
      112,
      s.x,
      0.3,
      s.z,
      onTop(new THREE.MeshStandardMaterial({ map: turfTexture(), roughness: 1 }), 3),
    ),
  );
  for (const side of [-1, 1]) {
    for (let i = 0; i < 14; i++)
      put(root, tube(1.3, 1.5, 19, 8), marble, s.x + side * s.rx, 0, s.z - 65 + i * 10);
    put(root, block(6, 4, 140), marble, s.x + side * s.rx, 19, s.z);
  }
}

function turfTexture() {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 128;
  const g = c.getContext("2d");
  if (g) {
    for (let i = 0; i < 12; i++) {
      g.fillStyle = i % 2 ? "#3f8a3e" : "#4a9846";
      g.fillRect(0, (i * 128) / 12, 64, 128 / 12);
    }
    g.strokeStyle = "#f4f4f0";
    g.lineWidth = 2;
    g.strokeRect(3, 3, 58, 122);
    g.beginPath();
    g.moveTo(3, 64);
    g.lineTo(61, 64);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Navy Pier, reaching a kilometer into the lake, with the Centennial Wheel. Returns its animator. */
function navyPier(root: THREE.Object3D, night: number) {
  const base = geo(41.8917, -87.6111);
  const pier = new THREE.Group();
  pier.position.set(base.x, 0, base.z);
  root.add(pier);
  const deck = new THREE.MeshStandardMaterial({ color: "#b8b2a6", roughness: 0.9 });
  const brick = new THREE.MeshStandardMaterial({ color: "#c2aa8c", roughness: 0.8 });
  const roof = new THREE.MeshStandardMaterial({ color: "#6f4a3c", roughness: 0.75 });
  const white = new THREE.MeshStandardMaterial({ color: "#eef1f3", roughness: 0.5 });
  const LEN = 1010;
  put(pier, block(LEN, 3.2, 95), deck, LEN / 2, 0, 0);
  // The long sheds down both sides, under red-brown roofs.
  for (const z of [-28, 28]) {
    put(pier, block(640, 11, 22), brick, 640, 3.2, z);
    put(pier, block(644, 1.6, 25), roof, 640, 14.2, z);
  }
  put(pier, block(70, 24, 84), { wall: brick, roof }, 45, 3.2, 0);
  for (const z of [-30, 30]) put(pier, block(11, 40, 11), brick, 45, 3.2, z);
  put(
    pier,
    block(70, 16, 50),
    new THREE.MeshStandardMaterial({ color: "#9fb8c4", roughness: 0.15, metalness: 0.6 }),
    210,
    3.2,
    0,
  );
  // The Grand Ballroom's dome at the far end.
  put(pier, tube(31, 32, 18, 28), brick, 975, 3.2, 0);
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(33, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2),
    white,
  );
  dome.scale.y = 0.5;
  dome.position.set(975, 21.2, 0);
  pier.add(dome);

  // The Centennial Wheel, broadside to the beach.
  const at = geo(41.8917, -87.6077);
  const hub = new THREE.Vector3(at.x - base.x, 34, 0);
  const R = 27;
  const frame = new THREE.Group();
  frame.userData.live = true;
  frame.position.copy(hub);
  pier.add(frame);
  // After dark the rim and spokes glow with their LEDs.
  const rim = new THREE.MeshStandardMaterial({
    color: "#f2f4f6",
    roughness: 0.4,
    metalness: 0.3,
    emissive: "#cfe2ff",
    emissiveIntensity: night * 1.6,
  });
  frame.add(new THREE.Mesh(new THREE.TorusGeometry(R, 0.6, 6, 48), rim));
  frame.add(new THREE.Mesh(new THREE.TorusGeometry(R - 3, 0.35, 6, 48), rim));
  const spokes: [THREE.Vector3, THREE.Vector3][] = [];
  for (let i = 0; i < 21; i++) {
    const a = (i / 21) * Math.PI * 2;
    spokes.push([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(Math.cos(a) * R, Math.sin(a) * R, 0),
    ]);
  }
  frame.add(new THREE.Mesh(bars(spokes, 0.18), rim));
  const legs: [THREE.Vector3, THREE.Vector3][] = [];
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      legs.push([hub.clone(), new THREE.Vector3(hub.x + sx * 14, 3.2, sz * 9)]);
  const legMesh = new THREE.Mesh(bars(legs, 0.9), rim);
  legMesh.userData.hollow = true;
  pier.add(legMesh);
  const N = 42;
  const cars = new THREE.InstancedMesh(
    new THREE.BoxGeometry(2.6, 2.8, 2.6),
    new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.3, metalness: 0.2 }),
    N,
  );
  const color = new THREE.Color();
  for (let i = 0; i < N; i++) cars.setColorAt(i, color.set(i % 7 === 0 ? "#c4322a" : "#3b7fbf"));
  cars.frustumCulled = false;
  pier.add(cars);
  const dummy = new THREE.Object3D();
  let turn = 0;
  const place = () => {
    for (let i = 0; i < N; i++) {
      const a = turn + (i / N) * Math.PI * 2;
      // Cars hang level below the rim.
      dummy.position.set(hub.x + Math.cos(a) * R, hub.y + Math.sin(a) * R - 1.6, 0);
      dummy.updateMatrix();
      cars.setMatrixAt(i, dummy.matrix);
    }
    cars.instanceMatrix.needsUpdate = true;
  };
  place();
  return (dt: number) => {
    // About one turn every four minutes.
    turn += dt * 0.026;
    frame.rotation.z = turn;
    place();
  };
}

/** Monroe Harbor's moored sailboats behind their breakwater, and the harbor lighthouse. */
function harbor(root: THREE.Object3D, coarse: boolean) {
  const stone = new THREE.MeshStandardMaterial({ color: "#8a8c88", roughness: 0.95 });
  const outer = 150 + 640;
  put(root, block(9, 2.4, 560), stone, outer, 0, -1470);
  put(root, block(9, 2.4, 560), stone, outer, 0, -2120);
  const light = geo(41.8894, -87.591);
  put(root, block(8, 2.4, 1300), stone, light.x, 0, light.z - 650);
  const white = new THREE.MeshStandardMaterial({ color: "#f3f4f2", roughness: 0.6 });
  const red = new THREE.MeshStandardMaterial({ color: "#b8332a", roughness: 0.6 });
  put(root, block(12, 8, 12), white, light.x, 2.4, light.z);
  put(root, tube(3.4, 4, 16, 12), white, light.x, 10.4, light.z);
  put(root, tube(0, 3.8, 5, 12), red, light.x, 26.4, light.z);

  const rnd = rng(31);
  const slots: [number, number][] = [];
  for (let x = 230; x < outer - 40; x += 26)
    for (let z = -2330; z < -1290; z += 13) if (rnd() < 0.62) slots.push([x, z]);
  const n = Math.min(slots.length, coarse ? 150 : 320);
  const hulls = new THREE.InstancedMesh(
    new THREE.BoxGeometry(9, 1.3, 3),
    new THREE.MeshStandardMaterial({ color: "#f4f6f8", roughness: 0.45 }),
    n,
  );
  const masts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.1, 0.14, 13, 4), white, n);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < n; i++) {
    const [x, z] = slots[i]!;
    // Moored boats swing bow into the wind off the lake.
    const yaw = (rnd() - 0.5) * 0.5;
    dummy.position.set(x, 0.55, z);
    dummy.rotation.set(0, yaw, 0);
    dummy.updateMatrix();
    hulls.setMatrixAt(i, dummy.matrix);
    dummy.position.set(x + 1, 7.2, z);
    dummy.updateMatrix();
    masts.setMatrixAt(i, dummy.matrix);
  }
  hulls.frustumCulled = false;
  masts.frustumCulled = false;
  root.add(hulls, masts);
}

/** The window texture for the instanced city: a 2x2 grid of windows, some lit. */
function windowMaps(aniso: number) {
  const paint = document.createElement("canvas");
  paint.width = 64;
  paint.height = 64;
  const lights = document.createElement("canvas");
  lights.width = 64;
  lights.height = 64;
  const g = paint.getContext("2d");
  const lg = lights.getContext("2d");
  if (!g || !lg) return null;
  const rnd = rng(3);
  g.fillStyle = "#c5ced6";
  g.fillRect(0, 0, 64, 64);
  lg.fillStyle = "#000";
  lg.fillRect(0, 0, 64, 64);
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 2; col++) {
      const x0 = col * 32;
      const y0 = row * 32;
      g.fillStyle = "#8d98a2";
      g.fillRect(x0, y0, 32, 3);
      g.fillRect(x0, y0, 3, 32);
      const lit = rnd() > 0.78;
      g.fillStyle = lit ? "#d7e7f4" : "#1c2934";
      g.fillRect(x0 + 6, y0 + 5, 20, 22);
      g.fillStyle = "rgba(255,255,255,0.2)";
      g.fillRect(x0 + 6, y0 + 5, 7, 22);
      if (lit) {
        lg.fillStyle = "#ffc48a";
        lg.fillRect(x0 + 6, y0 + 5, 20, 22);
      }
    }
  }
  const map = new THREE.CanvasTexture(paint);
  const glow = new THREE.CanvasTexture(lights);
  for (const tex of [map, glow]) {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = aniso;
  }
  return { map, lights: glow };
}

function inRect(r: Rect, x: number, z: number, pad: number) {
  return x > r.x0 - pad && x < r.x1 + pad && z > r.z0 - pad && z < r.z1 + pad;
}

/** Sodium lamps along both sides of Lake Shore Drive, lit after sundown. */
function driveLamps(root: THREE.Object3D) {
  const zs: number[] = [];
  for (let z = -5200; z <= 3000; z += 42) zs.push(z);
  const lamps = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.8, 6, 4),
    new THREE.MeshBasicMaterial({ color: "#ffc27a", toneMapped: false }),
    zs.length * 2,
  );
  const m = new THREE.Matrix4();
  let i = 0;
  for (const z of zs) {
    for (const x of [-31, -5])
      lamps.setMatrixAt(i++, m.makeTranslation(x, 9, z + (x > -20 ? 21 : 0)));
  }
  lamps.frustumCulled = false;
  root.add(lamps);
}

/** Ordinary buildings, block by block, on the ground texture's street grid. */
function cityBlocks(
  occupied: readonly { x: number; z: number; r: number }[],
  nearRiver: (x: number, z: number, pad: number) => boolean,
  cap: number,
  aniso: number,
  glow: number,
  solids: Solids,
) {
  const maps = windowMaps(aniso);
  const mat = new THREE.MeshStandardMaterial({
    color: "#d5dde4",
    map: maps?.map,
    emissive: new THREE.Color("#ffb56a"),
    emissiveMap: maps?.lights,
    emissiveIntensity: glow,
    roughness: 0.62,
    metalness: 0.16,
  });
  // Windows scale with each box, and roofs get plain tar and gravel instead of windows.
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying float vRoof;")
      .replace(
        "#include <uv_vertex>",
        `#include <uv_vertex>
         vRoof = step(0.5, normal.y);
         #ifdef USE_INSTANCING
           vec2 facadeUv = vec2(max(instanceMatrix[0][0], instanceMatrix[2][2]), instanceMatrix[1][1]) * vec2(0.085, 0.1);
           #ifdef USE_MAP
             vMapUv *= facadeUv;
           #endif
           #ifdef USE_EMISSIVEMAP
             vEmissiveMapUv *= facadeUv;
           #endif
         #endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vRoof;")
      .replace(
        "#include <map_fragment>",
        "#include <map_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.5), vRoof);",
      )
      .replace(
        "#include <emissivemap_fragment>",
        "#include <emissivemap_fragment>\ntotalEmissiveRadiance *= 1.0 - vRoof;",
      );
  };

  const rnd = rng(7);
  const B = CITY.block;
  const lot = B * 0.86;
  const cols = Math.floor((CITY.x1 - CITY.x0) / B);
  const rows = Math.floor((CITY.z1 - CITY.z0) / B);
  type Box = { x: number; z: number; w: number; d: number; h: number; hue: number };
  const boxes: Box[] = [];
  const blocked = (x: number, z: number, r: number) => {
    if (x > -45 - r) return true;
    if (inRect(GRANT_PARK, x, z, r + 6) || inRect(CAMPUS, x, z, r + 6) || museumHit(x, z))
      return true;
    if (nearRiver(x, z, r + 8)) return true;
    for (const o of occupied) if (Math.hypot(x - o.x, z - o.z) < o.r + r + 6) return true;
    return false;
  };
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const cx = CITY.x0 + (i + 0.5) * B;
      const cz = CITY.z1 - (j + 0.5) * B;
      const zone = ZONES.find((zn) => cx > zn.x0 && cx < zn.x1 && cz > zn.z0 && cz < zn.z1) ?? LOW;
      const n =
        zone === LOW
          ? rnd() < 0.55
            ? 1
            : 0
          : Math.max(1, Math.round(zone.fill * (0.6 + rnd() * 0.6)));
      const placed: Box[] = [];
      for (let k = 0; k < n * 4 && placed.length < n; k++) {
        const tall = rnd() < zone.tall;
        const w = tall ? 26 + rnd() * 20 : zone === LOW ? 14 + rnd() * 26 : 18 + rnd() * (lot / n);
        const d = tall ? 26 + rnd() * 20 : zone === LOW ? 14 + rnd() * 26 : 18 + rnd() * (lot / n);
        const x = cx + (rnd() - 0.5) * (lot - w);
        const z = cz + (rnd() - 0.5) * (lot - d);
        if (
          placed.some(
            (p) => Math.abs(p.x - x) < (p.w + w) / 2 + 3 && Math.abs(p.z - z) < (p.d + d) / 2 + 3,
          )
        )
          continue;
        if (blocked(x, z, Math.max(w, d) / 2)) continue;
        const h = tall
          ? zone.max + rnd() * (zone.tallMax - zone.max)
          : zone.min + rnd() ** 1.6 * (zone.max - zone.min);
        placed.push({ x, z, w, d, h, hue: rnd() });
      }
      boxes.push(...placed);
    }
  }
  // Keep the tallest when the cap is hit, since they shape the skyline.
  if (boxes.length > cap) {
    boxes.sort((a, b) => b.h - a.h);
    boxes.length = cap;
  }
  const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, boxes.length);
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  boxes.forEach((b, i) => {
    solids.add({
      x0: b.x - b.w / 2,
      x1: b.x + b.w / 2,
      z0: b.z - b.d / 2,
      z1: b.z + b.d / 2,
      y0: 0,
      y1: b.h,
    });
    dummy.position.set(b.x, b.h / 2, b.z);
    dummy.scale.set(b.w, b.h, b.d);
    dummy.updateMatrix();
    inst.setMatrixAt(i, dummy.matrix);
    // Gray glass and concrete, pale stone, brick on the low ones and some dark glass.
    const k = (b.hue * 7.31) % 1;
    if (b.hue < 0.3) color.setHSL(0.09, 0.16, 0.5 + k * 0.2);
    else if (b.hue < 0.45 && b.h < 70) color.setHSL(0.03, 0.34, 0.32 + k * 0.12);
    else if (b.hue < 0.58) color.setHSL(0.58, 0.12, 0.16 + k * 0.1);
    else color.setHSL(0.57, 0.08, 0.3 + k * 0.22);
    inst.setColorAt(i, color);
  });
  inst.frustumCulled = false;
  inst.instanceMatrix.needsUpdate = true;
  if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  return inst;
}
