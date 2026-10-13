import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { createAudio } from "./audio";
import {
  BASE_HARD_FT,
  BASE_NOW_FT,
  BASE_PULL_FT,
  DECISION_FT,
  DZ_X,
  DZ_Z,
  FT_PER_M,
  GREEN_HALF,
  GREEN_IN,
  HARD_DECK_FT,
  HOP_MAX_FT,
  HOP_MIN_FT,
  MPH_PER_MPS,
  PLANE_MPS,
  PULL_NOW_FT,
  GATE_FLOOR_FT,
  RINGS_HOP_MIN_FT,
  RING_FLOOR_FT,
  RUN_X,
  SHORE_X,
  WIND_X,
  WIND_Z,
} from "./constants";
import { loadSave, writeSave } from "./save";
import type { Bridge, Hud, JumpMode, Outcome, Phase, Ride, Suit } from "./types";
import { EYE_UP, PLAYER_LOOK, createBody, type BodyMode, type BodyPose, type Gesture } from "./body";
import { CANOPY_EYE_Y, COLLAPSE_S, createCanopy, settleCanopy, togglePosition } from "./canopy";
import { dressCabin } from "./cabin";
import { BASE_FALL, BREAKOFF_FT, LOOKS, createFormation } from "./formation";
import { createCloudField } from "./clouds";
import { createGlow } from "./glow";
import { scoreJump } from "./score";
import { createShadows, type ShadowCaster } from "./shadow";
import { createStreaks } from "./streaks";
import { CITY, createSkyline } from "./skyline";
import { createLife } from "./life";
import { BODY_R, areaAt, canBaseFrom, createPads, lookAhead, nearestOpen, stepTo } from "./roofs";
import {
  BASKET,
  HELI_EXIT,
  HELI_SEAT,
  HELI_SEAT_YAW,
  RIM_Y,
  createBalloon,
  createHeli,
  type BalloonTheme,
} from "./rides";
import { createDirector, type Director } from "./replay";
import { createCourse, planFlat, planGates, type RingKind, type RingSpec } from "./rings";
import type { Contact, Solid } from "./solids";
import { FRAME_SIZE, GESTURES, MODES, PHASES, PLAYER, REC_HZ, RIDES, createTape } from "./tape";
import { createWing, flyWing, pathPitch, wingFill, type Wing } from "./wingsuit";
import { SUN_DIR, applyLight, cityTexture, createAtmosphere, createWaterMaterial, streetLights } from "./world";

type TapeRef = { current: HTMLCanvasElement | null };

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, "YXZ");
const _base = new THREE.Vector3();
const _prev = new THREE.Vector3();

/** Walking pace on a roof, and the run-up to an edge. */
const WALK_MPS = 2.4;
const RUN_MPS = 4.8;
/** Eye height standing up, matching the body's frame in the cabin. */
const STAND_EYE = 1.5;
/** Seconds for a BASE canopy to open: a big pilot chute and no bag to wait on. */
const BASE_OPEN_S = 1.25;
/** Wingsuit: passing this close to a building counts as a close pass. */
const PASS_M = 25;
/**
 * Wingsuit gates circle a point just off the beach, out over the water and back past Museum
 * Campus and the skyline, so wherever the course ends the beach is in reach under canopy.
 */
const GATE_HUB = { x: DZ_X + 250, z: DZ_Z - 250 };
/** Seconds aboard the helicopter before the pilot has the hover settled and clears you. */
const HELI_CLEAR_S = 4;

/** Where the pull calls come, for the jump in progress. */
const DECK = {
  skydive: { pull: DECISION_FT, now: PULL_NOW_FT, hard: HARD_DECK_FT },
  base: { pull: BASE_PULL_FT, now: BASE_NOW_FT, hard: BASE_HARD_FT },
} as const;

/** The title screen looks across Monroe Harbor at downtown. */
const MENU_CAM = new THREE.Vector3(1800, 70, -1200);
const MENU_CITY = new THREE.Vector3(-1078, 227, -2047);

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function smooth(u: number) {
  const t = clamp(u, 0, 1);
  return t * t * (3 - 2 * t);
}

/** Moves angle `from` a fraction `k` of the short way round toward `to`. */
function easeAngle(from: number, to: number, k: number) {
  return from + Math.atan2(Math.sin(to - from), Math.cos(to - from)) * k;
}

function yawOf(x: number, z: number) {
  return Math.atan2(-x, -z);
}

function axis(neg: boolean, pos: boolean, analog: number) {
  if (neg && !pos) return -1;
  if (pos && !neg) return 1;
  return clamp(analog, -1, 1);
}

function cabinOk(x: number, z: number) {
  const inAisle = x >= -0.95 && x <= 0.95 && z >= -2.65 && z <= 2.3;
  const inDoor = x >= 0.4 && x <= 1.4 && z >= 0.16 && z <= 1.78;
  if (!inAisle && !inDoor) return false;
  if (x > -1.06 && x < -0.46 && z > -2.55 && z < 2.28) return false;
  if (x > 0.46 && x < 1.08 && z > -2.55 && z < 0.02) return false;
  if (x > 0.46 && x < 1.08 && z > 1.88 && z < 2.35) return false;
  return true;
}

function tile(kind: "city" | "sand" | "road") {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const g = c.getContext("2d");
  if (!g) return null;
  if (kind === "city") {
    g.fillStyle = "#3a424a";
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = "#5c6771";
    g.fillRect(16, 16, 96, 96);
    g.fillStyle = "#6e7882";
    g.fillRect(24, 22, 36, 28);
    g.fillRect(66, 26, 34, 22);
    g.fillRect(22, 60, 32, 38);
    g.fillRect(62, 64, 40, 32);
    g.fillStyle = "#8b949e";
    g.fillRect(30, 28, 10, 6);
    g.fillRect(70, 72, 12, 6);
  } else if (kind === "sand") {
    g.fillStyle = "#e4d2a8";
    g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 80; i++) {
      g.fillStyle = i % 2 ? "rgba(160,130,80,0.35)" : "rgba(255,248,230,0.3)";
      g.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
    }
  } else {
    g.fillStyle = "#2a3036";
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = "#d7c07a";
    g.fillRect(60, 0, 6, 128);
    g.fillStyle = "#e7eef4";
    g.fillRect(6, 0, 3, 128);
    g.fillRect(119, 0, 3, 128);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function labelMat(text: string, fg: string, bg: string) {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const g = c.getContext("2d");
  if (!g) return new THREE.MeshBasicMaterial({ color: bg });
  g.fillStyle = bg;
  g.fillRect(0, 0, 512, 128);
  g.strokeStyle = fg;
  g.lineWidth = 6;
  g.strokeRect(8, 8, 496, 112);
  g.fillStyle = fg;
  g.font = "700 54px sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, 256, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshBasicMaterial({ map: tex });
}

/** Edges from a to b: every `step` meters within `fine` of the drop zone, then each span half again longer. */
function spans(a: number, b: number, step: number, fine: number) {
  const out = [a];
  let x = a;
  while (x < b) {
    x = Math.min(b, x + Math.max(step, (Math.abs(x) - fine) * 0.5));
    out.push(x);
  }
  return out;
}

/**
 * Flat ground over [x0, x1] by [z0, z1] at height y, with a PlaneGeometry's 0 to 1 UVs. It is cut
 * into short pieces near the drop zone: a single quad kilometers long loses depth precision where
 * the near plane clips it, and low over the beach the layers stacked on it start to fight.
 */
function groundGeo(x0: number, x1: number, z0: number, z1: number, y = 0) {
  const xs = spans(x0, x1, 200, 6000);
  const zs = spans(z0, z1, 200, 6000);
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (const z of zs) {
    for (const x of xs) {
      pos.push(x, y, z);
      uv.push((x - x0) / (x1 - x0), (z1 - z) / (z1 - z0));
    }
  }
  const nx = xs.length;
  for (let j = 0; j < zs.length - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      idx.push(a, a + nx, a + 1, a + 1, a + nx, a + nx + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  return geo;
}

function strut(
  parent: THREE.Object3D,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  mat: THREE.Material,
  r = 0.045,
) {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const len = Math.hypot(dx, dy, dz) || 1;
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 6), mat);
  mesh.position.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx / len, dy / len, dz / len));
  parent.add(mesh);
  return mesh;
}

function box(
  parent: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  mat: THREE.Material,
) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

function drawTape(canvas: HTMLCanvasElement, altFt: number, deck: { pull: number; hard: number }) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  const s = w / 84;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "rgba(14,20,27,0.78)";
  ctx.fillRect(0, 0, w, h);
  const center = h / 2;
  const px = h / 1600;
  const yFor = (alt: number) => center - (alt - altFt) * px;
  const yHard = yFor(deck.hard);
  const yDec = yFor(deck.pull);
  ctx.fillStyle = "rgba(226,61,61,0.38)";
  ctx.fillRect(0, Math.max(0, yHard), w, h - Math.max(0, yHard));
  ctx.fillStyle = "rgba(240,162,2,0.28)";
  const top = clamp(yDec, 0, h);
  const bot = clamp(Math.max(yHard, yDec), 0, h);
  if (bot > top) ctx.fillRect(0, top, w, bot - top);
  const start = Math.max(0, Math.floor((altFt - 900) / 100) * 100);
  ctx.textBaseline = "middle";
  ctx.font = `${12 * s}px sans-serif`;
  for (let a = start; a <= altFt + 900; a += 100) {
    const y = yFor(a);
    if (y < -10 || y > h + 10) continue;
    const major = a % 500 === 0;
    ctx.fillStyle = major ? "#e7eef4" : "#8fa0b3";
    ctx.fillRect(w - (major ? 18 : 10) * s, y, (major ? 18 : 10) * s, Math.max(1, s));
    if (major) {
      ctx.textAlign = "right";
      ctx.fillText(String(a), w - 22 * s, y);
    }
  }
  const mark = (alt: number, text: string, color: string) => {
    const y = yFor(alt);
    if (y < -24 || y > h + 24) return;
    ctx.fillStyle = color;
    ctx.fillRect(0, y - s, w, 2 * s);
    ctx.textAlign = "left";
    ctx.font = `700 ${11 * s}px sans-serif`;
    ctx.fillText(text, 4 * s, y - 9 * s);
  };
  mark(deck.pull, "PULL", "#f0a202");
  mark(deck.hard, "HARD", "#e23d3d");
  ctx.fillStyle = "#f0a202";
  ctx.beginPath();
  ctx.moveTo(w - 2, center);
  ctx.lineTo(w - 14 * s, center - 6 * s);
  ctx.lineTo(w - 14 * s, center + 6 * s);
  ctx.fill();
}

