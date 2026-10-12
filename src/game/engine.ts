import * as THREE from "three";
import { createAudio } from "./audio";
import {
  DECISION_FT,
  DZ_X,
  DZ_Z,
  FT_PER_M,
  HARD_DECK_FT,
  MPH_PER_MPS,
  PLANE_MPS,
  PULL_NOW_FT,
  RUN_X,
  SHORE_X,
  WIND_X,
  WIND_Z,
} from "./constants";
import { loadSave, writeSave } from "./save";
import type { Bridge, Hud, Outcome, Phase } from "./types";
import { createCanopy } from "./canopy";
import { SUN_DIR, cityTexture, cloudTexture, createAtmosphere, createWaterMaterial } from "./world";

type TapeRef = { current: HTMLCanvasElement | null };

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, "YXZ");

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function smooth(u: number) {
  const t = clamp(u, 0, 1);
  return t * t * (3 - 2 * t);
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

function facadeMaps(aniso: number) {
  const paint = document.createElement("canvas");
  paint.width = 64;
  paint.height = 64;
  const lights = document.createElement("canvas");
  lights.width = 64;
  lights.height = 64;
  const g = paint.getContext("2d");
  const lg = lights.getContext("2d");
  if (!g || !lg) return null;
  const rnd = mulberry(3);
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

function scaleFacadeUvs(geo: THREE.BufferGeometry, w: number, h: number, d: number) {
  const uv = geo.getAttribute("uv");
  const scales = [
    [d, h],
    [d, h],
    [w, d],
    [w, d],
    [w, h],
    [w, h],
  ];
  for (let f = 0; f < 6; f++) {
    const su = (scales[f]?.[0] ?? 1) * 0.11;
    const sv = (scales[f]?.[1] ?? 1) * 0.13;
    for (let i = 0; i < 4; i++) {
      const idx = f * 4 + i;
      uv.setXY(idx, uv.getX(idx) * su, uv.getY(idx) * sv);
    }
  }
  uv.needsUpdate = true;
}

function facadeBox(
  parent: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  mat: THREE.Material,
) {
  const geo = new THREE.BoxGeometry(w, h, d);
  scaleFacadeUvs(geo, w, h, d);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
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

function jumper(parent: THREE.Object3D, x: number, y: number, z: number, color: string, face: number) {
  const g = new THREE.Group();
  const suit = new THREE.MeshStandardMaterial({ color, roughness: 0.8 });
  const skin = new THREE.MeshStandardMaterial({ color: "#c9a489", roughness: 0.7 });
  const helm = new THREE.MeshStandardMaterial({ color: "#22262b", roughness: 0.45, metalness: 0.2 });
  box(g, 0.42, 0.38, 0.28, 0, 0.62, 0, suit);
  box(g, 0.46, 0.16, 0.55, 0, 0.32, 0.12, suit);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), skin);
  head.position.set(0, 0.92, 0);
  g.add(head);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), helm);
  helmet.position.set(0, 0.96, 0);
  helmet.scale.y = 0.72;
  g.add(helmet);
  g.position.set(x, y, z);
  g.rotation.y = face;
  parent.add(g);
}