export function mountGame(
  canvas: HTMLCanvasElement,
  tape: TapeRef,
  bridge: Bridge,
  onFrame: (hud: Hud) => void,
) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, window.innerWidth < 800 ? 1.25 : 1.6));
  renderer.setSize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  // The time of day sets the sun, sky and haze that everything below is built with.
  const look = applyLight(bridge.light);
  renderer.toneMappingExposure = look.exposure;
  const post = createGlow(renderer, look.glow, window.matchMedia("(pointer: coarse)").matches ? 4 : 5);

  const scene = new THREE.Scene();
  const atmo = createAtmosphere(renderer);
  scene.background = atmo.fog.clone();
  scene.environment = atmo.envMap;
  scene.environmentIntensity = look.env;
  const fog = new THREE.Fog(atmo.fog.clone(), 400, 14000);
  scene.fog = fog;
  const camera = new THREE.PerspectiveCamera(72, 1, 0.12, 45000);
  camera.rotation.order = "YXZ";

  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const audio = createAudio();
  const save = loadSave();

  scene.add(new THREE.HemisphereLight(look.hemiSky, look.hemiGround, look.hemiIntensity));
  const sun = new THREE.DirectionalLight(look.sunColor, look.sunIntensity);
  sun.position.copy(SUN_DIR).multiplyScalar(1000);
  scene.add(sun);

  const sky = atmo.sky;
  scene.add(sky);

  const aniso = renderer.capabilities.getMaxAnisotropy();
  const cityMap = cityTexture(5, coarse ? 1024 : 2048, 8, aniso);
  const farMap = cityTexture(9, 1024, 8, aniso);
  const sandMap = tile("sand");
  const roadMap = tile("road");
  const cityW = CITY.x1 - CITY.x0;
  const cityD = CITY.z1 - CITY.z0;
  if (cityMap) cityMap.repeat.set(cityW / 820, cityD / 820);
  if (farMap) farMap.repeat.set(1, 1);

  const cityMat = new THREE.MeshStandardMaterial({ map: cityMap ?? undefined, color: "#d9dcdf", roughness: 0.95 });
  // After sundown the street grid lights up under the city.
  const streetGlow = look.streets > 0 ? streetLights(8, aniso) : null;
  const farGlow = streetGlow?.clone() ?? null;
  if (streetGlow) {
    streetGlow.repeat.copy(cityMap?.repeat ?? new THREE.Vector2(cityW / 820, cityD / 820));
    cityMat.emissive.set("#ffffff");
    cityMat.emissiveMap = streetGlow;
    cityMat.emissiveIntensity = look.streets;
  }
  const sandMat = new THREE.MeshStandardMaterial({ map: sandMap ?? undefined, color: "#e6d3aa", roughness: 1 });
  const grassMat = new THREE.MeshStandardMaterial({ color: "#3f7a4a", roughness: 1 });
  const roadMat = new THREE.MeshStandardMaterial({ map: roadMap ?? undefined, color: "#2c333a", roughness: 0.9 });
  const normalTex = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}textures/waternormals.jpg`);
  normalTex.anisotropy = aniso;
  const waterFx = createWaterMaterial(normalTex, atmo.haze, atmo.zenith, SHORE_X);
  const waterUniforms = waterFx.uniforms;
  // Decals on the ground draw over it without z-fighting, even kilometers away.
  const onTop = (m: THREE.Material, k: number) => {
    m.polygonOffset = true;
    m.polygonOffsetFactor = -k;
    m.polygonOffsetUnits = -k * 4;
    return m;
  };
  const WORLD = 120000;
  const water = new THREE.Mesh(groundGeo(SHORE_X - 40, SHORE_X - 40 + WORLD, -WORLD, WORLD), waterFx.material);
  water.frustumCulled = false;
  scene.add(water);

  // Beyond the near city: open country west, and the shore north and south of it.
  const farGeo = mergeGeometries([
    groundGeo(-WORLD, CITY.x0, -WORLD, WORLD),
    groundGeo(CITY.x0, SHORE_X - 40, -WORLD, CITY.z0),
    groundGeo(CITY.x0, SHORE_X - 40, CITY.z1, WORLD),
  ]);
  const farUv = farGeo.getAttribute("uv");
  const farPos = farGeo.getAttribute("position");
  for (let i = 0; i < farUv.count; i++) farUv.setXY(i, farPos.getX(i) / 1400, -farPos.getZ(i) / 1400);
  const farLand = new THREE.Mesh(
    farGeo,
    new THREE.MeshStandardMaterial({
      map: farMap ?? undefined,
      color: "#c9cdc8",
      roughness: 1,
      emissive: farGlow ? "#ffffff" : "#000000",
      emissiveMap: farGlow,
      emissiveIntensity: look.streets * 0.8,
    }),
  );
  farLand.frustumCulled = false;
  scene.add(farLand);

  const land = new THREE.Mesh(groundGeo(CITY.x0, CITY.x1, CITY.z0, CITY.z1), cityMat);
  land.frustumCulled = false;
  scene.add(land);
  if (sandMap) sandMap.repeat.set(18, 40 * (WORLD / 3100));
  const sand = new THREE.Mesh(groundGeo(0, SHORE_X, -WORLD, WORLD, 0.05), onTop(sandMat, 1));
  sand.frustumCulled = false;
  scene.add(sand);
  if (roadMap) roadMap.repeat.set(1, 80 * (WORLD / 3100));
  const road = new THREE.Mesh(groundGeo(-29, -7, -WORLD, WORLD, 0.07), onTop(roadMat, 3));
  road.frustumCulled = false;
  scene.add(road);

  const skyline = createSkyline(scene, { aniso, coarse, onTop, windows: look.windows, streets: look.streets });
  const life = createLife(scene, { coarse, night: look.streets > 0, onTop });
  const solids = skyline.solids;
  const pads = createPads(scene, solids, { onTop, night: look.streets > 0 });

  const verge = new THREE.Mesh(groundGeo(-10, 30, -WORLD, WORLD, 0.09), onTop(grassMat.clone(), 2));
  verge.frustumCulled = false;
  scene.add(verge);
  const wet = new THREE.Mesh(
    groundGeo(SHORE_X - 19, SHORE_X - 1, -WORLD, WORLD, 0.07),
    onTop(new THREE.MeshStandardMaterial({ color: "#b7a888", roughness: 0.95 }), 2),
  );
  wet.frustumCulled = false;
  scene.add(wet);

  const dummy = new THREE.Object3D();
  const treeRnd = mulberry(11);
  const barkMat = new THREE.MeshStandardMaterial({ color: "#6a5340", roughness: 1 });
  const leafMat = new THREE.MeshStandardMaterial({ color: "#2d6a3e", roughness: 0.92 });
  const treeN = 72;
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.38, 2.4, 5), barkMat, treeN);
  const crowns = new THREE.InstancedMesh(new THREE.ConeGeometry(1.7, 4.6, 6), leafMat, treeN);
  trunks.frustumCulled = false;
  crowns.frustumCulled = false;
  let trees = 0;
  for (let i = 0; i < 160 && trees < treeN; i++) {
    const x = -8 + treeRnd() * 36;
    const z = -1400 + treeRnd() * 2800;
    if (Math.abs(z) < 55 && x > 20) continue;
    dummy.position.set(x, 1.2, z);
    dummy.scale.set(1, 0.8 + treeRnd() * 0.7, 1);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    trunks.setMatrixAt(trees, dummy.matrix);
    dummy.position.y = 3.4;
    dummy.updateMatrix();
    crowns.setMatrixAt(trees, dummy.matrix);
    trees++;
  }
  trunks.count = trees;
  crowns.count = trees;
  trunks.instanceMatrix.needsUpdate = true;
  crowns.instanceMatrix.needsUpdate = true;
  scene.add(trunks, crowns);

  const dark = new THREE.MeshStandardMaterial({ color: "#1b2128", roughness: 0.55, metalness: 0.25 });
  const steel = new THREE.MeshStandardMaterial({ color: "#c5ced6", roughness: 0.35, metalness: 0.55 });
  const white = new THREE.MeshStandardMaterial({ color: "#f4f7fa", roughness: 0.45 });
  const redM = new THREE.MeshStandardMaterial({ color: "#c4322a", roughness: 0.5 });
  const amberM = new THREE.MeshStandardMaterial({ color: "#e0a020", roughness: 0.5 });

  const ringMat = (hex: string) =>
    onTop(new THREE.MeshBasicMaterial({ color: hex, side: THREE.DoubleSide }), 4);
  const addRing = (inner: number, outer: number, hex: string) => {
    const m = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 48), ringMat(hex));
    m.rotation.x = -Math.PI / 2;
    m.position.set(DZ_X, 0.12, DZ_Z);
    scene.add(m);
  };
  addRing(31, 33, "#f4f7fa");
  addRing(15, 16.4, "#f0a202");
  addRing(4.2, 5.2, "#e23d3d");
  const bull = new THREE.Mesh(new THREE.CircleGeometry(1.6, 20), ringMat("#f0a202"));
  bull.rotation.x = -Math.PI / 2;
  bull.position.set(DZ_X, 0.13, DZ_Z);
  scene.add(bull);
  box(scene, 26, 0.12, 2.4, DZ_X + 18, 0.16, DZ_Z, amberM);
  const head = new THREE.Mesh(new THREE.ConeGeometry(2.4, 7, 4), amberM);
  head.rotation.z = -Math.PI / 2;
  head.position.set(DZ_X + 34, 0.4, DZ_Z);
  scene.add(head);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 8, 6), steel);
  pole.position.set(DZ_X + 22, 4, DZ_Z + 16);
  scene.add(pole);
  const sock = new THREE.Mesh(new THREE.ConeGeometry(0.45, 2.4, 8), amberM);
  sock.position.set(DZ_X + 20.2, 7.4, DZ_Z + 16);
  sock.rotation.z = Math.PI / 2;
  scene.add(sock);
  const tent = new THREE.Mesh(new THREE.BoxGeometry(8, 3.2, 5), white);
  tent.position.set(DZ_X - 16, 1.6, DZ_Z + 14);
  scene.add(tent);
  for (let i = 0; i < 3; i++) {
    box(scene, 5.2, 1.8, 2.1, DZ_X - 8 + i * 7, 0.9, DZ_Z - 18, i === 1 ? redM : dark);
  }

  const plane = new THREE.Group();
  scene.add(plane);
  const paint = new THREE.MeshStandardMaterial({ color: "#f3f6f8", roughness: 0.42, metalness: 0.22 });
  const stripe = new THREE.MeshStandardMaterial({ color: "#c4322a", roughness: 0.48 });
  const inner = new THREE.MeshStandardMaterial({ color: "#6a737c", roughness: 0.86 });
  const floorM = new THREE.MeshStandardMaterial({ color: "#3c444c", roughness: 0.95 });
  const seatM = new THREE.MeshStandardMaterial({ color: "#1c2430", roughness: 0.75 });
  const glass = new THREE.MeshStandardMaterial({
    color: "#8eb6cc",
    transparent: true,
    opacity: 0.45,
    roughness: 0.06,
    metalness: 0.35,
    side: THREE.DoubleSide,
  });
  const glow = new THREE.MeshStandardMaterial({
    color: "#e23d3d",
    emissive: "#e23d3d",
    emissiveIntensity: 1.4,
  });

  box(plane, 2.5, 0.1, 5.7, 0, -0.02, -0.2, floorM);
  box(plane, 2.5, 0.08, 5.7, 0, 1.82, -0.2, inner);
  box(plane, 0.08, 1.7, 1.6, -1.16, 0.88, -2.15, inner);
  box(plane, 0.08, 1.7, 1.15, -1.16, 0.88, 1.85, inner);
  box(plane, 0.08, 0.55, 2.2, -1.16, 0.28, -0.15, inner);
  box(plane, 0.08, 0.42, 2.2, -1.16, 1.58, -0.15, inner);
  const pane = new THREE.Mesh(new THREE.PlaneGeometry(2.05, 0.7), glass);
  pane.position.set(-1.12, 0.95, -0.15);
  pane.rotation.y = Math.PI / 2;
  plane.add(pane);
  box(plane, 0.08, 1.74, 2.9, 1.16, 0.88, -1.55, inner);
  box(plane, 0.08, 1.74, 0.7, 1.16, 0.88, 2.15, inner);
  box(plane, 0.1, 0.7, 2.3, 0, 0.36, -2.92, inner);
  box(plane, 0.55, 0.85, 0.08, -0.55, 1.15, -2.88, inner);
  box(plane, 0.55, 0.85, 0.08, 0.55, 1.15, -2.88, inner);
  box(plane, 0.08, 1.7, 0.4, 0, 0.9, 2.5, inner);
  box(plane, 0.55, 0.42, 1.9, -0.72, 0.46, -0.3, seatM);
  box(plane, 0.55, 0.42, 2.2, 0.72, 0.46, -1.35, seatM);
  box(plane, 0.5, 0.42, 0.5, 0.72, 0.46, 2.1, seatM);
  const belly = paint.clone();
  belly.color.set("#c5d0d8");
  box(plane, 2.15, 0.5, 6.4, 0, -0.28, -0.25, belly);
  box(plane, 2.35, 0.32, 6.6, 0, 2.02, -0.35, paint);
  box(plane, 0.07, 1.72, 1.7, -1.22, 0.9, -2.2, paint);
  box(plane, 0.07, 1.72, 1.15, -1.22, 0.9, 1.85, paint);
  box(plane, 0.07, 0.62, 2.3, -1.22, 0.34, -0.15, paint);
  box(plane, 0.07, 0.38, 2.3, -1.22, 1.52, -0.15, paint);
  box(plane, 0.07, 1.74, 2.9, 1.22, 0.88, -1.55, paint);
  box(plane, 0.07, 1.74, 0.7, 1.22, 0.88, 2.16, paint);
  for (let i = 0; i < 5; i++) {
    box(plane, 0.04, 0.68, 0.045, -1.24, 0.95, -0.95 + i * 0.42, steel);
  }
  box(plane, 0.04, 0.07, 2.15, -1.36, 0.48, -0.15, stripe);
  box(plane, 0.04, 0.07, 2.15, 1.34, 0.48, -1.2, stripe);
  box(plane, 0.04, 0.07, 1.05, 1.34, 0.48, 1.7, stripe);
  const noseGeo = new THREE.SphereGeometry(1.12, 18, 14);
  const nose = new THREE.Mesh(noseGeo, paint);
  nose.scale.set(1.02, 0.92, 1.18);
  nose.position.set(0, 0.78, -4.45);
  plane.add(nose);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.85), glass);
  screen.position.set(0, 1.18, -3.08);
  screen.rotation.x = -0.35;
  plane.add(screen);
  const wingL = box(plane, 7.4, 0.14, 1.9, -4.15, 2.24, -1.4, paint);
  wingL.rotation.z = -0.07;
  const wingR = box(plane, 7.4, 0.14, 1.9, 4.15, 2.24, -1.4, paint);
  wingR.rotation.z = 0.07;
  const nacGeo = new THREE.CylinderGeometry(0.36, 0.42, 1.55, 12);
  nacGeo.rotateX(Math.PI / 2);
  const nacL = new THREE.Mesh(nacGeo, paint);
  nacL.position.set(-3.55, 2.02, -1.85);
  const nacR = nacL.clone();
  nacR.position.x = 3.55;
  plane.add(nacL, nacR);
  const propL = new THREE.Group();
  propL.position.set(-3.55, 2.02, -2.72);
  propL.add(blade());
  propL.add(propDisc());
  plane.add(propL);
  const propR = new THREE.Group();
  propR.position.set(3.55, 2.02, -2.72);
  propR.add(blade());
  propR.add(propDisc());
  plane.add(propR);
  strut(plane, -1.35, 0.35, -1.15, -3.5, 2.05, -1.45, steel, 0.05);
  strut(plane, 1.35, 0.35, -1.15, 3.5, 2.05, -1.45, steel, 0.05);
  strut(plane, -1.15, 0.45, 0.15, -2.4, 2.12, -1.15, steel, 0.035);
  strut(plane, 1.15, 0.45, 0.15, 2.4, 2.12, -1.15, steel, 0.035);
  const fin = box(plane, 0.12, 2.15, 1.35, 0, 2.55, 3.15, paint);
  fin.rotation.x = 0.18;
  box(plane, 3.6, 0.1, 0.85, 0, 2.15, 3.05, paint);
  box(plane, 1.15, 0.42, 0.7, 0, 3.35, 3.35, stripe);
  addWheel(plane, -0.95, -0.72, -0.35);
  addWheel(plane, 0.95, -0.72, -0.35);
  addWheel(plane, 0, -0.78, -3.55);
  box(plane, 0.08, 1.5, 0.08, 1.2, 0.78, 0.18, steel);
  box(plane, 0.08, 1.5, 0.08, 1.2, 0.78, 1.72, steel);
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.45, 8), steel);
  bar.rotation.x = Math.PI / 2;
  bar.position.set(1.22, 1.05, 0.95);
  plane.add(bar);
  box(plane, 0.7, 0.08, 1.45, 1.25, 0.04, 0.95, floorM);
  const jumpLight = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 10), glow);
  jumpLight.position.set(0.95, 1.62, 0.22);
  plane.add(jumpLight);
  const placard = new THREE.Mesh(new THREE.PlaneGeometry(0.78, 0.2), labelMat("PULL BY 4,500", "#f0a202", "#141c24"));
  placard.position.set(0.98, 1.48, 0.22);
  placard.rotation.y = -Math.PI / 2;
  plane.add(placard);
  const placard2 = new THREE.Mesh(new THREE.PlaneGeometry(0.78, 0.18), labelMat("HARD DECK 2,000", "#e23d3d", "#141c24"));
  placard2.position.set(0.98, 1.24, 0.22);
  placard2.rotation.y = -Math.PI / 2;
  plane.add(placard2);
  const cabinLamp = new THREE.PointLight("#ffd2a8", 6, 7, 2);
  cabinLamp.position.set(0, 1.55, -0.2);
  plane.add(cabinLamp);
  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(0.08, 8, 8),
    new THREE.MeshStandardMaterial({ color: "#ff3b3b", emissive: "#ff2020", emissiveIntensity: 1 }),
  );
  beacon.position.set(0, 3.15, 3.3);
  plane.add(beacon);
  const cabin = dressCabin(plane, { inner, floor: floorM, seat: seatM, bar }, LOOKS);

  // The helicopter and the balloon only fly when you ride them up.
  const heli = createHeli();
  heli.group.visible = false;
  scene.add(heli.group);
  const balloon = createBalloon("chicago", { pilot: true });
  balloon.group.visible = false;
  scene.add(balloon.group);
  // Other balloons drifting in on the same breeze, for company.
  const FLEET: [BalloonTheme, number, number, number][] = [
    ["sunrise", -240, 35, -330],
    ["ocean", 210, -60, -520],
    ["rainbow", -120, 140, 260],
  ];
  const fleet = FLEET.map(([theme, dx, dy, dz], i) => {
    const b = createBalloon(theme, { pilot: false });
    b.group.visible = false;
    scene.add(b.group);
    return { b, off: new THREE.Vector3(dx, dy, dz), phase: 2.3 + i * 2.9, burn: 0 };
  });
  // The ring challenge's hoops, laid fresh for each jump that flies one.
  const course = createCourse();
  scene.add(course.group);

  const canopyRig = createCanopy();
  const canopy = canopyRig.group;
  const body = createBody();
  scene.add(body.group);
  // You as the replay shows you, from outside.
  const actor = createBody({ thirdPerson: true, look: PLAYER_LOOK });
  actor.group.visible = false;
  scene.add(actor.group);
  const formation = createFormation(scene);
  // Phones get fewer, bigger puffs: the same clouds for less overdraw.
  const cloudField = createCloudField(scene, coarse ? 0.6 : 1);
  const streaks = createStreaks(scene);
  const shadows = createShadows(scene);
  const casters: ShadowCaster[] = [];
  let cloudDensity = 0;
  let cloudLogged = false;
  canopy.visible = false;
  scene.add(canopy);
  const streamer = new THREE.Group();
  const ribM = new THREE.MeshStandardMaterial({ color: "#c4322a", roughness: 0.6 });
  const ribs: THREE.Mesh[] = [];
  for (let i = 0; i < 8; i++) {
    const r = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.9, 0.12), ribM);
    streamer.add(r);
    ribs.push(r);
  }
  streamer.visible = false;
  scene.add(streamer);

  const path = [
    new THREE.Vector3(RUN_X, 0, -1700),
    new THREE.Vector3(RUN_X, 0, 1100),
    new THREE.Vector3(RUN_X + 480, 0, 1450),
    new THREE.Vector3(RUN_X + 480, 0, -2000),
    new THREE.Vector3(RUN_X, 0, -1700),
  ];

  let phase: Phase = "menu";
  let seg = 0;
  let segDist = 0;
  let planeYaw = Math.PI;
  let planeBank = 0;
  const planeVel = new THREE.Vector3();
  let riderX = -0.05;
  let riderZ = 1.05;
  let localYaw = -Math.PI / 2;
  let localPitch = -0.08;
  const pos = new THREE.Vector3(RUN_X, 3000, 0);
  const vel = new THREE.Vector3();
  let bodyYaw = Math.PI / 2;
  let bodyPitch = 0;
  let bank = 0;
  let heading = 0;
  let lookOffYaw = 0;
  let lookOffPitch = 0;
  let mal: "none" | "streamer" | "twist" = "none";
  let malChance = 0.15;
  let lockedAlt = 12500 / FT_PER_M;
  let openT = 0;
  let shock = 0;
  let gesture: Gesture | null = null;
  let docked = false;
  /** Keys held while docking don't count until released, so diving in doesn't drop the grip. */
  let gripSettled = false;
  /** After letting go, no assist or re-dock for a moment so the player can actually leave. */
  let dockAgainAt = 0;
  let dockedOnce = false;
  /** For the scorecard: where you first docked, pulled, and how much air you had at the pull. */
  let dockedFt: number | null = null;
  let pullFt: number | null = null;
  let pullSep: number | null = null;
  let brokeOff = false;
  let exitTime = 0;
  let gestureStart = 0;
  let brakeL = 0;
  let brakeR = 0;
  let shockFired = false;
  let deployingReserve = false;
  let reserveArmed = false;
  let usedReserve = false;
  let flying: "none" | "main" | "reserve" = "none";
  let leftOnRed = false;
  /** The spotter's screen by the door: seconds to green, or GO. */
  let spotShort = "";
  let doorBriefed = false;
  let warnedDecision = false;
  let beepAcc = 0;
  let flashUntil = 0;
  let flashText = "";
  let simTime = 0;
  let walk = 0;
  let inDoor = false;
  let green = false;
  let wasGreen = false;
  let outcome: Outcome | null = null;
  let mode: JumpMode = "skydive";
  /** On a roof: running for the edge after a press of jump. */
  let runUp = false;
  /** The roof you stand on, and for the debrief the one you jumped from and how. */
  let roofName = "";
  let jumpedFrom: string | null = null;
  let ranOff = false;
  let delayS: number | null = null;
  /** The surface under you while you fly: a roof, or the ground. */
  let floorY = 0;
  /** The suit for this jump, and while a wingsuit flies (exit to pull) its flight state. */
  let suit: Suit = "rig";
  let wing: Wing | null = null;
  /** Wingsuit flight so far: ground covered, and over the full-suit part, distance and drop. */
  let flightM = 0;
  let glideM = 0;
  let glideDrop = 0;
  /** The suit is flying, not just falling: from here on its glide counts. */
  let suitFlying = false;
  let passes = 0;
  let closestM: number | null = null;
  let passMin = Infinity;
  let passReady = true;
  let passClear = 0;
  let proxAcc = 0;
  /** Where the eyes pointed at the exit, eased into the flight path as the suit fills. */
  let exitPitch = 0;
  /** This jump's ride up, and off a helicopter or a balloon the dead air after the exit. */
  let ride: Ride = "plane";
  let deadAir = false;
  /** Seconds since boarding the helicopter or balloon; when you left it; the pilot's go-ahead. */
  let rideT = 0;
  let leftAt = -1;
  let cleared = false;
  let hopAlt = 0;
  const heliHome = new THREE.Vector3();
  let heliOut = 0;
  const balloonStart = new THREE.Vector3();
  let balloonRise = 0;
  /** The ride's velocity, its heading, and the balloon's burner from 0 to full. */
  const rideVel = new THREE.Vector3();
  let rideYaw = 0;
  let burn = 0;
  /** Dead air: pitch and roll on top of where you look, their rates, and when you got stable. */
  let tumbleP = 0;
  let tumbleR = 0;
  let spinP = 0;
  let spinR = 0;
  let buffetAt = 0;
  let stableS: number | null = null;
  /** This jump flies a ring course; the course's seed, kept when you jump the same jump again. */
  let ringsOn = false;
  let courseSeed = (Math.random() * 2 ** 31) | 0;
  /** This jump on tape for the replay; while one plays, its director and the frame on screen. */
  const rec = createTape();
  let recAt = -1;
  let recUntil = Infinity;
  /** How open the canopy is drawn, for the tape. */
  let canopyU = 0;
  let director: Director | null = null;
  const shown = new Float32Array(FRAME_SIZE);
  let shownPhase: Phase = "menu";
  /** The formation as it stood when a replay started, to put back after. */
  const liveCrew = new Float32Array(FRAME_SIZE);
  /** Tape time of the touchdown, for the canopy folding down in the replay. */
  let landT = -1;
  const lzPos = new THREE.Vector3();
  const keys = new Set<string>();
  let qaKeys: Set<string> | null = null;
  let prevQa = new Set<string>();
  const eventEdges = new Set<string>();
  let steerOverride: number | null = null;
  let lookDX = 0;
  let lookDY = 0;
  let prevJump = false;
  let prevPull = false;
  let prevCut = false;
  let prevReserve = false;
  const log: string[] = [];
  const hud: Hud = {
    phase: "menu",
    mode: "skydive",
    suit: "rig",
    altitudeFt: 12500,
    fallMph: 0,
    groundMph: 0,
    compassDeg: 0,
    banner: "",
    bannerLevel: 0,
    pose: "BELLY",
    green: false,
    inDoor: false,
    prompt: "",
    spot: "",
    doorU: 0.5,
    doorV: 0.5,
    doorVisible: false,
    baseU: 0.5,
    baseV: 0.5,
    baseVisible: false,
    baseLabel: "",
    dzRel: 0,
    dzDist: 0,
    dzLabel: "DZ",
    dzVisible: false,
    outcome: null,
    canopy: "none",
    needsLook: false,
    replay: null,
    save: { bestM: save.bestM, bestScore: save.bestScore, jumps: save.jumps, rides: save.rides },
  };

  function persist() {
    hud.save = {
      bestM: save.bestM,
      bestScore: save.bestScore,
      jumps: save.jumps,
      rides: save.rides,
    };
    writeSave(save);
  }

  function resetRun() {
    // Board on the jump run, GREEN_IN seconds short of the green light.
    const start = path[0] ?? new THREE.Vector3();
    seg = 0;
    segDist = Math.max(0, DZ_Z - GREEN_HALF - GREEN_IN * PLANE_MPS - start.z);
    plane.position.set(start.x, start.y, start.z + segDist);
    planeYaw = Math.PI;
  }

  /** Clears everything one jump leaves behind. */
  function resetJump() {
    outcome = null;
    log.length = 0;
    mal = "none";
    deployingReserve = false;
    reserveArmed = false;
    usedReserve = false;
    flying = "none";
    leftOnRed = false;
    doorBriefed = false;
    warnedDecision = false;
    beepAcc = 0;
    flashText = "";
    cloudLogged = false;
    pullFt = null;
    pullSep = null;
    canopy.visible = false;
    streamer.visible = false;
    resetFormation();
    bank = 0;
    runUp = false;
    jumpedFrom = null;
    ranOff = false;
    delayS = null;
    wing = null;
    flightM = 0;
    glideM = 0;
    glideDrop = 0;
    passes = 0;
    closestM = null;
    passMin = Infinity;
    passReady = true;
    passClear = 0;
    lookOffYaw = 0;
    lookOffPitch = 0;
    deadAir = false;
    tumbleP = 0;
    tumbleR = 0;
    spinP = 0;
    spinR = 0;
    stableS = null;
    course.clear();
    rec.reset(simTime);
    recAt = -1;
    recUntil = Infinity;
    canopyU = 0;
    audio.resetDeath();
    audio.resume();
  }

  function begin() {
    resetJump();
    save.ride = bridge.ride;
    save.roof = bridge.roof;
    save.suit = bridge.suit;
    suit = bridge.suit;
    ride = bridge.ride;
    save.rings = bridge.rings;
    ringsOn = bridge.rings && ride !== "roof";
    if (ride === "heli" || ride === "balloon") {
      board();
      persist();
      return;
    }
    const pad = bridge.ride === "roof" ? (pads.list.find((p) => p.id === bridge.roof) ?? pads.list[0]) : null;
    if (pad) {
      // A few steps back from the edge you came to jump, looking over it.
      const fx = -Math.sin(pad.yaw);
      const fz = -Math.cos(pad.yaw);
      const ahead = lookAhead(solids, pad.x, pad.y, pad.z, fx, fz, 60);
      const back = ahead.kind === "edge" ? Math.max(0, ahead.dist - 4) : 0;
      standOnRoof(pad.x + fx * back, pad.z + fz * back, pad.yaw, pad.name);
      localPitch = -0.3;
      persist();
      return;
    }
    phase = "cabin";
    mode = "skydive";
    riderX = -0.05;
    riderZ = 1.05;
    localYaw = -Math.PI / 2;
    localPitch = -0.08;
    malChance = clamp(bridge.malChance, 0, 0.4);
    lockedAlt = clamp(bridge.altitudeFt, 8000, 20000) / FT_PER_M;
    save.altitudeFt = Math.round(lockedAlt * FT_PER_M);
    save.malPct = Math.round(malChance * 100);
    resetRun();
    plane.position.y = lockedAlt;
    persist();
  }

  /** Up in the helicopter or the balloon at the exit altitude, ready to go. */
  function board() {
    phase = "aboard";
    mode = "skydive";
    malChance = clamp(bridge.malChance, 0, 0.4);
    save.malPct = Math.round(malChance * 100);
    save.hopFt = Math.round(clamp(bridge.hopFt, HOP_MIN_FT, HOP_MAX_FT));
    // A ring course needs room below the dead air, so rings take you up a little higher.
    hopAlt = Math.max(save.hopFt, ringsOn ? RINGS_HOP_MIN_FT : 0) / FT_PER_M;
    rideT = 0;
    leftAt = -1;
    burn = 0;
    heliOut = 0;
    balloonRise = 0;
    cleared = ride === "balloon";
    walk = 0;
    if (ride === "heli") {
      // Hovering off the beach, nose into the breeze: the open door looks up the shore at downtown.
      heliHome.set(DZ_X + 330, hopAlt, DZ_Z - 120);
      // Looking down past your boots at the city, 7,000 feet below.
      localYaw = HELI_SEAT_YAW + 0.3;
      localPitch = -0.7;
    } else {
      // Drifting in over the lake on the breeze, toward the beach and the city.
      balloonStart.set(DZ_X + 520, hopAlt, DZ_Z - 160);
      riderX = -0.3;
      riderZ = 0.2;
      // Facing downtown between the frame poles, with another balloon out ahead.
      localYaw = 1.15;
      localPitch = -0.2;
    }
    moveRides(0);
    flashText = `${ride === "heli" ? "HELICOPTER" : "BALLOON"} · ${Math.round(hopAlt * FT_PER_M).toLocaleString("en-US")} FT`;
    flashUntil = simTime + 3.5;
  }

  /** Puts you on the roof at (x, z), facing `yaw`, to walk to an edge and jump. */
  function standOnRoof(x: number, z: number, yaw: number, name: string) {
    phase = "roof";
    mode = "base";
    const top = solids.top(x, z);
    pos.set(x, top ? top.y1 : 0, z);
    vel.set(0, 0, 0);
    localYaw = yaw;
    localPitch = -0.1;
    roofName = name;
    runUp = false;
    walk = 0;
    flashText = `${name.toUpperCase()} · ${Math.round(pos.y * FT_PER_M).toLocaleString("en-US")} FT`;
    flashUntil = simTime + 3.5;
  }

  /** From the debrief of a rooftop landing: back on your feet up there, for a BASE jump. */
  function baseFromHere() {
    if (!outcome?.canBase) return;
    const name = outcome.roof ?? "the roof";
    const { x, z } = pos;
    const yaw = heading;
    resetJump();
    ride = "roof";
    ringsOn = false;
    standOnRoof(x, z, yaw, name);
    persist();
  }

  function resetFormation() {
    formation.reset();
    docked = false;
    dockedOnce = false;
    dockedFt = null;
    brokeOff = false;
    dockAgainAt = 0;
  }

  function backToMenu() {
    phase = "menu";
    outcome = null;
    canopy.visible = false;
    streamer.visible = false;
    resetFormation();
    course.clear();
    flying = "none";
    if (document.pointerLockElement) void document.exitPointerLock();
  }

  function pushLog(line: string) {
    log.push(line);
    if (log.length > 10) log.shift();
  }

  /** What the debrief needs about a wingsuit flight; empty for the standard rig. */
  function flightFacts() {
    const winged = suit === "wing";
    return {
      suit,
      flightM: winged ? flightM : null,
      glide: winged && glideDrop > 30 ? glideM / glideDrop : null,
      passes: winged ? passes : 0,
      closestM: winged ? closestM : null,
      rings: ringsOn ? { got: course.got(), total: course.total() } : null,
    };
  }

  /** Scores the jump and keeps the best. Called once per jump, as it ends. */
  function score(facts: Omit<Outcome, "log" | "reason" | "score">) {
    const result = scoreJump({ ...facts, dockedFt, pullFt, sepM: pullSep, running: ranOff });
    if (facts.kind !== "impact" && result.total > (save.bestScore ?? 0)) {
      result.newBest = true;
      save.bestScore = result.total;
    }
    return result;
  }

  function finishImpact(reason: string) {
    if (phase === "impact" || phase === "down") return;
    phase = "impact";
    // The tape stops here: the replay cuts away as you go in.
    recUntil = simTime;
    pos.y = Math.max(pos.y, 0);
    vel.set(0, 0, 0);
    pushLog(reason);
    const facts = {
      kind: "impact" as const,
      mode,
      ride,
      stableS,
      ...flightFacts(),
      area: "none" as const,
      roof: null,
      padM: null,
      canBase: false,
      from: jumpedFrom,
      delayS,
      distanceM: Math.hypot(pos.x - DZ_X, pos.z - DZ_Z),
      usedReserve,
      redLight: leftOnRed,
      intoWind: false,
      hot: true,
      onBeach: false,
    };
    outcome = { ...facts, log: log.slice(), reason, score: score(facts) };
    audio.update(0, 0, 0);
    audio.death();
    persist();
  }

  /** Under canopy and down: on the ground, in the lake, or on the roof `roof`. */
  function finishDown(roof: Solid | null = null) {
    const dist = Math.hypot(pos.x - DZ_X, pos.z - DZ_Z);
    const gs = Math.hypot(vel.x, vel.z);
    const intoWind = -Math.sin(heading) > 0.62;
    const hot = gs > 16 || -vel.y > 7.2;
    const area = roof ? "roof" : areaAt(pos.x, pos.z);
    const water = area === "water";
    const onBeach = area === "beach";
    pos.y = roof ? roof.y1 : 0;
    vel.y = 0;
    const pad = roof ? pads.at(pos.x, pos.y, pos.z) : null;
    const roofLabel = pad ? pad.name : roof ? (pos.x > SHORE_X ? "Navy Pier" : "a rooftop") : null;
    const facts = {
      kind: water ? ("water" as const) : ("landed" as const),
      mode,
      ride,
      stableS,
      ...flightFacts(),
      area,
      roof: roofLabel,
      padM: pad ? Math.hypot(pos.x - pad.x, pos.z - pad.z) : null,
      canBase: !!roof && canBaseFrom(solids, pos.x, pos.y, pos.z),
      from: jumpedFrom,
      delayS,
      distanceM: dist,
      usedReserve,
      redLight: leftOnRed,
      intoWind,
      hot,
      onBeach,
    };
    outcome = { ...facts, log: log.slice(), reason: water ? "Water" : "", score: score(facts) };
    if (!water) {
      save.rides += 1;
      if (onBeach && (save.bestM === null || dist < save.bestM)) save.bestM = Math.round(dist * 10) / 10;
    }
    if (roof) pushLog(`Down on ${roofLabel ?? "a roof"} · ${Math.round(pos.y * FT_PER_M).toLocaleString("en-US")} ft up`);
    else pushLog(water ? "Water landing" : `Down · ${Math.round(dist)} m`);
    if (outcome) outcome.log = log.slice();
    phase = "down";
    // A few seconds on your feet for the replay to end on.
    recUntil = simTime + 5;
    persist();
  }

  function tryJump() {
    if (!inDoor) {
      flashText = "STEP INTO THE DOOR";
      flashUntil = simTime + 1.6;
      return;
    }
    _v3.set(riderX, 0.05, riderZ);
    plane.localToWorld(_v3);
    pos.copy(_v3);
    _v2.set(1, 0, 0).applyQuaternion(plane.quaternion);
    vel.copy(planeVel).addScaledVector(_v2, 2.2);
    vel.y -= 0.6;
    _e.setFromQuaternion(camera.quaternion, "YXZ");
    bodyYaw = _e.y;
    bodyPitch = _e.x;
    bank = 0;
    heading = bodyYaw;
    leftOnRed = !green;
    save.jumps += 1;
    pushLog(
      `Exit ${Math.round(pos.y * FT_PER_M).toLocaleString("en-US")} ft ${green ? "on green" : "on red"}`,
    );
    phase = "freefall";
    flying = "none";
    if (suit === "wing") {
      // Wingsuiters leave last, after the belly flyers, and fly away on their own.
      resetFormation();
      exitTime = simTime;
      startWing(bodyYaw);
    } else if (ringsOn) {
      // The rings instead of the formation: you leave on your own and the course is below you.
      resetFormation();
      exitTime = simTime;
      layRings("flat", 230);
    } else {
      _v2.set(1, 0, 0).applyQuaternion(plane.quaternion);
      startFormation(_v2);
    }
    persist();
  }

  function startWing(yaw: number) {
    wing = createWing(yaw);
    exitPitch = bodyPitch;
    lookOffYaw = 0;
    lookOffPitch = 0;
    flightM = 0;
    glideM = 0;
    glideDrop = 0;
    suitFlying = false;
  }

  function startFormation(out: THREE.Vector3) {
    resetFormation();
    exitTime = simTime;
    formation.exit(pos, vel, out, bodyYaw);
  }

  // Flying at the open slot from close in: the target velocity eases into a controlled closing
  // speed relative to the base, the way a real approach slows down for the last few meters.
  // It is relative to the air the base settles into (wind, BASE_FALL), not the base's current
  // velocity, so both shed the plane's speed together after exit.
  function approach(target: THREE.Vector3, dt: number, turnInput: number) {
    if (docked || !formation.active() || simTime < dockAgainAt) return;
    formation.slot(_base);
    const dx = pos.x - _base.x;
    const dz = pos.z - _base.z;
    const dy = pos.y + 0.32 - _base.y;
    const d = Math.hypot(dx, dz);
    if (d > 14 || d < 0.01) return;
    if (d > 4 && Math.cos(Math.atan2(dx, dz) - bodyYaw) < 0.2) return;
    const w = smooth((14 - d) / 8);
    const close = Math.min(d * 0.9, 6);
    target.x += (WIND_X - (dx / d) * close - target.x) * w;
    target.z += (WIND_Z - (dz / d) * close - target.z) * w;
    if (d < 8) target.y += (-BASE_FALL - clamp(dy, -3, 3) * 1.2 - target.y) * w * 0.6;
    if (d < 3 && Math.abs(turnInput) < 0.1) {
      bodyYaw = easeAngle(bodyYaw, formation.slotYaw(), 1 - Math.exp(-1.5 * dt));
    }
  }

  // Docking on the base: get into the open slot, roughly level and facing in, and the
  // other two take your grips. Any strong input lets go.
  function dock(dt: number, input: ReturnType<typeof sample>) {
    if (!formation.active()) {
      if (docked) {
        docked = false;
        formation.setPlayerDocked(false);
      }
      return;
    }
    formation.slot(_v1);
    const yawIn = formation.slotYaw();
    if (docked) {
      const still = Math.abs(input.forward) < 0.3 && Math.abs(input.turn) < 0.3;
      if (!gripSettled) gripSettled = still;
      else if (Math.abs(input.forward) > 0.6 || Math.abs(input.turn) > 0.6) {
        docked = false;
        formation.setPlayerDocked(false);
        flashText = "LOST THE GRIP";
        flashUntil = simTime + 1.4;
        dockAgainAt = simTime + 2;
        pushLog("Lost the grip");
        return;
      }
      // Aim short of the slot by this step's fall, which step() adds right after.
      _v1.y -= 0.32;
      pos.lerp(_v1.addScaledVector(formation.baseVel, -dt), 1 - Math.exp(-6 * dt));
      vel.copy(formation.baseVel);
      bodyYaw = easeAngle(bodyYaw, yawIn, 1 - Math.exp(-4 * dt));
      return;
    }
    if (simTime < dockAgainAt || !formation.ready()) return;
    const dx = pos.x - _v1.x;
    const dz = pos.z - _v1.z;
    const dy = pos.y + 0.32 - _v1.y;
    const facingIn = Math.cos(yawIn - bodyYaw) > 0.45;
    const closing = Math.abs(vel.y - formation.baseVel.y) < 8;
    if (Math.hypot(dx, dz) < 1.9 && Math.abs(dy) < 1.7 && closing && facingIn) {
      docked = true;
      gripSettled = false;
      formation.setPlayerDocked(true);
      flashText = "DOCKED";
      flashUntil = simTime + 1.8;
      audio.beep(880, 0.1, 0.06);
      audio.beep(1175, 0.14, 0.06);
      if (!dockedOnce) {
        dockedOnce = true;
        dockedFt = pos.y * FT_PER_M;
        const ft = Math.round(pos.y * FT_PER_M).toLocaleString("en-US");
        pushLog(`Docked at ${ft} ft · ${(simTime - exitTime).toFixed(1)} s after exit`);
      }
    }
  }

  function pullMain() {
    if (phase !== "freefall" || reserveArmed) return;
    const alt = pos.y * FT_PER_M;
    phase = "deploying";
    openT = 0;
    shockFired = false;
    gesture = "pull";
    gestureStart = simTime;
    deployingReserve = false;
    // A BASE rig has no reserve, so the game gives it no malfunctions either.
    const base = mode === "base";
    mal = !base && Math.random() < malChance ? (Math.random() < 0.62 ? "streamer" : "twist") : "none";
    if (wing) {
      // The canopy opens along the line you flew; the eyes come back to it.
      bodyYaw = wing.yaw;
      bodyPitch = clamp(bodyPitch - lookOffPitch, -1.35, 1.15);
      lookOffYaw = 0;
      lookOffPitch = 0;
      const km = flightM >= 1000 ? `${(flightM / 1000).toFixed(1)} km` : `${Math.round(flightM)} m`;
      const g = flightFacts().glide;
      pushLog(`Flew ${km} in the suit${g !== null ? ` · glide ${g.toFixed(1)}` : ""}`);
      wing = null;
    }
    if (course.next()) {
      const left = course.close(simTime);
      pushLog(`Rings ${course.got()} of ${course.total()} · pulled with ${left} to go`);
    }
    heading = bodyYaw;
    if (base || deadAir) delayS = simTime - exitTime;
    pushLog(
      `Pull at ${Math.round(alt).toLocaleString("en-US")} ft${base || deadAir ? ` · ${(delayS ?? 0).toFixed(1)} s delay` : ""}`,
    );
    audio.fabric();
    if (!base && alt < 700) pushLog("That pull is late");
    if (docked) {
      docked = false;
      formation.setPlayerDocked(false);
    }
    pullFt = alt;
    if (formation.started()) {
      const near = formation.nearest(pos);
      pullSep = Number.isFinite(near) ? near : null;
      if (near < 25) {
        pushLog(`Opened ${Math.round(near)} m from another jumper`);
        flashText = "TOO CLOSE — TRACK AWAY BEFORE YOU PULL";
        flashUntil = simTime + 2.4;
      } else if (Number.isFinite(near)) pushLog(`Clear air at pull · ${Math.round(near)} m`);
      else pushLog("Clear air at pull");
    }
  }

  function cutaway() {
    if (phase !== "malfunction") return;
    phase = "freefall";
    mal = "none";
    reserveArmed = true;
    flying = "none";
    canopy.visible = false;
    streamer.visible = false;
    vel.y = Math.min(vel.y, -30);
    gesture = "cutaway";
    gestureStart = simTime;
    pushLog(`Cut away at ${Math.round(pos.y * FT_PER_M).toLocaleString("en-US")} ft`);
    audio.fabric();
    flashText = "PULL RESERVE";
    flashUntil = simTime + 2.4;
  }

  function pullReserve() {
    if (!reserveArmed || phase !== "freefall") return;
    const alt = pos.y * FT_PER_M;
    if (alt < 550) {
      pushLog("Reserve pulled too low");
      finishImpact("Too low for the reserve");
      return;
    }
    phase = "deploying";
    mal = "none";
    deployingReserve = true;
    reserveArmed = false;
    usedReserve = true;
    openT = 0;
    shockFired = false;
    gesture = "reserve";
    gestureStart = simTime;
    heading = bodyYaw;
    pushLog(`Reserve at ${Math.round(alt).toLocaleString("en-US")} ft`);
    audio.fabric();
  }

  function forcePhase(p: string) {
    outcome = null;
    ride = p.startsWith("roof") ? "roof" : "plane";
    ringsOn = bridge.rings && ride !== "roof";
    if (p === "heli" || p === "balloon") {
      resetJump();
      suit = bridge.suit;
      ride = p;
      board();
      return;
    }
    if (p.startsWith("roof")) {
      const pad = pads.list.find((q) => q.id === p.split(":")[1]) ?? pads.list[0];
      resetJump();
      suit = bridge.suit;
      if (pad) standOnRoof(pad.x, pad.z, pad.yaw, pad.name);
      return;
    }
    if (p === "wing") {
      // Flying a full wingsuit south along the lakefront, 8,000 ft up.
      resetJump();
      suit = "wing";
      mode = "skydive";
      phase = "freefall";
      flying = "none";
      mal = "none";
      pos.set(RUN_X - 200, 2440, -1800);
      bodyYaw = Math.PI;
      bodyPitch = -0.2;
      vel.set(WIND_X, -17, 44 + WIND_Z);
      exitTime = simTime;
      startWing(Math.PI);
      if (wing) wing.t = 4;
      canopy.visible = false;
      streamer.visible = false;
      return;
    }
    if (p === "padfinal") {
      // On final for the South Loop roof, into the wind off the lake.
      const pad = pads.list[0];
      if (!pad) return;
      resetJump();
      phase = "canopy";
      mode = "skydive";
      flying = "main";
      pos.set(pad.x - 40, pad.y + 30, pad.z + 2);
      heading = -Math.PI / 2;
      bodyYaw = heading;
      vel.set(10.5 + WIND_X, -5.4, WIND_Z);
      canopy.visible = true;
      lookOffYaw = 0;
      lookOffPitch = 0;
      return;
    }
    mode = "skydive";
    if (p === "canopy") {
      phase = "canopy";
      flying = "main";
      mal = "none";
      deployingReserve = false;
      pos.set(DZ_X + 40, 720, DZ_Z + 50);
      heading = 0.15;
      bodyYaw = heading;
      bodyPitch = -0.2;
      const fx = -Math.sin(heading);
      const fz = -Math.cos(heading);
      vel.set(fx * 11 + WIND_X, -5.2, fz * 11 + WIND_Z);
      canopy.visible = true;
      streamer.visible = false;
      lookOffYaw = 0;
      lookOffPitch = 0;
    } else if (p === "freefall") {
      phase = "freefall";
      flying = "none";
      mal = "none";
      reserveArmed = false;
      warnedDecision = false;
      beepAcc = 0;
      pos.set(RUN_X, 1500, 0);
      vel.set(WIND_X, -56, 0.4);
      bodyYaw = Math.PI / 2;
      bodyPitch = -0.12;
      canopy.visible = false;
      streamer.visible = false;
    } else if (p === "slam") {
      phase = "freefall";
      flying = "none";
      mal = "none";
      reserveArmed = false;
      outcome = null;
      canopy.visible = false;
      streamer.visible = false;
      pos.set(DZ_X, 15, DZ_Z);
      vel.set(0, -40, 0);
      bodyYaw = -Math.PI / 2;
      bodyPitch = -0.35;
      audio.resetDeath();
    } else if (p === "formation") {
      phase = "freefall";
      flying = "none";
      mal = "none";
      reserveArmed = false;
      warnedDecision = false;
      canopy.visible = false;
      streamer.visible = false;
      pos.set(RUN_X, 3600, 0);
      vel.set(WIND_X, -40, 0.4);
      bodyPitch = -0.3;
      bodyYaw = 0;
      startFormation(_v2.set(0, 0, 1));
      formation.center(_v1);
      bodyYaw = Math.atan2(-(_v1.x - pos.x), -(_v1.z - pos.z));
    } else if (p === "cabin") begin();
  }

  function openDur() {
    return deployingReserve ? 1.45 : mode === "base" ? BASE_OPEN_S : 2.65;
  }

  plane.position.copy(path[0] ?? new THREE.Vector3());
  plane.position.y = clamp(bridge.altitudeFt, 8000, 20000) / FT_PER_M;

  const timer = new THREE.Timer();
  timer.connect(document);

  function sample() {
    lookDX += bridge.lookX;
    lookDY += bridge.lookY;
    bridge.lookX = 0;
    bridge.lookY = 0;
    const source = qaKeys ?? keys;
    const edgeOf = (code: string) =>
      qaKeys ? source.has(code) && !prevQa.has(code) : eventEdges.has(code);
    const keyL = source.has("KeyA") || source.has("ArrowLeft");
    const keyR = source.has("KeyD") || source.has("ArrowRight");
    const keyF = source.has("KeyW") || source.has("ArrowUp");
    const keyB = source.has("KeyS") || source.has("ArrowDown") || bridge.flare;
    let turn = axis(keyR, keyL, -bridge.moveX);
    if (steerOverride !== null) turn = clamp(steerOverride, -1, 1);
    const strafe = axis(keyL, keyR, bridge.moveX);
    const forward = axis(keyB, keyF, bridge.flare ? -1 : bridge.moveY);
    const jumpEdge = (bridge.jump && !prevJump) || edgeOf("Space");
    const pullEdge = (bridge.pull && !prevPull) || edgeOf("Space");
    const cutEdge = (bridge.cut && !prevCut) || edgeOf("KeyX") || edgeOf("KeyC");
    const reserveEdge = (bridge.reserve && !prevReserve) || edgeOf("KeyR");
    const endEdge = edgeOf("Escape");
    // Shift runs; on a touch screen, the stick pushed all the way out.
    const run = source.has("ShiftLeft") || source.has("ShiftRight") || Math.hypot(bridge.moveX, bridge.moveY) > 0.92;
    prevJump = bridge.jump;
    prevPull = bridge.pull;
    prevCut = bridge.cut;
    prevReserve = bridge.reserve;
    if (qaKeys) prevQa = new Set(qaKeys);
    else eventEdges.clear();
    return { turn, strafe, forward, run, jumpEdge, pullEdge, cutEdge, reserveEdge, endEdge };
  }

  function step(dt: number, input: ReturnType<typeof sample> | null) {
    simTime += dt;
    let left = PLANE_MPS * dt;
    while (left > 0) {
      const aa = path[seg] ?? path[0]!;
      const bb = path[seg + 1] ?? path[0]!;
      const len = Math.max(0.001, aa.distanceTo(bb));
      const remain = len - segDist;
      if (left < remain) {
        segDist += left;
        left = 0;
      } else {
        left -= remain;
        seg = (seg + 1) % 4;
        segDist = 0;
      }
    }
    const a2 = path[seg] ?? path[0]!;
    const b2 = path[seg + 1] ?? path[0]!;
    const len2 = Math.max(0.001, a2.distanceTo(b2));
    plane.position.lerpVectors(a2, b2, segDist / len2);
    const sliderAlt = clamp(bridge.altitudeFt, 8000, 20000) / FT_PER_M;
    plane.position.y = phase === "menu" ? sliderAlt : lockedAlt;
    _v1.subVectors(b2, a2);
    if (_v1.lengthSq() > 0) _v1.normalize();
    planeVel.copy(_v1).multiplyScalar(PLANE_MPS);
    const targetYaw = yawOf(_v1.x, _v1.z);
    const dy = Math.atan2(Math.sin(targetYaw - planeYaw), Math.cos(targetYaw - planeYaw));
    planeYaw += dy * (1 - Math.exp(-3 * dt));
    planeBank += (clamp(-dy * 1.4, -0.35, 0.35) - planeBank) * (1 - Math.exp(-2 * dt));
    plane.rotation.order = "YXZ";
    plane.rotation.set(0, planeYaw, planeBank);
    propL.rotation.z += dt * 42;
    propR.rotation.z += dt * 42;
    southboundLight(_v1);
    waterUniforms.uTime.value = simTime;
    waterUniforms.uCam.value.copy(camera.position);
    skyline.update(dt);
    life.update(simTime);
    pads.update(simTime);
    course.update(simTime, camera.position);
    sock.rotation.y = Math.sin(simTime * 7) * 0.12;
    // In a replay the rides fly as the tape has them.
    if (!director) moveRides(dt);
    (beacon.material as THREE.MeshStandardMaterial).emissiveIntensity =
      Math.sin(simTime * 8) > 0.4 ? 2 : 0.15;

    if (!input) return;
    const sens = 0.00215;
    if (phase === "cabin" || phase === "roof" || phase === "aboard") {
      localYaw -= lookDX * sens;
      // Sitting in the helicopter's door, the head turns but the body stays facing out.
      if (phase === "aboard" && ride === "heli") localYaw = clamp(localYaw, HELI_SEAT_YAW - 1.7, HELI_SEAT_YAW + 1.7);
      localPitch = clamp(localPitch - lookDY * sens, phase === "cabin" ? -1.2 : -1.4, 1.05);
    } else if (phase === "canopy" || phase === "down") {
      lookOffYaw = clamp(lookOffYaw - lookDX * sens, -1.35, 1.35);
      lookOffPitch = clamp(lookOffPitch - lookDY * sens, -1.0, 1.5);
    } else if (phase === "freefall" && wing) {
      // In a wingsuit the keys fly and the mouse only turns your head.
      lookOffYaw = clamp(lookOffYaw - lookDX * sens, -1.35, 1.35);
      lookOffPitch = clamp(lookOffPitch - lookDY * sens, -1.0, 1.0);
    } else if (phase === "freefall" || phase === "deploying" || phase === "malfunction") {
      bodyYaw -= lookDX * sens;
      // On a ring course you can look almost straight down at the next ring.
      bodyPitch = clamp(bodyPitch - lookDY * sens, ringsLive() ? -1.5 : -1.35, 1.15);
    }
    lookDX = 0;
    lookDY = 0;

    if (phase === "menu") return;

    if (phase === "cabin") {
      const fx = -Math.sin(localYaw);
      const fz = -Math.cos(localYaw);
      const rx = Math.cos(localYaw);
      const rz = -Math.sin(localYaw);
      const moving = Math.abs(input.forward) + Math.abs(input.strafe) > 0.05;
      if (moving) walk += dt * 7;
      const sp = 2.6;
      const dx = (rx * input.strafe + fx * input.forward) * sp * dt;
      const dz = (rz * input.strafe + fz * input.forward) * sp * dt;
      const nx = riderX + dx;
      const nz = riderZ + dz;
      if (cabinOk(nx, nz)) {
        riderX = nx;
        riderZ = nz;
      } else if (cabinOk(nx, riderZ)) riderX = nx;
      else if (cabinOk(riderX, nz)) riderZ = nz;
      // The bar across the door holds you in until the green light lifts it. Then the door is
      // open, and running out of it is the exit.
      const doorOpen = cabin.barOpen() > 0.85;
      const doorway = riderZ > 0.24 && riderZ < 1.72;
      if (doorway && !doorOpen) riderX = Math.min(riderX, 1.0);
      inDoor = riderX > 0.8 && riderZ > 0.28 && riderZ < 1.7;
      if (doorOpen && doorway && riderX >= 1.3 && dx > 0) {
        tryJump();
        return;
      }
      if (inDoor && !doorBriefed) {
        doorBriefed = true;
        flashText = "PULL BY 4,500 FT — HARD DECK 2,000";
        flashUntil = simTime + 4.2;
        audio.beep(740, 0.14, 0.05);
        audio.beep(980, 0.16, 0.05);
      }
      if (input.jumpEdge) tryJump();
      return;
    }

    if (phase === "roof") {
      walkRoof(dt, input);
      return;
    }

    if (phase === "aboard") {
      rideAboard(dt, input);
      return;
    }

    formation.update(dt, simTime);
    if (phase === "down" || phase === "impact") return;

    const arch = input.forward > 0.4;
    const dive = input.forward < -0.4;
    if (input.cutEdge) cutaway();
    if (phase === "malfunction" && (input.reserveEdge || input.pullEdge) && !input.cutEdge) {
      flashText = "CUT AWAY FIRST — X, THEN R";
      flashUntil = simTime + 1.5;
    }
    if (reserveArmed && phase === "freefall" && (input.reserveEdge || input.pullEdge)) pullReserve();
    else if (phase === "freefall" && !reserveArmed && input.pullEdge) pullMain();

    if (phase === "freefall" && wing) {
      flyTheSuit(dt, input);
    } else if (phase === "freefall" && (mode === "base" || deadAir)) {
      baseFall(dt, input.turn, arch, dive);
    } else if (phase === "freefall" || (phase === "malfunction" && mal === "streamer") || (phase === "deploying" && mal === "streamer")) {
      bodyYaw += input.turn * 1.25 * dt;
      const diveAmt = clamp(-bodyPitch / 1.15, 0, 1);
      let terminal = 53;
      let h = 4 + diveAmt * 26;
      if (arch && phase === "freefall") {
        terminal = 46;
        h *= 0.4;
      }
      if (dive && phase === "freefall") {
        terminal = 76 + diveAmt * 16;
        h += 10;
      }
      if (ringsLive()) h = ringTrack(terminal, arch, dive);
      if (mal === "streamer") terminal = 40;
      const fx = -Math.sin(bodyYaw);
      const fz = -Math.cos(bodyYaw);
      _v1.set(fx * h + WIND_X, -terminal, fz * h + WIND_Z);
      if (phase === "freefall") approach(_v1, dt, input.turn);
      vel.lerp(_v1, 1 - Math.exp(-1.8 * dt));
    } else if (phase === "malfunction" && mal === "twist") {
      bodyYaw += dt * 4.2;
      heading = bodyYaw;
      _v1.set(-Math.sin(bodyYaw) * 4 + WIND_X, -16, -Math.cos(bodyYaw) * 4 + WIND_Z);
      vel.lerp(_v1, 1 - Math.exp(-2 * dt));
    } else if (phase === "deploying" && mal === "none") {
      openT += dt;
      const dur = openDur();
      const u = smooth(openT / dur);
      if (!shockFired && openT > dur * 0.42) {
        // Slider comes down: the opening shock.
        shockFired = true;
        shock = deployingReserve ? 1 : 0.8;
      }
      heading = bodyYaw;
      const fx = -Math.sin(heading);
      const fz = -Math.cos(heading);
      const fspd = THREE.MathUtils.lerp(6, 10.5, u);
      const desc = THREE.MathUtils.lerp(-Math.min(Math.abs(vel.y), 55), 5.2, u);
      _v1.set(fx * fspd + WIND_X, -desc, fz * fspd + WIND_Z);
      vel.lerp(_v1, 1 - Math.exp(-3 * dt));
      if (openT >= dur) {
        phase = "canopy";
        flying = deployingReserve ? "reserve" : "main";
        lookOffYaw = 0;
        lookOffPitch = 0;
        pushLog(deployingReserve ? "Reserve flying" : "Main flying");
        audio.fabric();
      }
    } else if (phase === "deploying" && mal !== "none") {
      openT += dt;
      if (mal === "twist") {
        bodyYaw += dt * 3.2;
        _v1.set(WIND_X, -22, WIND_Z);
        vel.lerp(_v1, 1 - Math.exp(-1.5 * dt));
      }
      if (openT > 0.65 || pos.y * FT_PER_M < HARD_DECK_FT) {
        phase = "malfunction";
        pushLog(mal === "streamer" ? "Main streamer" : "Line twist");
        audio.alarm();
      }
    } else if (phase === "canopy") {
      heading += input.turn * 0.95 * dt;
      const brake = input.forward < -0.35 ? 1 : 0;
      const drive = input.forward > 0.35 ? 1 : 0;
      const ease = 1 - Math.exp(-7 * dt);
      const flareAmt = input.forward < -0.35 ? Math.min(1, -input.forward) : 0;
      brakeL += (Math.max(flareAmt, Math.max(0, input.turn) * 0.75) - brakeL) * ease;
      brakeR += (Math.max(flareAmt, Math.max(0, -input.turn) * 0.75) - brakeR) * ease;
      const fspd = 10.5 - brake * 6.2 + drive * 3.8;
      let desc = 5.4 - brake * 3.15 + drive * 0.85;
      if (brake && pos.y - floorY < 48) desc = Math.min(desc, 2.2);
      if (brake && pos.y - floorY < 14) desc = Math.min(desc, 1.3);
      const fx = -Math.sin(heading);
      const fz = -Math.cos(heading);
      _v1.set(fx * fspd + WIND_X, -desc, fz * fspd + WIND_Z);
      vel.lerp(_v1, 1 - Math.exp(-2.5 * dt));
    }

    if (deadAir) steady(dt, arch);
    if (phase === "freefall") dock(dt, input);
    else if (docked) {
      docked = false;
      formation.setPlayerDocked(false);
    }
    if (formation.broken() && !brokeOff) {
      brokeOff = true;
      docked = false;
      if (phase === "freefall") {
        pushLog(`Break-off at ${BREAKOFF_FT.toLocaleString("en-US")} ft`);
        flashText = "BREAK OFF — TRACK AWAY";
        flashUntil = simTime + 3;
        audio.beep(660, 0.12, 0.05);
        audio.beep(660, 0.12, 0.05);
      }
    }

    shock *= Math.exp(-3.4 * dt);
    if (!wing) {
      const bankTarget = -input.turn * 0.5;
      bank += (bankTarget - bank) * (1 - Math.exp(-6 * dt));
    }
    _prev.copy(pos);
    pos.addScaledVector(vel, dt);
    const hit = solids.contact(_prev, pos, BODY_R);
    if (hit) {
      hitBuilding(hit);
      return;
    }
    floorY = solids.top(pos.x, pos.z, pos.y)?.y1 ?? 0;
    if (phase === "freefall" && course.next()) ringCheck();

    if (pos.y <= 0 && phase !== "canopy") {
      if (phase === "deploying" && mal === "none" && deployingReserve) finishImpact("Reserve did not open in time");
      else if (phase === "deploying" && mal === "none") finishImpact("Main out too low");
      else if (phase === "malfunction" || mal !== "none") finishImpact("Rode a malfunction in");
      else if (reserveArmed) finishImpact("No reserve");
      else finishImpact("No canopy");
      return;
    }
    if (pos.y <= 0 && phase === "canopy") finishDown();

    const altFt = Math.max(0, pos.y) * FT_PER_M;
    const openingGood = phase === "deploying" && mal === "none";
    // BASE jumpers count the delay themselves: no audible altimeter.
    const inDanger =
      mode === "skydive" &&
      (phase === "freefall" || phase === "malfunction" || (phase === "deploying" && mal !== "none")) &&
      !openingGood;
    if (inDanger && !warnedDecision && altFt <= DECISION_FT && altFt > PULL_NOW_FT) {
      warnedDecision = true;
      audio.triple();
      beepAcc = -0.5;
    }
    if (inDanger && altFt <= DECISION_FT) {
      const level = altFt <= HARD_DECK_FT ? 3 : altFt <= PULL_NOW_FT ? 2 : 1;
      const interval = level === 3 ? 0.18 : level === 2 ? 0.48 : 1.05;
      const freq = level === 3 ? 1280 : level === 2 ? 1040 : 860;
      beepAcc += dt;
      if (beepAcc >= interval) {
        beepAcc = 0;
        audio.beep(freq, level === 3 ? 0.08 : 0.11, level === 3 ? 0.09 : 0.06);
      }
    } else if (!inDanger) beepAcc = 0;

    const showCanopy =
      phase === "canopy" ||
      (phase === "deploying" && mal !== "streamer" && openT > 0.35) ||
      (phase === "malfunction" && mal === "twist");
    canopy.visible = showCanopy;
    if (showCanopy) {
      const dur = openDur();
      const u = phase === "deploying" ? smooth(clamp((openT - 0.3) / (dur * 0.8), 0.02, 1)) : 1;
      if (phase !== "canopy") {
        brakeL = 0;
        brakeR = 0;
      }
      canopy.position.copy(pos);
      canopy.position.y += EYE_UP - CANOPY_EYE_Y;
      canopy.rotation.set(0, heading, bank * 0.45);
      canopyRig.setReserve(flying === "reserve" || deployingReserve);
      canopyRig.update(u, brakeL, brakeR);
      canopyU = u;
    }
    streamer.visible = mal === "streamer" && (phase === "deploying" || phase === "malfunction");
    if (streamer.visible) waveStreamer(pos, simTime);
  }

  /** The streamer flogging above you: a column of fabric that never inflates. */
  function waveStreamer(at: THREE.Vector3, time: number) {
    streamer.position.copy(at);
    for (let i = 0; i < ribs.length; i++) {
      const rib = ribs[i];
      if (!rib) continue;
      rib.position.set(Math.sin(time * 6 + i) * 0.35, 1.2 + i * 0.85, Math.cos(time * 5 + i) * 0.25);
      rib.rotation.z = Math.sin(time * 4 + i) * 0.4;
    }
  }

  /** Walking a roof: steps up and down, walls stop you, and a clean drop below an edge is the exit. */
  function walkRoof(dt: number, input: ReturnType<typeof sample>) {
    const fx = -Math.sin(localYaw);
    const fz = -Math.cos(localYaw);
    const rx = Math.cos(localYaw);
    const rz = -Math.sin(localYaw);
    if (input.jumpEdge) runUp = true;
    if (runUp && input.forward < -0.3) runUp = false;
    let fwd = runUp ? 1 : input.forward;
    let side = runUp ? 0 : input.strafe;
    const m = Math.hypot(fwd, side);
    if (m < 0.05) return;
    if (m > 1) {
      fwd /= m;
      side /= m;
    }
    const running = runUp || input.run;
    const sp = running ? RUN_MPS : WALK_MPS;
    const vx = (rx * side + fx * fwd) * sp;
    const vz = (rz * side + fz * fwd) * sp;
    walk += dt * (running ? 11 : 7);
    let low = 0;
    const tryStep = (nx: number, nz: number) => {
      const st = stepTo(solids, nx, nz, pos.y);
      if (st.kind === "ok") pos.set(nx, st.y, nz);
      else if (st.kind === "edge") {
        pos.x = nx;
        pos.z = nz;
      } else if (st.kind === "ledge") low = st.drop;
      return st.kind;
    };
    let got = tryStep(pos.x + vx * dt, pos.z + vz * dt);
    // Slide along walls and ledges rather than sticking to them.
    if ((got === "wall" || got === "ledge") && !runUp) {
      got = tryStep(pos.x + vx * dt, pos.z);
      if (got === "wall" || got === "ledge") got = tryStep(pos.x, pos.z + vz * dt);
    }
    if (got === "edge") {
      baseExit(vx, vz, running);
      return;
    }
    if (got === "ok") return;
    if (runUp) runUp = false;
    if (simTime > flashUntil) {
      flashText = low
        ? `${Math.round(low)} m DOWN TO A LOWER ROOF — JUMP FROM ANOTHER EDGE`
        : "NO CLEAR EDGE THAT WAY";
      flashUntil = simTime + 2.2;
    }
  }

  /** Off the edge: a BASE exit at the speed you left with. */
  function baseExit(vx: number, vz: number, running: boolean) {
    const sp = Math.hypot(vx, vz) || 1;
    // Clear of the wall you just left, so the body starts in open air.
    for (let i = 0; i < 16 && solids.blocked(pos.x, pos.y - 1.6, pos.z, BODY_R + 0.02, 1.55); i++) {
      pos.x += (vx / sp) * 0.05;
      pos.z += (vz / sp) * 0.05;
    }
    vel.set(vx, running ? 1.6 : 0.2, vz);
    bodyYaw = localYaw;
    bodyPitch = clamp(localPitch, -1.35, 1.15);
    bank = 0;
    heading = bodyYaw;
    jumpedFrom = roofName;
    ranOff = running;
    exitTime = simTime;
    runUp = false;
    save.jumps += 1;
    const ft = Math.round(pos.y * FT_PER_M).toLocaleString("en-US");
    pushLog(`Off ${roofName} at ${ft} ft · ${running ? "running exit" : "stepped off"}`);
    phase = "freefall";
    flying = "none";
    if (suit === "wing") startWing(localYaw);
    persist();
  }

  /** Flies the helicopter and the balloons: hovering or drifting, and once you are gone, away. */
  function moveRides(dt: number) {
    const riding = phase !== "menu" && (ride === "heli" || ride === "balloon");
    if (riding) rideT += dt;
    const gone = leftAt < 0 ? 0 : simTime - leftAt;
    heli.group.visible = riding && ride === "heli" && gone < 90;
    balloon.group.visible = riding && ride === "balloon";
    for (const f of fleet) f.b.group.visible = balloon.group.visible;
    if (heli.group.visible) {
      // A hover holds still over the water; a few seconds after you go it noses over and leaves.
      const away = Math.max(0, gone - 5);
      const sp = leftAt < 0 ? 0 : Math.min(38, away * 3.5);
      heliOut += sp * dt;
      const t = simTime;
      heli.group.position.set(
        heliHome.x + heliOut,
        heliHome.y + Math.sin(t * 0.7) * 0.35 + heliOut * 0.08,
        heliHome.z + Math.sin(t * 0.43) * 0.25,
      );
      rideYaw = -Math.PI / 2;
      heli.group.rotation.set(-Math.min(0.16, away * 0.05), rideYaw + Math.sin(t * 0.31) * 0.015, Math.sin(t * 0.53) * 0.02, "YXZ");
      heli.group.updateMatrixWorld();
      rideVel.set(sp, Math.cos(t * 0.7) * 0.25 + sp * 0.08, Math.cos(t * 0.43) * 0.11);
      heli.update(dt, t, phase === "aboard" && cleared && rideT < HELI_CLEAR_S + 2.5);
    }
    if (balloon.group.visible) {
      // The burner holds the height with a long blast every so often. One jumper lighter, the
      // balloon climbs away after you leave.
      const cyc = rideT % 9;
      burn += ((cyc > 6 && cyc < 8.6 ? 1 : 0) - burn) * (1 - Math.exp(-12 * dt));
      const rise = leftAt < 0 ? 0 : Math.max(0, 1.4 - gone * 0.07);
      balloonRise += rise * dt;
      balloon.group.position.set(
        balloonStart.x + WIND_X * rideT,
        balloonStart.y + Math.sin(rideT * 0.21) * 1.2 + balloonRise,
        balloonStart.z + WIND_Z * rideT,
      );
      // Baskets turn slowly as they drift.
      rideYaw = rideT * 0.012;
      balloon.group.rotation.set(Math.sin(rideT * 0.6) * 0.006, rideYaw, Math.sin(rideT * 0.47) * 0.008, "YXZ");
      balloon.group.updateMatrixWorld();
      rideVel.set(WIND_X, Math.cos(rideT * 0.21) * 0.25 + rise, WIND_Z);
      balloon.update(dt, simTime, burn);
      for (const f of fleet) {
        const fc = (rideT + f.phase) % 11;
        f.burn += ((fc > 8 && fc < 10.4 ? 1 : 0) - f.burn) * (1 - Math.exp(-12 * dt));
        f.b.group.position.copy(balloon.group.position).sub(_v1.set(0, balloonRise, 0)).add(f.off);
        f.b.group.position.y += Math.sin(rideT * 0.17 + f.phase) * 3;
        f.b.group.rotation.y = rideT * 0.009 + f.phase;
        f.b.update(dt, simTime, f.burn);
      }
    }
    if (phase === "aboard") {
      pos.copy(ride === "heli" ? heli.group.position : balloon.group.position);
      vel.copy(rideVel);
    }
  }

  /** In the helicopter's door or the balloon's basket, until you go. */
  function rideAboard(dt: number, input: ReturnType<typeof sample>) {
    if (ride === "heli") {
      if (!cleared && rideT > HELI_CLEAR_S) {
        cleared = true;
        flashText = "PILOT: CLEAR TO JUMP";
        flashUntil = simTime + 2.6;
        audio.beep(740, 0.14, 0.05);
        audio.beep(980, 0.16, 0.05);
      }
      // Space pushes off the skid; once cleared, so does scooting forward off the floor.
      if (input.jumpEdge || (cleared && input.forward > 0.6)) leaveRide();
      return;
    }
    // In the basket: a step or two either way, then over the rim.
    const fx = -Math.sin(localYaw);
    const fz = -Math.cos(localYaw);
    const rx = Math.cos(localYaw);
    const rz = -Math.sin(localYaw);
    const sp = 1.2;
    const dx = (rx * input.strafe + fx * input.forward) * sp * dt;
    const dz = (rz * input.strafe + fz * input.forward) * sp * dt;
    if (Math.abs(dx) + Math.abs(dz) > 1e-5) walk += dt * 6;
    riderX = clamp(riderX + dx, BASKET.x0, BASKET.x1);
    riderZ = clamp(riderZ + dz, BASKET.z0, BASKET.z1);
    if (input.jumpEdge) leaveRide();
  }

  /** Off the skid or over the rim: into dead air, with no airspeed yet to fly on. */
  function leaveRide() {
    const fromHeli = ride === "heli";
    const v = fromHeli ? heli.group : balloon.group;
    // The way you face, level, in the world.
    _v2.set(-Math.sin(localYaw), 0, -Math.cos(localYaw)).applyQuaternion(v.quaternion);
    _v2.y = 0;
    _v2.normalize();
    if (fromHeli) _v3.copy(HELI_EXIT);
    else _v3.set(riderX - Math.sin(localYaw) * 1.1, RIM_Y - 0.2, riderZ - Math.cos(localYaw) * 1.1);
    v.localToWorld(_v3);
    pos.copy(_v3);
    vel.copy(rideVel).addScaledVector(_v2, fromHeli ? 1.6 : 1.1);
    vel.y += fromHeli ? -0.4 : 0.6;
    _e.setFromQuaternion(camera.quaternion, "YXZ");
    bodyYaw = _e.y;
    bodyPitch = _e.x;
    bank = 0;
    heading = bodyYaw;
    leftOnRed = fromHeli && !cleared;
    leftAt = simTime;
    exitTime = simTime;
    save.jumps += 1;
    const ft = Math.round(pos.y * FT_PER_M).toLocaleString("en-US");
    pushLog(
      fromHeli
        ? `Off the helicopter at ${ft} ft${leftOnRed ? " · before the pilot cleared you" : ""}`
        : `Over the rim of the balloon at ${ft} ft`,
    );
    phase = "freefall";
    flying = "none";
    deadAir = true;
    stableS = null;
    resetFormation();
    if (suit === "wing") startWing(bodyYaw);
    else {
      // Rolling off head first, with a twist one way or the other.
      tumbleP = 0;
      tumbleR = 0;
      spinP = fromHeli ? -0.9 : -1.15;
      spinR = (Math.random() < 0.5 ? -1 : 1) * (fromHeli ? 0.3 : 0.45);
      buffetAt = Math.random() * 6;
      // Below the dead air.
      if (ringsOn) layRings("flat", 300);
    }
    persist();
  }

  /**
   * Dead air off a helicopter or a balloon. With no airspeed the body rolls off head first and
   * gets knocked about until the air is fast enough to fly on. A held arch (W) stiffens it and
   * damps the tumble out; going limp lets it wander for seconds longer.
   */
  function steady(dt: number, arch: boolean) {
    if (phase !== "freefall" || wing) {
      // Opening the canopy, or a suit filling with air, straightens you out.
      const k = Math.exp(-4 * dt);
      tumbleP *= k;
      tumbleR *= k;
      spinP *= k;
      spinR *= k;
      return;
    }
    const air = Math.hypot(vel.x - WIND_X, vel.y, vel.z - WIND_Z);
    const q = Math.min(1.5, (air / 50) ** 2);
    const stiff = 5 * q * (arch ? 2.6 : 0.4);
    const damp = (0.4 + 2 * q) * (arch ? 2 : 1);
    const buffet = 2.2 * Math.min(1, air / 12) * clamp((50 - air) / 15, 0, 1) * (arch ? 0.15 : 1);
    const t = simTime - exitTime + buffetAt;
    spinP += (-stiff * tumbleP - damp * spinP + buffet * Math.sin(t * 1.9)) * dt;
    spinR += (-stiff * tumbleR - damp * spinR + buffet * Math.sin(t * 1.3 + 1)) * dt;
    tumbleP += spinP * dt;
    tumbleR += spinR * dt;
    const settled =
      Math.abs(tumbleP) < 0.15 && Math.abs(tumbleR) < 0.15 && Math.abs(spinP) < 0.25 && Math.abs(spinR) < 0.25;
    if (stableS === null && simTime - exitTime > 0.8 && settled) {
      stableS = simTime - exitTime;
      pushLog(`Stable ${stableS.toFixed(1)} s after the exit`);
      flashText = "STABLE";
      flashUntil = simTime + 1.4;
      audio.beep(880, 0.1, 0.05);
    }
  }

  /** Lays this jump's ring course: flat rings below a belly flyer, or gates ahead of a wingsuit. */
  function layRings(kind: RingKind, firstDrop: number) {
    let specs: RingSpec[];
    if (kind === "flat") {
      specs = planFlat({
        seed: courseSeed,
        from: pos,
        firstDrop,
        floorY: RING_FLOOR_FT / FT_PER_M,
        toward: { x: DZ_X, z: DZ_Z },
        windX: WIND_X,
        windZ: WIND_Z,
      });
    } else {
      specs = planGates({
        seed: courseSeed,
        from: pos,
        yaw: wing?.yaw ?? bodyYaw,
        floorY: GATE_FLOOR_FT / FT_PER_M,
        toward: GATE_HUB,
      });
    }
    course.lay(specs, kind, simTime);
    if (!specs.length) return;
    pushLog(`Ring course · ${specs.length} ${kind === "flat" ? "rings" : "gates"}`);
    flashText = kind === "flat" ? `${specs.length} RINGS BELOW` : `${specs.length} GATES AHEAD`;
    flashUntil = simTime + 3;
  }

  /** A ring course is laid and has rings left to fly. */
  function ringsLive() {
    return phase === "freefall" && course.next() !== null;
  }

  /**
   * On a ring course a belly flyer tracks where they look: looking at a ring below sets the
   * speed across that carries the fall down that line of sight, up to a full track. Looking
   * straight down holds you over the spot.
   */
  function ringTrack(terminal: number, arch: boolean, dive: boolean) {
    const down = clamp(-bodyPitch, 0.05, 1.5);
    return Math.min(arch ? 14 : dive ? 40 : 30, terminal / Math.tan(down));
  }

  /** Through the next ring, or past it. */
  function ringCheck() {
    const ev = course.cross(_prev, pos, simTime);
    if (!ev) return;
    const got = course.got();
    const n = course.total();
    const done = course.next() === null;
    if (ev === "pass") {
      audio.ring(course.streak());
      audio.whoosh(0.35);
    } else audio.ringMiss();
    if (done && got === n) {
      flashText = `CLEAN SWEEP · ${n} OF ${n}`;
      flashUntil = simTime + 2.6;
      audio.sweep();
    } else if (done) {
      flashText = `RINGS DONE · ${got} OF ${n}`;
      flashUntil = simTime + 2.2;
    } else {
      const run = course.streak();
      flashText =
        ev === "miss" ? `MISSED · ${got} OF ${n}` : run >= 3 ? `${run} IN A ROW · ${got} OF ${n}` : `THROUGH · ${got} OF ${n}`;
      flashUntil = simTime + 1.1;
    }
    if (done) pushLog(`Rings ${got} of ${n}${got === n ? " · clean sweep" : ""}`);
  }

  /** Wingsuit flight: the suit flies, the eyes follow the flight path, and close passes count. */
  function flyTheSuit(dt: number, input: ReturnType<typeof sample>) {
    if (!wing) return;
    const fill = flyWing(wing, vel, WIND_X, WIND_Z, input.turn, input.forward, dt);
    const gs = Math.hypot(vel.x, vel.z);
    flightM += gs * dt;
    if (!suitFlying && fill > 0.98 && gs > -vel.y) suitFlying = true;
    // Gates go down once the suit flies, ahead along the line it is flying.
    if (suitFlying && ringsOn && !course.laid()) layRings("gate", 0);
    if (suitFlying) {
      glideM += gs * dt;
      glideDrop -= vel.y * dt;
    }
    // Eyes on the horizon a little below the flight path, rolled with the bank.
    const flyPitch = clamp(pathPitch(vel, WIND_X, WIND_Z) * 0.7 - 0.1, -1.2, 0.5);
    bodyYaw = wing.yaw + lookOffYaw;
    bodyPitch = clamp(THREE.MathUtils.lerp(exitPitch, flyPitch, fill) + lookOffPitch, -1.4, 1.2);
    bank = wing.bank * 0.85;

    proxAcc += dt;
    if (proxAcc < 0.05) return;
    proxAcc = 0;
    const air = Math.hypot(vel.x - WIND_X, vel.y, vel.z - WIND_Z);
    const d = solids.nearest(pos.x, pos.y, pos.z, PASS_M + 5);
    // Only once the suit is flying: falling past the tower you just left is not a pass.
    if (d <= PASS_M && air > 25 && suitFlying) {
      if (passReady) {
        passReady = false;
        passMin = d;
        passes += 1;
        audio.whoosh(clamp(1.3 - d / PASS_M, 0.4, 1));
      }
      passMin = Math.min(passMin, d);
      closestM = closestM === null ? passMin : Math.min(closestM, passMin);
      flashText = `CLOSE PASS · ${Math.round(passMin)} M`;
      flashUntil = simTime + 1.2;
      passClear = 0;
    } else if (!passReady) {
      passClear += 0.05;
      if (passClear > 0.8) {
        passReady = true;
        pushLog(`Close pass · ${Math.round(passMin)} m at ${Math.round(air * MPH_PER_MPS)} mph`);
      }
    }
  }

  /**
   * BASE freefall. You leave at a standstill, so the fall builds from nothing, and the body
   * only grips the air to turn or track once it is moving fast through it.
   */
  function baseFall(dt: number, turn: number, arch: boolean, dive: boolean) {
    bodyYaw += turn * 1.25 * dt;
    const diveAmt = clamp(-bodyPitch / 1.15, 0, 1);
    let terminal = 53;
    let h = 4 + diveAmt * 26;
    if (arch) {
      terminal = 46;
      h *= 0.4;
    }
    if (dive) {
      terminal = 76 + diveAmt * 16;
      h += 10;
    }
    if (ringsLive()) h = ringTrack(terminal, arch, dive);
    const fall = Math.max(0, -vel.y);
    vel.y -= 9.81 * (1 - (fall / terminal) ** 2) * dt;
    const k = 1 - Math.exp(-1.8 * Math.min(1, (fall / 40) ** 2) * dt);
    vel.x += (-Math.sin(bodyYaw) * h + WIND_X - vel.x) * k;
    vel.z += (-Math.cos(bodyYaw) * h + WIND_Z - vel.z) * k;
  }

  /** Coming down on a roof, or into a wall. Under canopy a roof is a landing; anything else is a crash. */
  function hitBuilding(hit: Contact) {
    const s = hit.solid;
    let top = hit.top;
    if (!top && phase === "canopy" && pos.y >= s.y1 - 1) {
      // Caught the very edge on final: scramble up onto it.
      pos.x = clamp(pos.x, s.x0 + 0.4, s.x1 - 0.4);
      pos.z = clamp(pos.z, s.z0 + 0.4, s.z1 - 0.4);
      top = true;
    }
    if (top) {
      pos.y = s.y1;
      if (phase === "canopy") finishDown(s);
      else if (wing) finishImpact("Flew the suit into a rooftop");
      else finishImpact(phase === "freefall" ? "Went in on a rooftop" : "No open canopy over a roof");
      return;
    }
    pos.x = _prev.x;
    pos.z = _prev.z;
    finishImpact(
      phase === "canopy"
        ? "Flew into the side of a building"
        : wing
          ? "Flew the suit into a building"
          : "Hit the side of a building",
    );
  }

  /** The closest marked roof below you, within reach of a canopy. */
  function padBelow() {
    let best: (typeof pads.list)[number] | null = null;
    let bestD = 1600;
    for (const p of pads.list) {
      if (p.y > pos.y - 5) continue;
      const d = Math.hypot(p.x - pos.x, p.z - pos.z);
      if (d < bestD) [best, bestD] = [p, d];
    }
    return best;
  }

  function roofPrompt() {
    if (runUp) return "RUNNING FOR THE EDGE";
    const ahead = lookAhead(solids, pos.x, pos.y, pos.z, -Math.sin(localYaw), -Math.cos(localYaw), 6);
    if (ahead.kind === "edge" && ahead.dist <= 1.5) {
      return `THE EDGE · ${Math.round(ahead.drop * FT_PER_M).toLocaleString("en-US")} FT DOWN · STEP OFF`;
    }
    if (ahead.kind === "ledge") return "A LOWER ROOF IS RIGHT BELOW — JUMP ANOTHER WAY";
    return coarse ? "WALK TO THE EDGE · JUMP RUNS YOU OFF" : "WALK TO THE EDGE · SPACE RUNS AND JUMPS";
  }

  function southboundLight(dir: THREE.Vector3) {
    const onRun = Math.abs(plane.position.x - RUN_X) < 90 && dir.z > 0.55;
    green = onRun && Math.abs(plane.position.z - DZ_Z) < GREEN_HALF;
    if (green && !wasGreen && phase === "cabin") {
      // The jump buzzer, and the bar starts up its posts.
      audio.beep(660, 0.22, 0.07);
      flashText = "GREEN LIGHT — GO!";
      flashUntil = simTime + 2.2;
    }
    wasGreen = green;
    glow.color.set(green ? "#3dce73" : "#e23d3d");
    glow.emissive.set(green ? "#3dce73" : "#e23d3d");
  }

  function poseName(forward: number) {
    if (phase !== "freefall") return phase === "canopy" ? "CANOPY" : "";
    if (deadAir && !wing && stableS === null) return "DEAD AIR";
    if (wing) {
      if (wingFill(wing) < 0.9) return "SUIT FILLING";
      return wing.pitch > 0.35 ? "DIVE" : wing.pitch < -0.35 ? "FLARE" : "GLIDE";
    }
    if (forward < -0.4 && bodyPitch < -0.45) return "TRACK";
    if (forward < -0.4) return "DIVE";
    if (forward > 0.4) return "ARCH";
    return "BELLY";
  }

  function publish(inputForward: number) {
    const altFt =
      phase === "menu" || phase === "cabin"
        ? plane.position.y * FT_PER_M
        : Math.max(0, pos.y) * FT_PER_M;
    let banner = "";
    let bannerLevel: 0 | 1 | 2 | 3 = 0;
    const openingGood = phase === "deploying" && mal === "none";
    if (!openingGood && (phase === "freefall" || phase === "malfunction" || (phase === "deploying" && mal !== "none"))) {
      const malNow = phase === "malfunction" || mal !== "none";
      if (malNow && altFt <= HARD_DECK_FT) {
        banner = "HARD DECK — CUT AWAY AND PULL RESERVE";
        bannerLevel = 3;
      } else if (reserveArmed) {
        banner = "PULL RESERVE";
        bannerLevel = altFt <= HARD_DECK_FT ? 3 : 2;
      } else if (malNow) {
        banner = "MAIN FAILED — CUT AWAY, THEN RESERVE";
        bannerLevel = altFt <= PULL_NOW_FT ? 3 : 2;
      } else if (altFt <= DECK[mode].hard) {
        banner = mode === "base" ? "PULL!" : "HARD DECK — PULL IMMEDIATELY";
        bannerLevel = 3;
      } else if (altFt <= DECK[mode].now) {
        banner = "PULL NOW";
        bannerLevel = 2;
      } else if (altFt <= DECK[mode].pull) {
        banner = mode === "base" ? "PULL" : "CRITICAL ALTITUDE — PULL";
        bannerLevel = 1;
      }
    }
    if (simTime < flashUntil && flashText) {
      banner = flashText;
      if (bannerLevel === 0) bannerLevel = 1;
    }

    let prompt = "";
    if (phase === "cabin") {
      prompt = green
        ? "GREEN LIGHT — RUN OUT THE DOOR"
        : inDoor
          ? "RED LIGHT — WAIT FOR GREEN"
          : "WALK TO THE DOOR";
    } else if (phase === "roof") {
      prompt = roofPrompt();
    } else if (phase === "aboard") {
      if (ride === "balloon") prompt = coarse ? "FACE OUT · TAP JUMP TO GO OVER THE RIM" : "FACE OUT · SPACE CLIMBS OVER THE RIM";
      else if (!cleared) prompt = "HOLD ON · THE PILOT IS SETTLING THE HOVER";
      else prompt = coarse ? "CLEAR TO JUMP · TAP JUMP TO PUSH OFF" : "CLEAR TO JUMP · SPACE PUSHES OFF";
    } else if (phase === "freefall") {
      const pullKey = coarse ? "TAP PULL" : "SPACE PULLS";
      if (wing) {
        const down = -vel.y;
        const glide = Math.hypot(vel.x, vel.z) / Math.max(0.1, down);
        if (wingFill(wing) < 0.6) prompt = "LET THE SUIT FILL";
        else if (down < 0.5) prompt = `CLIMBING · ${pullKey}`;
        else if (course.next())
          prompt = `GATES ${course.got()} OF ${course.total()} · GLIDE ${glide > 9.9 ? "10+" : glide.toFixed(1)}`;
        else prompt = `GLIDE ${glide > 9.9 ? "10+" : glide.toFixed(1)} · ${pullKey}`;
      } else if (mode === "base") prompt = `DELAY ${(simTime - exitTime).toFixed(1)} s · ${coarse ? "TAP PULL" : "SPACE PULLS"}`;
      else if (reserveArmed) prompt = "PULL RESERVE — R OR SPACE";
      else if (deadAir && stableS === null) prompt = coarse ? "DEAD AIR · PUSH UP TO ARCH" : "DEAD AIR · HOLD W TO ARCH";
      else if (course.next()) prompt = `RINGS ${course.got()} OF ${course.total()} · LOOK AT THE GOLD ONE`;
      else if (deadAir) prompt = `DELAY ${(simTime - exitTime).toFixed(1)} s · ${pullKey}`;
      else if (docked) prompt = "DOCKED · HOLD ON UNTIL BREAK-OFF";
      else if (formation.active()) {
        formation.slot(_base);
        const d = Math.hypot(_base.x - pos.x, _base.z - pos.z);
        const dy = _base.y - (pos.y + 0.32);
        if (d > 4) prompt = `FLY TO THE OPEN SLOT · ${Math.round(d)} m`;
        else if (dy > 1.4) prompt = "SLOT IS ABOVE — ARCH TO RISE";
        else if (dy < -1.4) prompt = "SLOT IS BELOW — DIVE TO DROP DOWN";
        else if (!formation.ready()) prompt = "HOLD THERE — THE BASE IS BUILDING";
        else prompt = "FACE IN TO DOCK";
      } else if (brokeOff && formation.nearest(pos) < 30) {
        prompt = "TRACK AWAY — HOLD S, THEN PULL";
      } else prompt = coarse ? "TAP PULL" : "SPACE PULLS";
    } else if (phase === "malfunction") {
      prompt = "X CUT AWAY · THEN R RESERVE";
    } else if (phase === "deploying") {
      prompt = mal === "none" ? "OPENING" : "WAITING ON A BAD CANOPY";
    } else if (phase === "canopy") {
      const facingLake = -Math.sin(heading) > 0.55;
      const dist = Math.hypot(DZ_X - pos.x, DZ_Z - pos.z);
      const agl = pos.y - floorY;
      // Close over a marked roof, it is the target.
      const pad = padBelow();
      const padAbove = pad ? pos.y - pad.y : Infinity;
      const onPad = pad !== null && Math.hypot(pad.x - pos.x, pad.z - pos.z) < 220 && padAbove < 260;
      if (onPad && padAbove < 160 && !facingLake) prompt = "FACE THE LAKE — LAND INTO THE WIND";
      else if (onPad && padAbove < 30) prompt = "FLARE — HOLD S";
      else if (onPad) prompt = `ON FINAL · ${pad.name.toUpperCase()}`;
      else if (agl < 260 && !facingLake) prompt = "FACE THE LAKE — LAND INTO THE WIND";
      else if (agl < 40) prompt = "FLARE — HOLD S";
      else if (mode === "base") prompt = "FLY THE ARROW TO OPEN GROUND";
      else if (dist > 90) prompt = "FLY THE ARROW TO THE BEACH";
      else prompt = "ON FINAL";
    }

    let spot = "";
    spotShort = "";
    if (phase === "cabin" || phase === "menu") {
      const onLine = Math.abs(plane.position.x - RUN_X) < 90 && planeVel.z > 0.5 * PLANE_MPS * 0.5;
      const secs = Math.max(0, Math.round((DZ_Z - GREEN_HALF - plane.position.z) / PLANE_MPS));
      if (green) spot = spotShort = "GO";
      else if (!onLine) spot = spotShort = "GO-AROUND";
      else if (plane.position.z < DZ_Z - GREEN_HALF) {
        spot = `GREEN IN ${secs}s`;
        spotShort = `${secs}s`;
      } else if (plane.position.z > DZ_Z + GREEN_HALF) {
        spot = "PAST THE SPOT";
        spotShort = "PAST";
      } else spot = spotShort = "ON THE SPOT";
    }

    const yaw =
      phase === "canopy" || phase === "down"
        ? heading
        : phase === "cabin" || phase === "menu"
          ? planeYaw + localYaw
          : phase === "aboard"
            ? rideYaw + localYaw
            : phase === "roof"
              ? localYaw
              : bodyYaw;
    // The beach on a skydive; off a building, the nearest open ground.
    if (mode === "base") nearestOpen(pos.x, pos.z, lzPos);
    else lzPos.set(DZ_X, 0, DZ_Z);
    const dx = lzPos.x - pos.x;
    const dz = lzPos.z - pos.z;
    const want = Math.atan2(-dx, -dz);
    const faceYaw =
      phase === "roof" ? localYaw : phase === "aboard" ? rideYaw + localYaw : phase === "freefall" ? bodyYaw : heading;
    const rel = Math.atan2(Math.sin(want - faceYaw), Math.cos(want - faceYaw));

    camera.updateMatrixWorld();
    _v3.set(1.15, 1.25, 0.95);
    plane.localToWorld(_v3);
    const doorWorld = _v3.clone();
    camera.getWorldDirection(_v2);
    const toDoor = _v1.copy(doorWorld).sub(camera.position);
    const facing = _v2.dot(toDoor) > 0;
    const projected = doorWorld.project(camera);
    hud.phase = phase;
    hud.mode = mode;
    hud.suit = suit;
    hud.altitudeFt = altFt;
    hud.fallMph = Math.max(0, -vel.y) * MPH_PER_MPS;
    hud.groundMph =
      phase === "cabin" || phase === "menu" ? planeVel.length() * MPH_PER_MPS : Math.hypot(vel.x, vel.z) * MPH_PER_MPS;
    hud.compassDeg = ((THREE.MathUtils.radToDeg(-yaw) % 360) + 360) % 360;
    hud.banner = banner;
    hud.bannerLevel = bannerLevel;
    hud.pose = poseName(inputForward);
    hud.green = green;
    hud.inDoor = inDoor;
    hud.prompt = prompt;
    hud.spot = spot;
    hud.doorVisible = phase === "cabin" && !inDoor;
    hud.doorU = facing ? clamp(projected.x * 0.5 + 0.5, 0.06, 0.94) : projected.x < 0 ? 0.06 : 0.94;
    hud.doorV = facing ? clamp(-projected.y * 0.5 + 0.5, 0.12, 0.82) : 0.2;
    hud.baseVisible = false;
    // A ring on screen around a target: the base to dock on, or a marked roof under canopy.
    const marker = (at: THREE.Vector3, label: string) => {
      const ahead = _v2.dot(_v1.copy(at).sub(camera.position)) > 0;
      at.project(camera);
      if (!ahead) at.multiplyScalar(-1);
      hud.baseVisible = true;
      const edge = !ahead || Math.abs(at.x) > 1 || Math.abs(at.y) > 1;
      if (edge) {
        // Off screen or behind: pin it to the edge on the side to turn toward.
        const k = 1 / Math.max(Math.abs(at.x), Math.abs(at.y), 1e-3);
        at.x *= k;
        at.y *= k;
      }
      hud.baseU = clamp(at.x * 0.5 + 0.5, 0.06, 0.94);
      hud.baseV = clamp(-at.y * 0.5 + 0.5, 0.1, 0.86);
      hud.baseLabel = label;
    };
    const ring = phase === "freefall" ? course.next() : null;
    if (ring) {
      const dist = ring.c.distanceTo(camera.position);
      // The marker's circle sits in the middle of the hole: aim there.
      marker(_base.copy(ring.c), `${wing ? "GATE" : "RING"} ${course.index() + 1} · ${Math.round(dist)} m`);
    } else if (phase === "freefall" && formation.active() && !docked) {
      formation.center(_base);
      const dist = _base.distanceTo(camera.position);
      if (dist > 2.6) marker(_base, `BASE ${Math.round(dist)} m`);
    } else if (phase === "canopy") {
      const pad = padBelow();
      const d = pad ? Math.hypot(pad.x - pos.x, pad.z - pos.z) : 0;
      if (pad && d > 18) marker(_base.set(pad.x, pad.y, pad.z), `${pad.name.toUpperCase()} ${Math.round(d)} m`);
    }
    hud.dzVisible =
      phase === "freefall" ||
      phase === "canopy" ||
      phase === "deploying" ||
      phase === "malfunction" ||
      phase === "roof" ||
      phase === "aboard";
    hud.dzRel = THREE.MathUtils.radToDeg(rel);
    hud.dzDist = Math.hypot(dx, dz);
    hud.dzLabel = mode === "base" ? "LZ" : "DZ";
    hud.outcome = outcome;
    hud.replay = director
      ? {
          shot: director.shot().title,
          speed: director.speed(),
          progress: clamp((director.time() - director.start) / Math.max(1, director.end - director.start), 0, 1),
          // From the eyes: aboard a ride the physics point stays where you boarded.
          altFt: Math.max(0, shown[PLAYER.at.eye + 1]! - EYE_UP) * FT_PER_M,
        }
      : null;
    hud.canopy = flying;
    hud.needsLook =
      !coarse &&
      phase !== "menu" &&
      document.pointerLockElement !== canvas;
    if (tape.current && phase !== "menu") drawTape(tape.current, altFt, DECK[mode]);
    onFrame(hud);
  }

  /** The sky, haze and fog follow the camera. */
  function skyFollow() {
    sky.position.copy(camera.position);
    const h = camera.position.y;
    const t = clamp(h / 4500, 0, 1);
    fog.near = THREE.MathUtils.lerp(500, 2600, t);
    fog.far = THREE.MathUtils.lerp(16000, 36000, Math.sqrt(t));
    waterUniforms.uFogNear.value = fog.near;
    waterUniforms.uFogFar.value = fog.far;
    atmo.setViewHeight(h);
    atmo.update(simTime);
  }

  function frameCamera() {
    skyFollow();
    if (phase === "menu") {
      // Title shot: drifting over the harbor with downtown ahead.
      camera.position.set(
        MENU_CAM.x + Math.sin(simTime * 0.031) * 90,
        MENU_CAM.y + Math.sin(simTime * 0.047) * 12,
        MENU_CAM.z + Math.sin(simTime * 0.023) * 220,
      );
      camera.lookAt(MENU_CITY);
      // About 76 degrees across whatever the screen's shape, with the skyline right of the menu.
      camera.fov = clamp(THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(0.66) / camera.aspect)), 30, 75);
      camera.updateProjectionMatrix();
      return;
    }
    if (phase === "cabin") {
      const bob = Math.sin(walk) * 0.018 * (Math.abs(Math.sin(walk)) > 0 ? 1 : 0);
      _v3.set(riderX, 1.5 + bob, riderZ);
      if (inDoor && !reduce) {
        _v3.y += Math.sin(simTime * 47) * 0.01;
        _v3.x += Math.sin(simTime * 33) * 0.008;
      }
      plane.localToWorld(_v3);
      camera.position.copy(_v3);
      _e.set(localPitch, localYaw, 0, "YXZ");
      _q.setFromEuler(_e);
      camera.quaternion.copy(plane.quaternion).multiply(_q);
      return;
    }
    if (phase === "aboard") {
      const v = ride === "heli" ? heli.group : balloon.group;
      if (ride === "heli") {
        _v3.copy(HELI_SEAT);
        // The airframe hums with the rotor.
        if (!reduce) {
          _v3.y += Math.sin(simTime * 43) * 0.005;
          _v3.z += Math.sin(simTime * 31) * 0.004;
        }
      } else _v3.set(riderX, STAND_EYE + (reduce ? 0 : Math.sin(walk) * 0.012), riderZ);
      v.localToWorld(_v3);
      camera.position.copy(_v3);
      _e.set(localPitch, localYaw, 0, "YXZ");
      _q.setFromEuler(_e);
      camera.quaternion.copy(v.quaternion).multiply(_q);
      if (Math.abs(camera.fov - 72) > 0.25) {
        camera.fov += (72 - camera.fov) * 0.08;
        camera.updateProjectionMatrix();
      }
      return;
    }
    if (phase === "roof") {
      const bob = reduce ? 0 : Math.sin(walk) * 0.025;
      camera.position.set(pos.x, pos.y + STAND_EYE + bob, pos.z);
      _e.set(localPitch, localYaw, 0, "YXZ");
      camera.quaternion.setFromEuler(_e);
      if (Math.abs(camera.fov - 72) > 0.25) {
        camera.fov += (72 - camera.fov) * 0.08;
        camera.updateProjectionMatrix();
      }
      return;
    }
    const air = Math.hypot(vel.x, vel.y, vel.z);
    camera.position.copy(pos);
    camera.position.y += phase === "canopy" || phase === "down" ? EYE_UP : 0.32;
    if (!reduce && phase !== "down" && phase !== "impact") {
      const s = phase === "canopy" ? 0.012 : Math.min(air / 80, 1) * 0.045;
      camera.position.x += Math.sin(simTime * 23) * s;
      camera.position.y += Math.cos(simTime * 19) * s * 0.5;
    }
    if (phase === "canopy" || phase === "down") {
      _e.set(-0.22 + lookOffPitch, heading + lookOffYaw, bank * 0.65, "YXZ");
    } else {
      _e.set(bodyPitch + tumbleP, bodyYaw, bank + tumbleR, "YXZ");
    }
    if (shock > 0.01 && !reduce) {
      _e.x -= shock * shock * 0.32;
      _e.z += Math.sin(simTime * 29) * shock * 0.05;
      camera.position.y += Math.sin(simTime * 41) * shock * 0.07;
    }
    camera.quaternion.setFromEuler(_e);
    let targetFov = phase === "freefall" || phase === "malfunction" ? 74 + Math.min(air, 80) * 0.1 : 72;
    // A flying suit gets a wider view, for the speed and to keep the wings in sight.
    if (wing && phase === "freefall") targetFov += 6 * wingFill(wing);
    if (Math.abs(camera.fov - targetFov) > 0.25) {
      camera.fov += (targetFov - camera.fov) * 0.08;
      camera.updateProjectionMatrix();
    }
  }

  const bodyFrame = new THREE.Matrix4();
  const shiftM = new THREE.Matrix4();
  const bodyQ = new THREE.Quaternion();
  const bodyE = new THREE.Euler();
  const bodyInv = new THREE.Matrix4();
  const one = new THREE.Vector3(1, 1, 1);
  const handL = new THREE.Vector3();
  const handR = new THREE.Vector3();
  const bodyPose = {
    mode: "hidden" as BodyMode,
    forward: 0,
    turn: 0,
    leftHand: null as THREE.Vector3 | null,
    rightHand: null as THREE.Vector3 | null,
    gesture: null as Gesture | null,
    gestureT: 0,
    walk: 0,
    flare: 0,
    air: 0,
    altFt: 0,
    time: 0,
    reaching: false,
    wing: 0,
  };

  function poseBody(dt: number) {
    const p = bodyPose;
    p.leftHand = null;
    p.rightHand = null;
    p.forward = lastInput?.forward ?? 0;
    p.turn = lastInput?.turn ?? 0;
    p.walk = walk;
    p.time = simTime;
    p.air = Math.hypot(vel.x, vel.y, vel.z);
    p.altFt = (phase === "cabin" ? plane.position.y : Math.max(0, pos.y)) * FT_PER_M;
    p.flare = clamp((30 - (pos.y - floorY)) / 25, 0, 1);
    p.gestureT = simTime - gestureStart;
    p.gesture = gesture && p.gestureT < 1.2 ? gesture : null;
    p.reaching = phase === "deploying" || (phase === "malfunction" && mal === "twist");
    p.wing = wing && phase === "freefall" ? wingFill(wing) : 0;
    if (phase === "menu" || phase === "impact") {
      p.mode = "hidden";
    } else if (phase === "cabin") {
      p.mode = "cabin";
      _v3.set(riderX, 1.5, riderZ);
      plane.localToWorld(_v3);
      bodyE.set(0, localYaw, 0, "YXZ");
      bodyQ.setFromEuler(bodyE).premultiply(plane.quaternion);
      bodyFrame.compose(_v3, bodyQ, one);
      if (inDoor) {
        // Grab the door bar either side of the body while it is within reach. Once it lifts on
        // green, the hands follow it up to the frame above the door.
        bodyInv.copy(bodyFrame).invert();
        const zs = [clamp(riderZ - 0.32, 0.3, 1.6), clamp(riderZ + 0.32, 0.3, 1.6)];
        const barY = Math.min(bar.position.y, 1.5);
        const pts = zs.map((z) => plane.localToWorld(new THREE.Vector3(1.22, barY, z)).applyMatrix4(bodyInv));
        const [a, b] = pts as [THREE.Vector3, THREE.Vector3];
        const left = a.x < b.x ? a : b;
        const right = a.x < b.x ? b : a;
        if (left.z < 0.3 && right.z < 0.3 && left.length() < 0.85 && right.length() < 0.85) {
          p.leftHand = handL.copy(left);
          p.rightHand = handR.copy(right);
        }
      }
    } else if (phase === "aboard") {
      const v = ride === "heli" ? heli.group : balloon.group;
      if (ride === "heli") {
        // Sitting in the door, legs out on the skid; only the head turns.
        p.mode = "perch";
        _v3.copy(HELI_SEAT);
        bodyE.set(0, HELI_SEAT_YAW, 0, "YXZ");
      } else {
        p.mode = "cabin";
        _v3.set(riderX, STAND_EYE, riderZ);
        bodyE.set(0, localYaw, 0, "YXZ");
      }
      v.localToWorld(_v3);
      bodyQ.setFromEuler(bodyE).premultiply(v.quaternion);
      bodyFrame.compose(_v3, bodyQ, one);
    } else if (phase === "roof") {
      p.mode = "cabin";
      _v3.set(pos.x, pos.y + STAND_EYE, pos.z);
      bodyE.set(0, localYaw, 0, "YXZ");
      bodyQ.setFromEuler(bodyE);
      bodyFrame.compose(_v3, bodyQ, one);
    } else if (phase === "canopy" || phase === "down") {
      p.mode = phase;
      _v3.copy(pos);
      _v3.y += EYE_UP;
      bodyE.set(0, heading, phase === "canopy" ? bank * 0.45 : 0, "XYZ");
      bodyQ.setFromEuler(bodyE);
      bodyFrame.compose(_v3, bodyQ, one);
      if (phase === "canopy") {
        p.leftHand = togglePosition(handL, -1, brakeL);
        p.rightHand = togglePosition(handR, 1, brakeR);
        handL.y -= CANOPY_EYE_Y;
        handR.y -= CANOPY_EYE_Y;
      }
    } else {
      p.mode = "freefall";
      if (wing && phase === "freefall") {
        // The body flies the suit's line, nose a little above where the eyes look; looking
        // around turns only the head, so a glance to the side shows the wing.
        bodyE.set(bodyPitch - lookOffPitch + 0.2 * p.wing, bodyYaw - lookOffYaw, bank, "YXZ");
        bodyQ.setFromEuler(bodyE);
        bodyFrame.compose(camera.position, bodyQ, one);
        // The view rides a little behind the head, like a helmet camera, so the spread arms
        // show in the corners and a look down or to the side takes in the whole suit.
        bodyFrame.multiply(shiftM.makeTranslation(0, 0, -0.25 * p.wing));
      } else bodyFrame.compose(camera.position, camera.quaternion, one);
      if (docked && phase === "freefall" && !p.gesture) {
        // Hold the neighbors' hands either side of the slot.
        bodyInv.copy(bodyFrame).invert();
        formation.playerGrips(handL, handR);
        p.leftHand = handL.applyMatrix4(bodyInv);
        p.rightHand = handR.applyMatrix4(bodyInv);
      }
    }
    body.update(bodyFrame, p, dt);
  }

  const airVel = new THREE.Vector3();

  /** Your shadow and the other jumpers' on the ground, once you're low enough to see them. */
  function castShadows() {
    casters.length = 0;
    const out =
      phase !== "menu" && phase !== "cabin" && phase !== "aboard" && phase !== "roof" && phase !== "impact";
    if (out) casters.push({ feet: pos, wing: canopy.visible ? canopy : null });
    formation.casters(casters);
    shadows.update(casters, camera.position);
  }

  /** You as the replay will draw you, from outside: the eye frame and pose, into tape frame f. */
  function outside(f: Float32Array) {
    const A = PLAYER.at;
    let shape: BodyMode = "freefall";
    let lean = 1;
    let track = 0;
    let suitAmt = 0;
    let reach = false;
    let flare = 0;
    const eye = _v3;
    if (phase === "cabin") {
      shape = "cabin";
      lean = 0;
      plane.localToWorld(eye.set(riderX, 1.5, riderZ));
      _q.setFromEuler(_e.set(0, localYaw, 0, "YXZ")).premultiply(plane.quaternion);
    } else if (phase === "aboard") {
      const v = ride === "heli" ? heli.group : balloon.group;
      lean = 0;
      if (ride === "heli") {
        shape = "perch";
        eye.copy(HELI_SEAT);
        _e.set(0, HELI_SEAT_YAW, 0, "YXZ");
      } else {
        shape = "cabin";
        eye.set(riderX, STAND_EYE, riderZ);
        _e.set(0, localYaw, 0, "YXZ");
      }
      v.localToWorld(eye);
      _q.setFromEuler(_e).premultiply(v.quaternion);
    } else if (phase === "roof") {
      shape = "cabin";
      lean = 0;
      eye.set(pos.x, pos.y + STAND_EYE, pos.z);
      _q.setFromEuler(_e.set(0, localYaw, 0, "YXZ"));
    } else if (phase === "impact") {
      shape = "hidden";
      eye.copy(pos);
      _q.identity();
    } else if (phase === "canopy" || phase === "down" || (phase === "malfunction" && mal === "twist")) {
      // In the harness, or on your feet.
      shape = phase === "down" ? "down" : "canopy";
      lean = 0;
      reach = phase === "malfunction";
      eye.copy(pos).y += EYE_UP;
      _q.setFromEuler(_e.set(0, heading, phase === "canopy" ? bank * 0.45 : 0, "YXZ"));
      if (phase === "canopy") flare = clamp((30 - (pos.y - floorY)) / 25, 0, 1);
    } else if (phase === "deploying" && mal === "none") {
      // Swinging up under the opening canopy, as the formation's jumpers do.
      const u = smooth(clamp(openT / openDur(), 0, 1));
      shape = openT > 0.9 ? "canopy" : "freefall";
      lean = 1 - u;
      reach = true;
      eye.copy(pos).y += THREE.MathUtils.lerp(0.32, EYE_UP, u);
      _q.setFromEuler(_e.set(-0.18 * (1 - u), heading, bank * 0.45 * u, "YXZ"));
    } else if (mal !== "none") {
      // Under a streamer, or a twist still winding up: feet first, reaching for the risers.
      lean = 0.35;
      reach = true;
      eye.copy(pos).y += 0.9;
      _q.setFromEuler(_e.set(-0.1, bodyYaw, bank, "YXZ"));
    } else {
      // Off the exit you settle from how you left, crouched in a door or standing on a roof,
      // to flat in the air. Off the helicopter or the balloon you roll straight off head first.
      const settle = smooth(clamp((simTime - exitTime) / (mode === "base" ? 1.2 : 0.7), 0, 1));
      const hop = ride === "heli" || ride === "balloon";
      const from = ride === "plane" ? 1.45 : ride === "heli" ? 0.67 : ride === "balloon" ? 0.6 : STAND_EYE;
      eye.copy(pos).y += THREE.MathUtils.lerp(from, 0.32, settle);
      lean = hop ? 1 : settle;
      if (wing) {
        // A wingsuit lies along the line it flies, nose a little up into the air.
        suitAmt = wingFill(wing);
        const line = pathPitch(vel, WIND_X, WIND_Z) * 0.85 - 0.05 - wing.pitch * 0.12;
        _q.setFromEuler(_e.set(THREE.MathUtils.lerp(-0.18, line, suitAmt), wing.yaw, wing.bank * 0.85, "YXZ"));
      } else {
        // Belly to earth; looking down dives you head first, and fast across the sky is a track.
        track = clamp((Math.hypot(vel.x - WIND_X, vel.z - WIND_Z) - 10) / 18, 0, 1);
        const pitch = -0.18 + Math.min(0, bodyPitch) * 0.75 - 0.15 * track + tumbleP;
        _q.setFromEuler(_e.set(pitch, bodyYaw, bank * 0.6 + tumbleR, "YXZ"));
      }
    }
    f[A.mode] = MODES.indexOf(shape);
    f.set([eye.x, eye.y, eye.z], A.eye);
    f.set([_q.x, _q.y, _q.z, _q.w], A.q);
    f[A.lean] = lean;
    f[A.track] = track;
    f[A.wing] = suitAmt;
    f[A.reach] = reach ? 1 : 0;
    f[A.gesture] = GESTURES.indexOf(gesture && simTime - gestureStart < 1.2 ? gesture : null);
    f[A.gestureT] = simTime - gestureStart;
    f[A.forward] = lastInput?.forward ?? 0;
    f[A.turn] = lastInput?.turn ?? 0;
    f[A.flare] = flare;
    f[A.air] = vel.length();
    f[A.walk] = walk;
    f[A.brakeL] = brakeL;
    f[A.brakeR] = brakeR;
  }

  /** Puts the jump on tape, REC_HZ times a second, from the walk to the door until just after it ends. */
  function recordTick() {
    if (phase === "menu" || simTime > recUntil) return;
    if (recAt >= 0 && simTime - recAt < 1 / REC_HZ - 1e-6) return;
    recAt = simTime;
    const A = PLAYER.at;
    const f = new Float32Array(FRAME_SIZE);
    f[A.t] = simTime - rec.t0;
    f[A.phase] = PHASES.indexOf(phase);
    outside(f);
    f[A.canopy] = canopy.visible ? canopyU : 0;
    f.set([canopy.position.x, canopy.position.y, canopy.position.z], A.canopyPos);
    const cq = canopy.quaternion;
    f.set([cq.x, cq.y, cq.z, cq.w], A.canopyQ);
    f[A.reserve] = flying === "reserve" || deployingReserve ? 1 : 0;
    f[A.streamer] = streamer.visible ? 1 : 0;
    f.set([pos.x, pos.y, pos.z], A.pos);
    f.set([vel.x, vel.y, vel.z], A.vel);
    f[A.ride] = RIDES.indexOf(ride);
    const r = ride === "heli" ? heli.group : ride === "balloon" ? balloon.group : ride === "plane" ? plane : null;
    if (r) {
      f.set([r.position.x, r.position.y, r.position.z], A.ridePos);
      f.set([r.quaternion.x, r.quaternion.y, r.quaternion.z, r.quaternion.w], A.rideQ);
      f[A.rideOn] = r.visible ? 1 : 0;
    } else f[A.rideQ + 3] = 1;
    f[A.burn] = burn;
    fleet.forEach((b, i) => {
      const g = b.b.group;
      f.set([g.position.x, g.position.y, g.position.z, g.rotation.y], A.fleet + i * 4);
    });
    formation.record(f);
    rec.push(f, phase === "cabin" || phase === "aboard" || phase === "roof");
  }

  const actorFrame = new THREE.Matrix4();
  const actorFeet = new THREE.Vector3();
  const actorL = new THREE.Vector3();
  const actorR = new THREE.Vector3();
  const actorPose: BodyPose = {
    mode: "hidden",
    forward: 0,
    turn: 0,
    leftHand: null,
    rightHand: null,
    gesture: null,
    gestureT: 0,
    walk: 0,
    flare: 0,
    air: 0,
    altFt: 0,
    time: 0,
    reaching: false,
    lean: 0,
    trackAmt: 0,
    wing: 0,
  };
  /** Camera shots that ride along with you, where the air should rush past. */
  const RIDE_ALONG = new Set(["chase", "flyer", "orbit", "below", "formation", "ringsDown", "wingChase", "wingFront"]);

  /** Draws the jump as tape frame f has it: you, your canopy, the ride you left and the formation. */
  function showFrame(f: Float32Array, dt: number) {
    const A = PLAYER.at;
    const t = rec.t0 + f[A.t]!;
    const was = shownPhase;
    shownPhase = PHASES[f[A.phase]!] ?? "menu";
    const p = actorPose;
    p.mode = MODES[f[A.mode]!] ?? "hidden";
    p.lean = f[A.lean]!;
    p.trackAmt = f[A.track]!;
    p.wing = f[A.wing]!;
    p.reaching = f[A.reach] === 1;
    p.gesture = GESTURES[f[A.gesture]!] ?? null;
    p.gestureT = f[A.gestureT]!;
    p.forward = f[A.forward]!;
    p.turn = f[A.turn]!;
    p.flare = f[A.flare]!;
    p.air = f[A.air]!;
    p.walk = f[A.walk]!;
    p.altFt = Math.max(0, f[A.pos + 1]!) * FT_PER_M;
    p.time = t;
    p.leftHand = null;
    p.rightHand = null;
    if (p.mode === "canopy" && !p.reaching) {
      p.leftHand = togglePosition(actorL, -1, f[A.brakeL]!);
      p.rightHand = togglePosition(actorR, 1, f[A.brakeR]!);
      actorL.y -= CANOPY_EYE_Y;
      actorR.y -= CANOPY_EYE_Y;
    }
    actorFrame.compose(_v3.fromArray(f, A.eye), _q.fromArray(f, A.q), one);
    actor.update(actorFrame, p, dt);
    body.group.visible = false;

    // Your canopy, which surges on past you once you land and settles onto the ground ahead.
    let u = f[A.canopy]!;
    let fold = 0;
    if (shownPhase === "down" && landT >= 0) {
      fold = smooth(clamp((f[A.t]! - landT) / COLLAPSE_S, 0, 1));
      u = 1 - fold * 0.8;
    }
    canopy.visible = u > 0.02;
    if (canopy.visible) {
      canopy.position.fromArray(f, A.canopyPos);
      canopy.quaternion.fromArray(f, A.canopyQ);
      settleCanopy(canopy, fold);
      canopyRig.setReserve(f[A.reserve] === 1);
      canopyRig.update(u, f[A.brakeL]!, f[A.brakeR]!);
    }
    if ((shownPhase === "deploying" || shownPhase === "canopy") && was !== shownPhase && was !== "menu") audio.fabric();
    streamer.visible = f[A.streamer] === 1;
    if (streamer.visible) waveStreamer(actorFeet.fromArray(f, A.pos), t);

    const r = RIDES[f[A.ride]!] ?? "roof";
    const on = f[A.rideOn] === 1;
    if (r === "plane") {
      plane.position.fromArray(f, A.ridePos);
      plane.quaternion.fromArray(f, A.rideQ);
    } else if (r === "heli") {
      heli.group.visible = on;
      heli.group.position.fromArray(f, A.ridePos);
      heli.group.quaternion.fromArray(f, A.rideQ);
      heli.group.updateMatrixWorld();
      if (on) heli.update(dt, t, false);
    } else if (r === "balloon") {
      balloon.group.visible = true;
      balloon.group.position.fromArray(f, A.ridePos);
      balloon.group.quaternion.fromArray(f, A.rideQ);
      balloon.group.updateMatrixWorld();
      balloon.update(dt, t, f[A.burn]!);
      fleet.forEach((b, i) => {
        b.b.group.visible = true;
        b.b.group.position.fromArray(f, A.fleet + i * 4);
        b.b.group.rotation.y = f[A.fleet + i * 4 + 3]!;
        b.b.update(dt, t, b.burn);
      });
    }

    formation.play(f);
    formation.draw(dt, t);
    course.rewind(t);
    course.update(t, camera.position);

    casters.length = 0;
    const aloft = p.mode !== "hidden" && shownPhase !== "cabin" && shownPhase !== "aboard" && shownPhase !== "roof";
    if (aloft) casters.push({ feet: actorFeet.fromArray(f, A.pos), wing: canopy.visible ? canopy : null });
    formation.casters(casters);
    shadows.update(casters, camera.position);

    // The air rushes past a camera flying with you; a camera standing still hears it go by.
    cloudDensity = cloudField.update(camera, fog.near, fog.far);
    const falling = shownPhase === "freefall" || shownPhase === "deploying" || shownPhase === "malfunction";
    const along = RIDE_ALONG.has(director?.shot().kind ?? "");
    airVel.set(f[A.vel]! - WIND_X, f[A.vel + 1]!, f[A.vel + 2]! - WIND_Z);
    const rush = falling ? clamp(airVel.length() / 60, 0, 1) : 0;
    streaks.update(camera.position, airVel, reduce || !along ? 0 : rush * 0.45);
    audio.setMuted(bridge.muted);
    const near = (at: THREE.Vector3, range: number) => clamp(1 - at.distanceTo(camera.position) / range, 0, 1) ** 2;
    audio.vehicle(
      heli.group.visible ? 0.55 * near(heli.group.position, 700) : 0,
      balloon.group.visible ? f[A.burn]! * near(balloon.group.position, 350) : 0,
    );
    const close = along ? 1 : near(actorFeet.fromArray(f, A.pos), 160);
    if (falling) audio.update(rush * 0.32 * close + 0.02, 0, f[A.air]!);
    else if (shownPhase === "canopy") audio.update(0.045, 0, 12);
    else audio.update(0.03, 0, 8);
  }

  /** Plays the next frame of the replay; false once it has run out. */
  function playReplay(dt: number) {
    if (!director || !director.advance(dt)) return false;
    rec.sample(director.time(), shown);
    director.aim(shown, camera, dt);
    skyFollow();
    showFrame(shown, dt);
    return true;
  }

  function startReplay() {
    if (!outcome || director) return;
    director = createDirector(rec, { clear: clearCam, rings: ringsOn });
    if (!director) return;
    formation.record(liveCrew);
    const down = rec.frames.find((fr) => PHASES[fr[PLAYER.at.phase]!] === "down");
    landT = down ? down[PLAYER.at.t]! : -1;
    shownPhase = "menu";
    if (document.pointerLockElement) void document.exitPointerLock();
  }

  /** Back from the replay to where the jump really is: on the ground, with the debrief. */
  function stopReplay() {
    if (!director) return;
    director = null;
    canopy.scale.setScalar(1);
    formation.play(liveCrew);
    course.rewind(Infinity);
    actor.group.visible = false;
    canopy.visible = false;
    streamer.visible = false;
    moveRides(0);
  }

  /** Keeps a replay camera out of the buildings and above the ground: in toward `subject` until clear. */
  function clearCam(cam: THREE.Vector3, subject: THREE.Vector3) {
    for (let i = 0; i < 14 && solids.blocked(cam.x, cam.y - 0.6, cam.z, 0.6, 1.2); i++) cam.lerp(subject, 0.2);
    const floor = solids.top(cam.x, cam.z, cam.y + 1)?.y1 ?? 0;
    cam.y = Math.max(cam.y, floor + 0.8);
  }

  // Clouds and the air rushing past: how deep in cloud the eye is, the whiteout veil, and
  // streaks that scale with airspeed (and thicken inside a cloud).
  function airFx() {
    cloudDensity = cloudField.update(camera, fog.near, fog.far);
    const falling = phase === "freefall" || phase === "deploying" || phase === "malfunction";
    const aloft = falling || phase === "canopy";
    if (aloft && cloudDensity > 0.6 && !cloudLogged) {
      cloudLogged = true;
      pushLog(
        `Through a cloud at ${Math.round(pos.y * FT_PER_M).toLocaleString("en-US")} ft · real jumps keep clear of clouds`,
      );
    }
    airVel.set(vel.x - WIND_X, vel.y, vel.z - WIND_Z);
    let amount = 0;
    if (falling) amount = clamp(airVel.length() / 60, 0, 1) * 0.55 + cloudDensity * 0.45;
    else if (phase === "canopy") amount = 0.12 + cloudDensity * 0.6;
    streaks.update(camera.position, airVel, reduce ? 0 : amount);
  }

  function audioMix() {
    audio.setMuted(bridge.muted);
    // The rotor and the burner, fading with distance once you have left them behind.
    const near = (at: THREE.Vector3, range: number) => clamp(1 - at.distanceTo(camera.position) / range, 0, 1) ** 2;
    const live = phase !== "impact";
    audio.vehicle(
      live && heli.group.visible ? 0.55 * near(heli.group.position, 700) : 0,
      live && balloon.group.visible ? burn * near(balloon.group.position, 350) : 0,
    );
    const air = Math.hypot(vel.x, vel.y, vel.z);
    if (phase === "impact") audio.update(0, 0, 0);
    else if (phase === "menu") audio.update(0.02, 0.045, 20);
    else if (phase === "cabin") audio.update(inDoor ? 0.24 : 0.035, inDoor ? 0.03 : 0.11, inDoor ? 40 : 10);
    // A steady breeze across the top of a tower.
    else if (phase === "roof") audio.update(0.08, 0, 9);
    // The rotor wash buffets the open door; the balloon is the quietest place in the sky.
    else if (phase === "aboard") audio.update(ride === "heli" ? 0.16 : 0.012, 0, ride === "heli" ? 18 : 4);
    else if (phase === "canopy" || phase === "down") audio.update(0.045, 0, 12);
    else audio.update(clamp(air / 85, 0, 1) * 0.36, 0, air);
  }

  let acc = 0;
  let lastInput: ReturnType<typeof sample> | null = null;

  function loop() {
    timer.update();
    const frameDt = Math.min(timer.getDelta(), 0.05);
    const command = bridge.command;
    bridge.command = null;
    // Anything but the replay's own buttons stops a replay first.
    if (director && command && command !== "replayNext" && command !== "replayEnd") stopReplay();
    // A new course from the menu; jumping again flies the same one.
    if (command === "start" && phase === "menu") {
      courseSeed = (Math.random() * 2 ** 31) | 0;
      begin();
    }
    else if (command === "again") backToMenu();
    else if (command === "retry") begin();
    else if (command === "base") baseFromHere();
    else if (command === "replay") startReplay();
    else if (command === "replayNext" && director && !director.next()) stopReplay();
    else if (command === "replayEnd") stopReplay();
    const input = sample();
    // In a replay Space skips to the next shot and Escape stops it.
    if (director && input.jumpEdge && !director.next()) stopReplay();
    if (director && input.endEdge) stopReplay();
    if (lastInput) {
      // A frame too short for a physics step must not swallow a key press: carry it over.
      input.jumpEdge ||= lastInput.jumpEdge;
      input.pullEdge ||= lastInput.pullEdge;
      input.cutEdge ||= lastInput.cutEdge;
      input.reserveEdge ||= lastInput.reserveEdge;
    }
    lastInput = input;
    acc += frameDt;
    let guard = 0;
    while (acc >= 1 / 60 && guard < 5) {
      // During a replay the world goes on living, but you are on tape.
      if (lastInput) step(1 / 60, director ? null : lastInput);
      if (!director) recordTick();
      if (lastInput) {
        lastInput.jumpEdge = false;
        lastInput.pullEdge = false;
        lastInput.cutEdge = false;
        lastInput.reserveEdge = false;
      }
      acc -= 1 / 60;
      guard++;
    }
    if (director && !playReplay(frameDt)) stopReplay();
    if (!director) {
      frameCamera();
      airFx();
      poseBody(frameDt);
      formation.draw(frameDt, simTime);
      castShadows();
      audioMix();
    }
    publish(lastInput?.forward ?? 0);
    cabin.update(frameDt, {
      aboard: director ? shownPhase === "cabin" : phase === "menu" || phase === "cabin",
      green,
      spot: spotShort,
      time: simTime,
    });
    draw();
  }

  // The view spans 12 cm to 45 km, far more than one depth buffer can resolve: from altitude
  // the beach, grass and road strips fought over the same pixels and flickered. So the world
  // beyond SPLIT_M draws first with a near plane at SPLIT_M, then the depth buffer is cleared
  // and everything closer (your body, the cabin, the formation, the canopy) draws on top.
  const SPLIT_M = 40;
  function draw() {
    const near = camera.near;
    const far = camera.far;
    camera.near = SPLIT_M;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    // The sky dome pins itself to the far plane, so it would paint over the world here.
    const background = scene.background;
    scene.background = null;
    sky.visible = false;
    renderer.autoClear = false;
    renderer.clearDepth();
    camera.near = near;
    camera.far = SPLIT_M * 1.002;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    renderer.autoClear = true;
    scene.background = background;
    sky.visible = true;
    camera.far = far;
    camera.updateProjectionMatrix();
    post.render();
  }

  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    if (w < 2 || h < 2) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  function onKeyDown(e: KeyboardEvent) {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
    if (e.repeat) return;
    keys.add(e.code);
    eventEdges.add(e.code);
    audio.resume();
  }
  function onKeyUp(e: KeyboardEvent) {
    keys.delete(e.code);
  }
  function onBlur() {
    keys.clear();
    eventEdges.clear();
  }
  function onMouse(e: MouseEvent) {
    if (document.pointerLockElement !== canvas) return;
    lookDX += e.movementX;
    lookDY += e.movementY;
  }
  function onClick() {
    audio.resume();
    if (coarse || phase === "menu" || director) return;
    const opts = { unadjustedMovement: true } as PointerLockOptions;
    const ret = canvas.requestPointerLock(opts) as unknown as Promise<void> | void;
    if (ret && typeof (ret as Promise<void>).catch === "function") {
      void (ret as Promise<void>).catch(() => canvas.requestPointerLock());
    }
  }
  const touches = new Map<number, { x: number; y: number; look: boolean }>();
  function onTouchStart(e: TouchEvent) {
    audio.resume();
    const rect = canvas.getBoundingClientRect();
    for (const t of Array.from(e.changedTouches)) {
      const localX = t.clientX - rect.left;
      touches.set(t.identifier, { x: t.clientX, y: t.clientY, look: localX > rect.width * 0.38 });
    }
  }
  function onTouchMove(e: TouchEvent) {
    const rect = canvas.getBoundingClientRect();
    for (const t of Array.from(e.changedTouches)) {
      const prev = touches.get(t.identifier);
      if (!prev) continue;
      if (prev.look) {
        lookDX += t.clientX - prev.x;
        lookDY += t.clientY - prev.y;
        if (e.cancelable) e.preventDefault();
      }
      prev.x = t.clientX;
      prev.y = t.clientY;
      prev.look = t.clientX - rect.left > rect.width * 0.38 || prev.look;
    }
  }
  function onTouchEnd(e: TouchEvent) {
    for (const t of Array.from(e.changedTouches)) touches.delete(t.identifier);
  }

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  window.addEventListener("pointerdown", () => audio.resume());
  canvas.addEventListener("mousemove", onMouse);
  canvas.addEventListener("click", onClick);
  canvas.addEventListener("touchstart", onTouchStart, { passive: true });
  canvas.addEventListener("touchmove", onTouchMove, { passive: false });
  canvas.addEventListener("touchend", onTouchEnd);

  const controlsTest = {
    getYaw: () => (phase === "canopy" || phase === "down" ? heading : bodyYaw),
    getSpeed: () => Math.hypot(vel.x, vel.z),
    setKeys: (codes: string[]) => {
      qaKeys = new Set(codes);
    },
    setSteer: (v: number) => {
      steerOverride = v;
    },
    setPhase: (p: string) => forcePhase(p),
    getPhase: () => phase,
    getAltFt: () =>
      phase === "cabin" || phase === "menu" ? plane.position.y * FT_PER_M : Math.max(0, pos.y) * FT_PER_M,
    getWarning: () => hud.banner,
    inDoor: () => inDoor,
    getLocalX: () => riderX,
    isDocked: () => docked,
    getPos: () => [pos.x, pos.y, pos.z],
    getOutcome: () => outcome,
    getTumble: () => [tumbleP, tumbleR, stableS ?? -1],
    addLook: (dx: number, dy: number) => {
      lookDX += dx;
      lookDY += dy;
    },
  };
  window.__controlsTest = controlsTest;

  renderer.setAnimationLoop(loop);

  return () => {
    renderer.setAnimationLoop(null);
    timer.disconnect();
    ro.disconnect();
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", onBlur);
    canvas.removeEventListener("mousemove", onMouse);
    canvas.removeEventListener("click", onClick);
    canvas.removeEventListener("touchstart", onTouchStart);
    canvas.removeEventListener("touchmove", onTouchMove);
    canvas.removeEventListener("touchend", onTouchEnd);
    audio.dispose();
    atmo.dispose();
    canopyRig.dispose();
    cloudField.dispose();
    streaks.dispose();
    shadows.dispose();
    cabin.dispose();
    heli.dispose();
    balloon.dispose();
    fleet.forEach((f) => f.b.dispose());
    course.dispose();
    body.dispose();
    actor.dispose();
    formation.dispose();
    normalTex.dispose();
    if (window.__controlsTest === controlsTest) delete window.__controlsTest;
    const geos = new Set<THREE.BufferGeometry>();
    const mats = new Set<THREE.Material>();
    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) geos.add(mesh.geometry);
      const material = mesh.material;
      if (Array.isArray(material)) material.forEach((m) => mats.add(m));
      else if (material) mats.add(material);
    });
    geos.forEach((g) => g.dispose());
    mats.forEach((m) => {
      const maybe = m as THREE.MeshStandardMaterial;
      maybe.map?.dispose();
      maybe.emissiveMap?.dispose();
      maybe.alphaMap?.dispose();
      m.dispose();
    });
    post.dispose();
    renderer.dispose();
  };
}

function mulberry(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const tireMat = new THREE.MeshStandardMaterial({ color: "#1a1c1f", roughness: 0.88 });
const gearMat = new THREE.MeshStandardMaterial({ color: "#b7c2cb", roughness: 0.4, metalness: 0.45 });
const discMat = new THREE.MeshBasicMaterial({
  color: "#e7eef4",
  transparent: true,
  opacity: 0.22,
  side: THREE.DoubleSide,
  depthWrite: false,
});

function addWheel(parent: THREE.Object3D, x: number, y: number, z: number) {
  const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.16, 12), tireMat);
  tire.rotation.z = Math.PI / 2;
  tire.position.set(x, y, z);
  const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.045, 0.42, 5), gearMat);
  leg.position.set(x, y + 0.46, z);
  parent.add(tire, leg);
}

function propDisc() {
  return new THREE.Mesh(new THREE.CircleGeometry(0.78, 18), discMat);
}

function blade() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: "#22262b", roughness: 0.4 });
  for (let i = 0; i < 3; i++) {
    const a = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.07, 0.05), mat);
    a.rotation.z = (i / 3) * Math.PI * 2;
    g.add(a);
  }
  return g;
}

declare global {
  interface Window {
    __controlsTest?: {
      getYaw: () => number;
      getSpeed: () => number;
      setKeys: (codes: string[]) => void;
      setSteer?: (v: number) => void;
      setPhase?: (p: string) => void;
      getPhase?: () => string;
      getAltFt?: () => number;
      getWarning?: () => string;
      inDoor?: () => boolean;
      getLocalX?: () => number;
      isDocked?: () => boolean;
      getPos?: () => number[];
      getOutcome?: () => unknown;
      getTumble?: () => number[];
      addLook?: (dx: number, dy: number) => void;
    };
  }
}