function drawTape(canvas: HTMLCanvasElement, altFt: number) {
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
  const yHard = yFor(HARD_DECK_FT);
  const yDec = yFor(DECISION_FT);
  ctx.fillStyle = "rgba(226,61,61,0.38)";
  ctx.fillRect(0, Math.max(0, yHard), w, h - Math.max(0, yHard));
  ctx.fillStyle = "rgba(240,162,2,0.28)";
  const top = clamp(yDec, 0, h);
  const bot = clamp(Math.max(yHard, yDec), 0, h);
  if (bot > top) ctx.fillRect(0, top, w, bot - top);
  const start = Math.floor((altFt - 900) / 100) * 100;
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
  mark(DECISION_FT, "PULL", "#f0a202");
  mark(HARD_DECK_FT, "HARD", "#e23d3d");
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
  renderer.toneMappingExposure = 1.08;

  const scene = new THREE.Scene();
  const atmo = createAtmosphere(renderer);
  scene.background = atmo.fog.clone();
  scene.environment = atmo.envMap;
  scene.environmentIntensity = 0.85;
  const fog = new THREE.Fog(atmo.fog.clone(), 400, 14000);
  scene.fog = fog;
  const camera = new THREE.PerspectiveCamera(72, 1, 0.12, 45000);
  camera.rotation.order = "YXZ";

  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const audio = createAudio();
  const save = loadSave();

  scene.add(new THREE.HemisphereLight("#cfe0f0", "#5d6650", 0.35));
  const sun = new THREE.DirectionalLight("#fff1dc", 2.6);
  sun.position.copy(SUN_DIR).multiplyScalar(1000);
  scene.add(sun);

  const sky = atmo.sky;
  scene.add(sky);

  const aniso = renderer.capabilities.getMaxAnisotropy();
  const cityMap = cityTexture(5, coarse ? 1024 : 2048, 8, aniso);
  const farMap = cityTexture(9, 1024, 8, aniso);
  const sandMap = tile("sand");
  const roadMap = tile("road");
  if (cityMap) cityMap.repeat.set(2500 / 820, 6200 / 820);
  if (farMap) farMap.repeat.set(1, 1);

  const cityMat = new THREE.MeshStandardMaterial({ map: cityMap ?? undefined, color: "#d9dcdf", roughness: 0.95 });
  const sandMat = new THREE.MeshStandardMaterial({ map: sandMap ?? undefined, color: "#e6d3aa", roughness: 1 });
  const grassMat = new THREE.MeshStandardMaterial({ color: "#3f7a4a", roughness: 1 });
  const roadMat = new THREE.MeshStandardMaterial({ map: roadMap ?? undefined, color: "#2c333a", roughness: 0.9 });
  const normalTex = new THREE.TextureLoader().load("/textures/waternormals.jpg");
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
  const water = new THREE.Mesh(new THREE.PlaneGeometry(WORLD, WORLD * 2), waterFx.material);
  water.rotation.x = -Math.PI / 2;
  water.position.set(SHORE_X - 40 + WORLD / 2, 0, 0);
  water.frustumCulled = false;
  scene.add(water);

  const farShape = new THREE.Shape();
  farShape.moveTo(-WORLD, -WORLD);
  farShape.lineTo(SHORE_X - 40, -WORLD);
  farShape.lineTo(SHORE_X - 40, WORLD);
  farShape.lineTo(-WORLD, WORLD);
  farShape.closePath();
  const farHole = new THREE.Path();
  farHole.moveTo(-2508, -3100);
  farHole.lineTo(-2508, 3100);
  farHole.lineTo(SHORE_X - 40, 3100);
  farHole.lineTo(SHORE_X - 40, -3100);
  farHole.closePath();
  farShape.holes.push(farHole);
  const farGeo = new THREE.ShapeGeometry(farShape);
  const farUv = farGeo.getAttribute("uv");
  const farPos = farGeo.getAttribute("position");
  for (let i = 0; i < farUv.count; i++) farUv.setXY(i, farPos.getX(i) / 1400, farPos.getY(i) / 1400);
  const farLand = new THREE.Mesh(
    farGeo,
    new THREE.MeshStandardMaterial({ map: farMap ?? undefined, color: "#c9cdc8", roughness: 1 }),
  );
  farLand.rotation.x = -Math.PI / 2;
  farLand.frustumCulled = false;
  scene.add(farLand);

  const land = new THREE.Mesh(new THREE.PlaneGeometry(2500, 6200), cityMat);
  land.rotation.x = -Math.PI / 2;
  land.position.set(-1258, 0, 0);
  land.frustumCulled = false;
  scene.add(land);
  if (sandMap) sandMap.repeat.set(18, 40 * (WORLD / 3100));
  const sand = new THREE.Mesh(new THREE.PlaneGeometry(SHORE_X, WORLD * 2), onTop(sandMat, 1));
  sand.rotation.x = -Math.PI / 2;
  sand.position.set(SHORE_X / 2, 0.05, 0);
  sand.frustumCulled = false;
  scene.add(sand);
  if (roadMap) roadMap.repeat.set(1, 80 * (WORLD / 3100));
  const road = new THREE.Mesh(new THREE.PlaneGeometry(22, WORLD * 2), onTop(roadMat, 3));
  road.frustumCulled = false;
  road.rotation.x = -Math.PI / 2;
  road.position.set(-18, 0.07, 0);
  scene.add(road);
  const park = new THREE.Mesh(new THREE.PlaneGeometry(150, 380), onTop(grassMat, 1));
  park.rotation.x = -Math.PI / 2;
  park.position.set(-115, 0.08, -390);
  scene.add(park);

  const facades = facadeMaps(renderer.capabilities.getMaxAnisotropy());
  const bMat = new THREE.MeshStandardMaterial({
    color: "#d5dde4",
    map: facades?.map,
    emissive: new THREE.Color("#ffb56a"),
    emissiveMap: facades?.lights,
    emissiveIntensity: 0.55,
    roughness: 0.62,
    metalness: 0.16,
  });
  bMat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      "#include <uv_vertex>",
      `#include <uv_vertex>
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
  };
  const rnd = mulberry(7);
  const count = 180;
  const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), bMat, count);
  inst.frustumCulled = false;
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  let placed = 0;
  for (let i = 0; i < 400 && placed < count; i++) {
    const x = -70 - rnd() * 720;
    const z = -1100 + rnd() * 1700;
    const inPark = x > -200 && x < -30 && z > -580 && z < -180;
    if (inPark) continue;
    if (Math.hypot(x + 250, z + 620) < 80) continue;
    const downtown = z < -280 && z > -980 && x > -520 && x < -90;
    const h = downtown ? 40 + rnd() * 200 : 12 + rnd() * 48;
    const bw = 16 + rnd() * 22;
    const bd = 16 + rnd() * 22;
    dummy.position.set(x, h / 2, z);
    dummy.scale.set(bw, h, bd);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    inst.setMatrixAt(placed, dummy.matrix);
    color.setHSL(0.58, 0.06, 0.32 + rnd() * 0.22);
    inst.setColorAt(placed, color);
    placed++;
  }
  inst.count = placed;
  inst.instanceMatrix.needsUpdate = true;
  if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  scene.add(inst);

  const verge = new THREE.Mesh(new THREE.PlaneGeometry(40, WORLD * 2), onTop(grassMat.clone(), 2));
  verge.rotation.x = -Math.PI / 2;
  verge.position.set(10, 0.09, 0);
  verge.frustumCulled = false;
  scene.add(verge);
  const wet = new THREE.Mesh(
    new THREE.PlaneGeometry(18, WORLD * 2),
    onTop(new THREE.MeshStandardMaterial({ color: "#b7a888", roughness: 0.95 }), 2),
  );
  wet.rotation.x = -Math.PI / 2;
  wet.position.set(SHORE_X - 10, 0.07, 0);
  wet.frustumCulled = false;
  scene.add(wet);

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
  const towerMat = new THREE.MeshStandardMaterial({
    color: "#d7dee5",
    map: facades?.map,
    emissive: new THREE.Color("#ffb56a"),
    emissiveMap: facades?.lights,
    emissiveIntensity: 0.45,
    roughness: 0.48,
    metalness: 0.28,
  });
  const darkTower = towerMat.clone();
  darkTower.color.set("#3a4450");
  darkTower.emissiveIntensity = 0.62;
  const willis = new THREE.Group();
  const heights = [250, 320, 250, 340, 430, 340, 250, 320, 250];
  for (let i = 0; i < 9; i++) {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const h = heights[i] ?? 200;
    facadeBox(willis, 18, h, 18, (col - 1) * 20, h / 2, (row - 1) * 20, darkTower);
  }
  box(willis, 1.2, 70, 1.2, 0, 465, 0, steel);
  willis.position.set(-280, 0, -640);
  scene.add(willis);
  facadeBox(scene, 42, 346, 42, -150, 173, -500, towerMat);
  const hGeo = new THREE.CylinderGeometry(12, 22, 340, 4);
  hGeo.rotateY(Math.PI / 4);
  const hancockMat = new THREE.MeshStandardMaterial({ color: "#1c232b", roughness: 0.42, metalness: 0.48 });
  const hancock = new THREE.Mesh(hGeo, hancockMat);
  hancock.position.set(-360, 170, -860);
  scene.add(hancock);
  for (const lean of [-0.16, 0.16]) {
    const brace = new THREE.Mesh(new THREE.BoxGeometry(1.4, 300, 1.4), steel);
    brace.position.set(-360, 160, -860);
    brace.rotation.z = lean;
    scene.add(brace);
  }
  box(scene, 2, 46, 2, -360, 360, -860, steel);

  const pierMat = new THREE.MeshStandardMaterial({ color: "#b7c0c6", roughness: 0.7 });
  box(scene, 340, 2.2, 34, 180, 1.2, -430, pierMat);
  box(scene, 80, 10, 22, 70, 6, -430, new THREE.MeshStandardMaterial({ color: "#d9e0e4" }));
  const ferris = new THREE.Group();
  const wheel = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: "#f4f7fa", roughness: 0.45 });
  const redM = new THREE.MeshStandardMaterial({ color: "#c4322a", roughness: 0.5 });
  const amberM = new THREE.MeshStandardMaterial({ color: "#e0a020", roughness: 0.5 });
  wheel.add(new THREE.Mesh(new THREE.TorusGeometry(26, 0.55, 8, 36), white));
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(26, 0.35, 0.35), white);
    spoke.position.set(Math.cos(a) * 13, Math.sin(a) * 13, 0);
    spoke.rotation.z = a;
    wheel.add(spoke);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.6, 2.6), i % 2 ? redM : amberM);
    cab.position.set(Math.cos(a) * 26, Math.sin(a) * 26, 0);
    wheel.add(cab);
  }
  ferris.add(wheel);
  ferris.rotation.y = Math.PI / 2;
  ferris.position.set(330, 30, -430);
  scene.add(ferris);
  const bowl = new THREE.Mesh(
    new THREE.TorusGeometry(68, 14, 8, 28),
    new THREE.MeshStandardMaterial({ color: "#9aa3ab", roughness: 0.8 }),
  );
  bowl.rotation.x = Math.PI / 2;
  bowl.position.set(-120, 6, -180);
  scene.add(bowl);
  const field = new THREE.Mesh(new THREE.CircleGeometry(48, 20), grassMat);
  field.rotation.x = -Math.PI / 2;
  field.position.set(-120, 0.2, -180);
  scene.add(field);

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

  const boats: THREE.Group[] = [];
  for (let i = 0; i < 4; i++) {
    const b = new THREE.Group();
    box(b, 16, 1.4, 4.2, 0, 0.7, 0, white);
    box(b, 5, 2.4, 3.2, -1.5, 2.1, 0, dark);
    const wake = new THREE.Mesh(
      new THREE.PlaneGeometry(34, 2.4),
      new THREE.MeshBasicMaterial({ color: "#e7f2f4", transparent: true, opacity: 0.4, depthWrite: false }),
    );
    wake.rotation.x = -Math.PI / 2;
    wake.position.set(-22, 0.2, 0);
    b.add(wake);
    b.position.set(420 + i * 180, 0.4, -200 + i * 260);
    scene.add(b);
    boats.push(b);
  }

  const cTex = cloudTexture(21);
  const clouds: THREE.Sprite[] = [];
  if (cTex) {
    const cMat = new THREE.SpriteMaterial({ map: cTex, transparent: true, depthWrite: false, fog: false });
    const cloudRnd = mulberry(21);
    for (let i = 0; i < 16; i++) {
      const puff = new THREE.Sprite(cMat);
      const w = 480 + cloudRnd() * 1200;
      puff.scale.set(w, w * (0.32 + cloudRnd() * 0.18), 1);
      const high = i < 6;
      puff.position.set(
        -900 + cloudRnd() * 2600,
        high ? 4300 + cloudRnd() * 900 : 700 + cloudRnd() * 1700,
        -1800 + cloudRnd() * 3600,
      );
      scene.add(puff);
      clouds.push(puff);
    }
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
  jumper(plane, -0.72, 0.46, -1.5, "#243044", 0);
  jumper(plane, -0.72, 0.46, -0.4, "#9a3412", 0.4);
  jumper(plane, -0.72, 0.46, 0.7, "#1a1c1f", -0.2);
  jumper(plane, 0.72, 0.46, -1.3, "#c2a36b", Math.PI);
  jumper(plane, 0.15, 0.2, -3.35, "#2a3340", Math.PI);
  const cabinLamp = new THREE.PointLight("#ffd2a8", 6, 7, 2);
  cabinLamp.position.set(0, 1.55, -0.2);
  plane.add(cabinLamp);
  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(0.08, 8, 8),
    new THREE.MeshStandardMaterial({ color: "#ff3b3b", emissive: "#ff2020", emissiveIntensity: 1 }),
  );
  beacon.position.set(0, 3.15, 3.3);
  plane.add(beacon);

  const canopyRig = createCanopy();
  const canopy = canopyRig.group;
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
  let brakeL = 0;
  let brakeR = 0;
  let shockFired = false;
  let deployingReserve = false;
  let reserveArmed = false;
  let usedReserve = false;
  let flying: "none" | "main" | "reserve" = "none";
  let leftOnRed = false;
  let doorBriefed = false;
  let warnedDecision = false;
  let beepAcc = 0;
  let flashUntil = 0;
  let flashText = "";
  let simTime = 0;
  let walk = 0;
  let inDoor = false;
  let green = false;
  let outcome: Outcome | null = null;
  let camReady = false;
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
    dzRel: 0,
    dzDist: 0,
    dzVisible: false,
    outcome: null,
    canopy: "none",
    needsLook: false,
    save: { bestM: save.bestM, jumps: save.jumps, rides: save.rides },
  };

  function persist() {
    hud.save = { bestM: save.bestM, jumps: save.jumps, rides: save.rides };
    writeSave(save);
  }

  function resetRun() {
    seg = 0;
    segDist = 0;
    plane.position.copy(path[0] ?? new THREE.Vector3());
    planeYaw = Math.PI;
  }

  function begin() {
    phase = "cabin";
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
    canopy.visible = false;
    streamer.visible = false;
    riderX = -0.05;
    riderZ = 1.05;
    localYaw = -Math.PI / 2;
    localPitch = -0.08;
    bank = 0;
    malChance = clamp(bridge.malChance, 0, 0.4);
    lockedAlt = clamp(bridge.altitudeFt, 8000, 20000) / FT_PER_M;
    save.altitudeFt = Math.round(lockedAlt * FT_PER_M);
    save.malPct = Math.round(malChance * 100);
    resetRun();
    plane.position.y = lockedAlt;
    audio.resetDeath();
    audio.resume();
    persist();
  }

  function backToMenu() {
    phase = "menu";
    outcome = null;
    canopy.visible = false;
    streamer.visible = false;
    flying = "none";
    if (document.pointerLockElement) void document.exitPointerLock();
  }

  function pushLog(line: string) {
    log.push(line);
    if (log.length > 10) log.shift();
  }

  function finishImpact(reason: string) {
    if (phase === "impact" || phase === "down") return;
    phase = "impact";
    pos.y = Math.max(pos.y, 0);
    vel.set(0, 0, 0);
    pushLog(reason);
    outcome = {
      kind: "impact",
      distanceM: Math.hypot(pos.x - DZ_X, pos.z - DZ_Z),
      usedReserve,
      redLight: leftOnRed,
      intoWind: false,
      hot: true,
      onBeach: false,
      log: log.slice(),
      reason,
    };
    audio.update(0, 0, 0);
    audio.death();
    persist();
  }

  function finishDown() {
    const dist = Math.hypot(pos.x - DZ_X, pos.z - DZ_Z);
    const gs = Math.hypot(vel.x, vel.z);
    const intoWind = -Math.sin(heading) > 0.62;
    const hot = gs > 16 || -vel.y > 7.2;
    const water = pos.x > SHORE_X;
    const onBeach = pos.x >= -8 && pos.x <= SHORE_X + 6;
    pos.y = 0;
    vel.y = 0;
    if (water) {
      outcome = {
        kind: "water",
        distanceM: dist,
        usedReserve,
        redLight: leftOnRed,
        intoWind,
        hot,
        onBeach: false,
        log: log.slice(),
        reason: "Water",
      };
    } else {
      outcome = {
        kind: "landed",
        distanceM: dist,
        usedReserve,
        redLight: leftOnRed,
        intoWind,
        hot,
        onBeach,
        log: log.slice(),
        reason: "",
      };
      save.rides += 1;
      if (onBeach && (save.bestM === null || dist < save.bestM)) save.bestM = Math.round(dist * 10) / 10;
    }
    pushLog(water ? "Water landing" : `Down · ${Math.round(dist)} m`);
    if (outcome) outcome.log = log.slice();
    phase = "down";
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
    persist();
  }

  function pullMain() {
    if (phase !== "freefall" || reserveArmed) return;
    const alt = pos.y * FT_PER_M;
    phase = "deploying";
    openT = 0;
    shockFired = false;
    deployingReserve = false;
    mal = Math.random() < malChance ? (Math.random() < 0.62 ? "streamer" : "twist") : "none";
    heading = bodyYaw;
    pushLog(`Pull at ${Math.round(alt).toLocaleString("en-US")} ft`);
    audio.fabric();
    if (alt < 700) pushLog("That pull is late");
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
    heading = bodyYaw;
    pushLog(`Reserve at ${Math.round(alt).toLocaleString("en-US")} ft`);
    audio.fabric();
  }

  function forcePhase(p: string) {
    outcome = null;
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
    } else if (p === "cabin") begin();
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
    prevJump = bridge.jump;
    prevPull = bridge.pull;
    prevCut = bridge.cut;
    prevReserve = bridge.reserve;
    if (qaKeys) prevQa = new Set(qaKeys);
    else eventEdges.clear();
    return { turn, strafe, forward, jumpEdge, pullEdge, cutEdge, reserveEdge };
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
    wheel.rotation.z += dt * 0.28;
    sock.rotation.y = Math.sin(simTime * 7) * 0.12;
    (beacon.material as THREE.MeshStandardMaterial).emissiveIntensity =
      Math.sin(simTime * 8) > 0.4 ? 2 : 0.15;
    for (let i = 0; i < boats.length; i++) {
      const boat = boats[i];
      if (!boat) continue;
      boat.position.z += dt * (6 + i);
      if (boat.position.z > 1800) boat.position.z = -1800;
    }
    for (const puff of clouds) {
      puff.position.x += dt * 2.2;
      if (puff.position.x > 2000) puff.position.x = -1600;
    }
    ferris.position.y = 30 + Math.sin(simTime * 0.6) * 0;

    if (!input) return;
    const sens = 0.00215;
    if (phase === "cabin") {
      localYaw -= lookDX * sens;
      localPitch = clamp(localPitch - lookDY * sens, -1.2, 1.05);
    } else if (phase === "canopy" || phase === "down") {
      lookOffYaw = clamp(lookOffYaw - lookDX * sens, -1.35, 1.35);
      lookOffPitch = clamp(lookOffPitch - lookDY * sens, -1.0, 1.5);
    } else if (phase === "freefall" || phase === "deploying" || phase === "malfunction") {
      bodyYaw -= lookDX * sens;
      bodyPitch = clamp(bodyPitch - lookDY * sens, -1.35, 1.15);
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
      inDoor = riderX > 0.8 && riderZ > 0.28 && riderZ < 1.7;
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

    if (phase === "freefall" || (phase === "malfunction" && mal === "streamer") || (phase === "deploying" && mal === "streamer")) {
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
      if (mal === "streamer") terminal = 40;
      const fx = -Math.sin(bodyYaw);
      const fz = -Math.cos(bodyYaw);
      _v1.set(fx * h + WIND_X, -terminal, fz * h + WIND_Z);
      vel.lerp(_v1, 1 - Math.exp(-1.8 * dt));
    } else if (phase === "malfunction" && mal === "twist") {
      bodyYaw += dt * 4.2;
      heading = bodyYaw;
      _v1.set(-Math.sin(bodyYaw) * 4 + WIND_X, -16, -Math.cos(bodyYaw) * 4 + WIND_Z);
      vel.lerp(_v1, 1 - Math.exp(-2 * dt));
    } else if (phase === "deploying" && mal === "none") {
      openT += dt;
      const dur = deployingReserve ? 1.45 : 2.65;
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
      if (brake && pos.y < 48) desc = Math.min(desc, 2.2);
      if (brake && pos.y < 14) desc = Math.min(desc, 1.3);
      const fx = -Math.sin(heading);
      const fz = -Math.cos(heading);
      _v1.set(fx * fspd + WIND_X, -desc, fz * fspd + WIND_Z);
      vel.lerp(_v1, 1 - Math.exp(-2.5 * dt));
    }

    shock *= Math.exp(-3.4 * dt);
    const bankTarget = -input.turn * 0.5;
    bank += (bankTarget - bank) * (1 - Math.exp(-6 * dt));
    pos.addScaledVector(vel, dt);

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
    const inDanger =
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
      const dur = deployingReserve ? 1.45 : 2.65;
      const u = phase === "deploying" ? smooth(clamp((openT - 0.3) / (dur * 0.8), 0.02, 1)) : 1;
      if (phase !== "canopy") {
        brakeL = 0;
        brakeR = 0;
      }
      canopy.position.copy(pos);
      canopy.rotation.set(0, heading, bank * 0.45);
      canopyRig.setReserve(flying === "reserve" || deployingReserve);
      canopyRig.update(u, brakeL, brakeR);
    }
    streamer.visible = mal === "streamer" && (phase === "deploying" || phase === "malfunction");
    if (streamer.visible) {
      streamer.position.copy(pos);
      for (let i = 0; i < ribs.length; i++) {
        const rib = ribs[i];
        if (!rib) continue;
        rib.position.set(Math.sin(simTime * 6 + i) * 0.35, 1.2 + i * 0.85, Math.cos(simTime * 5 + i) * 0.25);
        rib.rotation.z = Math.sin(simTime * 4 + i) * 0.4;
      }
    }
  }

  function southboundLight(dir: THREE.Vector3) {
    const onRun = Math.abs(plane.position.x - RUN_X) < 90 && dir.z > 0.55;
    green = onRun && Math.abs(plane.position.z - DZ_Z) < 280;
    glow.color.set(green ? "#3dce73" : "#e23d3d");
    glow.emissive.set(green ? "#3dce73" : "#e23d3d");
  }

  function poseName(forward: number) {
    if (phase !== "freefall") return phase === "canopy" ? "CANOPY" : "";
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
      } else if (altFt <= HARD_DECK_FT) {
        banner = "HARD DECK — PULL IMMEDIATELY";
        bannerLevel = 3;
      } else if (altFt <= PULL_NOW_FT) {
        banner = "PULL NOW";
        bannerLevel = 2;
      } else if (altFt <= DECISION_FT) {
        banner = "CRITICAL ALTITUDE — PULL";
        bannerLevel = 1;
      }
    }
    if (simTime < flashUntil && flashText) {
      banner = flashText;
      if (bannerLevel === 0) bannerLevel = 1;
    }

    let prompt = "";
    if (phase === "cabin") {
      prompt = inDoor
        ? green
          ? "GREEN LIGHT — SPACE TO JUMP"
          : "RED LIGHT — SPACE STILL JUMPS"
        : "WALK TO THE DOOR";
    } else if (phase === "freefall") {
      prompt = reserveArmed ? "PULL RESERVE — R OR SPACE" : "SPACE PULLS";
    } else if (phase === "malfunction") {
      prompt = "X CUT AWAY · THEN R RESERVE";
    } else if (phase === "deploying") {
      prompt = mal === "none" ? "OPENING" : "WAITING ON A BAD CANOPY";
    } else if (phase === "canopy") {
      const facingLake = -Math.sin(heading) > 0.55;
      const dist = Math.hypot(DZ_X - pos.x, DZ_Z - pos.z);
      if (pos.y < 260 && !facingLake) prompt = "FACE THE LAKE — LAND INTO THE WIND";
      else if (pos.y < 40) prompt = "FLARE — HOLD S";
      else if (dist > 90) prompt = "FLY THE ARROW TO THE BEACH";
      else prompt = "ON FINAL";
    }

    let spot = "";
    if (phase === "cabin" || phase === "menu") {
      const onLine = Math.abs(plane.position.x - RUN_X) < 90 && planeVel.z > 0.5 * PLANE_MPS * 0.5;
      if (!onLine) spot = "GO-AROUND";
      else if (plane.position.z < -280) spot = `SPOT IN ${Math.max(0, Math.round((-280 - plane.position.z) / PLANE_MPS))}s`;
      else if (plane.position.z > 280) spot = "PAST THE SPOT";
      else spot = "ON THE SPOT";
    }

    const yaw =
      phase === "canopy" || phase === "down"
        ? heading
        : phase === "cabin" || phase === "menu"
          ? planeYaw + localYaw
          : bodyYaw;
    const dx = DZ_X - pos.x;
    const dz = DZ_Z - pos.z;
    const want = Math.atan2(-dx, -dz);
    const rel = Math.atan2(Math.sin(want - (phase === "freefall" ? bodyYaw : heading)), Math.cos(want - (phase === "freefall" ? bodyYaw : heading)));

    camera.updateMatrixWorld();
    _v3.set(1.15, 1.25, 0.95);
    plane.localToWorld(_v3);
    const doorWorld = _v3.clone();
    camera.getWorldDirection(_v2);
    const toDoor = _v1.copy(doorWorld).sub(camera.position);
    const facing = _v2.dot(toDoor) > 0;
    const projected = doorWorld.project(camera);
    hud.phase = phase;
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
    hud.dzVisible = phase === "freefall" || phase === "canopy" || phase === "deploying" || phase === "malfunction";
    hud.dzRel = THREE.MathUtils.radToDeg(rel);
    hud.dzDist = Math.hypot(dx, dz);
    hud.outcome = outcome;
    hud.canopy = flying;
    hud.needsLook =
      !coarse &&
      phase !== "menu" &&
      document.pointerLockElement !== canvas;
    if (tape.current && phase !== "menu") drawTape(tape.current, altFt);
    onFrame(hud);
  }

  function frameCamera(dt: number) {
    sky.position.copy(camera.position);
    const h = camera.position.y;
    const t = clamp(h / 4500, 0, 1);
    fog.near = THREE.MathUtils.lerp(500, 2600, t);
    fog.far = THREE.MathUtils.lerp(16000, 36000, Math.sqrt(t));
    waterUniforms.uFogNear.value = fog.near;
    waterUniforms.uFogFar.value = fog.far;
    atmo.setViewHeight(h);
    atmo.update(simTime);
    if (phase === "menu") {
      _v1.copy(planeVel);
      if (_v1.lengthSq() < 1) _v1.set(0, 0, 1);
      _v1.normalize();
      _v2.copy(plane.position).addScaledVector(_v1, -38);
      _v2.x += 24;
      _v2.y += 12;
      if (!camReady || camera.position.distanceTo(_v2) > 400) {
        camera.position.copy(_v2);
        camReady = true;
      } else camera.position.lerp(_v2, 1 - Math.exp(-1.8 * dt));
      _v3.copy(plane.position);
      _v3.x -= 48;
      _v3.y += 1.4;
      camera.lookAt(_v3);
      camera.fov = 68;
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
    const air = Math.hypot(vel.x, vel.y, vel.z);
    camera.position.copy(pos);
    camera.position.y += phase === "canopy" || phase === "down" ? 0.62 : 0.32;
    if (!reduce && phase !== "down" && phase !== "impact") {
      const s = phase === "canopy" ? 0.012 : Math.min(air / 80, 1) * 0.045;
      camera.position.x += Math.sin(simTime * 23) * s;
      camera.position.y += Math.cos(simTime * 19) * s * 0.5;
    }
    if (phase === "canopy" || phase === "down") {
      _e.set(-0.22 + lookOffPitch, heading + lookOffYaw, bank * 0.65, "YXZ");
    } else {
      _e.set(bodyPitch, bodyYaw, bank, "YXZ");
    }
    if (shock > 0.01 && !reduce) {
      _e.x -= shock * shock * 0.32;
      _e.z += Math.sin(simTime * 29) * shock * 0.05;
      camera.position.y += Math.sin(simTime * 41) * shock * 0.07;
    }
    camera.quaternion.setFromEuler(_e);
    const targetFov = phase === "freefall" || phase === "malfunction" ? 74 + Math.min(air, 80) * 0.1 : 72;
    if (Math.abs(camera.fov - targetFov) > 0.25) {
      camera.fov += (targetFov - camera.fov) * 0.08;
      camera.updateProjectionMatrix();
    }
  }

  function audioMix() {
    audio.setMuted(bridge.muted);
    const air = Math.hypot(vel.x, vel.y, vel.z);
    if (phase === "impact") audio.update(0, 0, 0);
    else if (phase === "menu") audio.update(0.02, 0.045, 20);
    else if (phase === "cabin") audio.update(inDoor ? 0.24 : 0.035, inDoor ? 0.03 : 0.11, inDoor ? 40 : 10);
    else if (phase === "canopy" || phase === "down") audio.update(0.045, 0, 12);
    else audio.update(clamp(air / 85, 0, 1) * 0.36, 0, air);
  }

  let acc = 0;
  let lastInput: ReturnType<typeof sample> | null = null;

  function loop() {
    timer.update();
    const frameDt = Math.min(timer.getDelta(), 0.05);
    if (bridge.command === "start" && phase === "menu") {
      bridge.command = null;
      begin();
    } else if (bridge.command === "again") {
      bridge.command = null;
      backToMenu();
    }
    lastInput = sample();
    acc += frameDt;
    let guard = 0;
    while (acc >= 1 / 60 && guard < 5) {
      if (lastInput) step(1 / 60, lastInput);
      if (lastInput) {
        lastInput.jumpEdge = false;
        lastInput.pullEdge = false;
        lastInput.cutEdge = false;
        lastInput.reserveEdge = false;
      }
      acc -= 1 / 60;
      guard++;
    }
    frameCamera(frameDt);
    audioMix();
    publish(lastInput?.forward ?? 0);
    renderer.render(scene, camera);
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
    if (coarse || phase === "menu") return;
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
      addLook?: (dx: number, dy: number) => void;
    };
  }
}
