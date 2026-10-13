import * as THREE from "three";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import type { Light } from "./types";

type Rgb = readonly [number, number, number];

export type LightPreset = {
  /** Toward the sun. */
  sun: THREE.Vector3;
  sky: { turbidity: number; rayleigh: number; mieCoefficient: number; mieDirectionalG: number; gain: number };
  /** Display-space haze shared by fog, the sky's horizon band, the lake and the clouds. */
  haze: Rgb;
  /** How much warmer the haze glows just above the horizon toward the sun. */
  hazeSun: Rgb;
  /** A grade on the sky model: a low sun turns its blues olive, so evenings pull green out. */
  skyTint: Rgb;
  sunColor: string;
  sunIntensity: number;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  exposure: number;
  env: number;
  /** Sunlit and shaded sides of the cumulus. */
  cloudLit: Rgb;
  cloudShade: Rgb;
  /** Inside a cloud. */
  veil: Rgb;
  /** The sun's glitter on the lake, and the surf along the beach. */
  glint: Rgb;
  foam: Rgb;
  /** The lake's own color under the surface reflections. */
  lake: number;
  /** Lit office windows, and streetlights on the ground and along the Drive. */
  windows: number;
  streets: number;
};

/** A sun `elevation` degrees up, `azimuth` degrees clockwise from north (north is -z, east +x). */
function sunAt(elevation: number, azimuth: number) {
  const e = THREE.MathUtils.degToRad(elevation);
  const a = THREE.MathUtils.degToRad(azimuth);
  return new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e));
}

// Summer evenings in Chicago: the sun goes down in the west-northwest, behind downtown as seen
// from the lake.
const PRESETS: Record<Light, LightPreset> = {
  day: {
    sun: new THREE.Vector3(-0.62, 0.5, 0.3).normalize(),
    sky: { turbidity: 3.2, rayleigh: 1.25, mieCoefficient: 0.0035, mieDirectionalG: 0.82, gain: 0.36 },
    haze: [0.8, 0.85, 0.9],
    hazeSun: [1, 1, 1],
    skyTint: [1, 1, 1],
    sunColor: "#fff1dc",
    sunIntensity: 2.6,
    hemiSky: "#cfe0f0",
    hemiGround: "#5d6650",
    hemiIntensity: 0.35,
    exposure: 1.08,
    env: 0.85,
    cloudLit: [1.1, 1.06, 1.0],
    cloudShade: [0.42, 0.48, 0.58],
    veil: [1, 1, 1],
    glint: [9.0, 7.4, 5.6],
    foam: [0.78, 0.8, 0.8],
    lake: 1,
    windows: 0.4,
    streets: 0,
  },
  golden: {
    sun: sunAt(7, 291),
    sky: { turbidity: 3.6, rayleigh: 1.9, mieCoefficient: 0.004, mieDirectionalG: 0.8, gain: 0.5 },
    haze: [0.86, 0.78, 0.72],
    hazeSun: [1.14, 0.98, 0.8],
    skyTint: [1, 0.94, 1.08],
    sunColor: "#ffbe86",
    sunIntensity: 2.3,
    hemiSky: "#b9c3dc",
    hemiGround: "#5a4c42",
    hemiIntensity: 0.42,
    exposure: 1.18,
    env: 0.8,
    cloudLit: [1.0, 0.76, 0.56],
    cloudShade: [0.4, 0.4, 0.54],
    veil: [1, 0.9, 0.82],
    glint: [10.0, 6.4, 3.2],
    foam: [0.74, 0.68, 0.62],
    lake: 0.8,
    windows: 0.7,
    streets: 0,
  },
  dusk: {
    sun: sunAt(1.2, 296),
    sky: { turbidity: 2.4, rayleigh: 2.2, mieCoefficient: 0.004, mieDirectionalG: 0.78, gain: 1.1 },
    haze: [0.6, 0.5, 0.56],
    hazeSun: [1.3, 0.92, 0.62],
    skyTint: [1, 0.82, 1.26],
    sunColor: "#ff9a5c",
    sunIntensity: 1.1,
    hemiSky: "#8a93c0",
    hemiGround: "#3b3440",
    hemiIntensity: 0.6,
    exposure: 1.3,
    env: 0.9,
    cloudLit: [0.92, 0.52, 0.44],
    cloudShade: [0.26, 0.26, 0.4],
    veil: [0.62, 0.53, 0.58],
    glint: [8.0, 3.8, 1.6],
    foam: [0.34, 0.31, 0.34],
    lake: 0.5,
    windows: 1.6,
    streets: 0.6,
  },
};

export const SUN_DIR = PRESETS.day.sun.clone();

const SKY = { ...PRESETS.day.sky };

// three.js applies fog after tone mapping, so the haze that ties ground, lake and
// sky together is a display-space color shared by all three.
export const HAZE_SRGB = new THREE.Vector3(...PRESETS.day.haze);
export const HAZE_DISPLAY = new THREE.Color().setRGB(HAZE_SRGB.x, HAZE_SRGB.y, HAZE_SRGB.z, THREE.SRGBColorSpace);

/** Tints for the time of day that shaders read when they are built. */
export const TINT = {
  hazeSun: new THREE.Vector3(...PRESETS.day.hazeSun),
  skyTint: new THREE.Vector3(...PRESETS.day.skyTint),
  cloudLit: new THREE.Vector3(...PRESETS.day.cloudLit),
  cloudShade: new THREE.Vector3(...PRESETS.day.cloudShade),
  veil: new THREE.Vector3(...PRESETS.day.veil),
  glint: new THREE.Vector3(...PRESETS.day.glint),
  foam: new THREE.Vector3(...PRESETS.day.foam),
  lake: { value: PRESETS.day.lake },
};

/**
 * Sets the sun, sky and haze for a time of day. Call it before building the world: the sky,
 * fog, lake and clouds read these once, when they are made.
 */
export function applyLight(light: Light): LightPreset {
  const p = PRESETS[light];
  SUN_DIR.copy(p.sun);
  Object.assign(SKY, p.sky);
  HAZE_SRGB.set(...p.haze);
  HAZE_DISPLAY.setRGB(HAZE_SRGB.x, HAZE_SRGB.y, HAZE_SRGB.z, THREE.SRGBColorSpace);
  TINT.hazeSun.set(...p.hazeSun);
  TINT.skyTint.set(...p.skyTint);
  TINT.cloudLit.set(...p.cloudLit);
  TINT.cloudShade.set(...p.cloudShade);
  TINT.veil.set(...p.veil);
  TINT.glint.set(...p.glint);
  TINT.foam.set(...p.foam);
  TINT.lake.value = p.lake;
  return p;
}

export function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

// CPU copy of the Preetham model in three's Sky shader, used to pick a haze color
// that matches the rendered horizon exactly.
function skyRadiance(dir: THREE.Vector3, sun: THREE.Vector3) {
  const totalRayleigh = [5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5];
  const mieConst = [1.8399918514433978e14, 2.7798023919660528e14, 4.0790479543861094e14];
  const sunE = 1000 * Math.max(0, 1 - Math.exp(-((1.6110731556870734 - Math.acos(Math.max(-1, Math.min(1, sun.y)))) / 1.5)));
  const mieC = 0.434 * (0.2 * SKY.turbidity * 1e-17);
  const zen = Math.acos(Math.max(0, dir.y));
  const inv = 1 / (Math.cos(zen) + 0.15 * Math.pow(93.885 - (zen * 180) / Math.PI, -1.253));
  const cosT = dir.dot(sun);
  const rPhase = 0.0596831036594608 * (1 + Math.pow(cosT * 0.5 + 0.5, 2));
  const g = SKY.mieDirectionalG;
  const mPhase = (0.07957747154594767 * (1 - g * g)) / Math.pow(1 - 2 * g * cosT + g * g, 1.5);
  const sunMix = clamp01(Math.pow(1 - sun.y, 5));
  const extra = [0, 0.0003, 0.00075];
  const out = new THREE.Vector3();
  for (let i = 0; i < 3; i++) {
    const bR = (totalRayleigh[i] ?? 0) * SKY.rayleigh;
    const bM = mieC * (mieConst[i] ?? 0) * SKY.mieCoefficient;
    const fex = Math.exp(-(bR * 8400 * inv + bM * 1250 * inv));
    const scatter = (sunE * (bR * rPhase + bM * mPhase)) / (bR + bM);
    let lin = Math.pow(scatter * (1 - fex), 1.5);
    lin *= 1 + (Math.sqrt(scatter * fex) - 1) * sunMix;
    const v = (lin + 0.1 * fex) * 0.04 + (extra[i] ?? 0);
    out.setComponent(i, v * SKY.gain);
  }
  return out;
}

export type Atmosphere = {
  sky: Sky;
  /** Display-space haze for fog mixing. */
  fog: THREE.Color;
  /** Linear horizon radiance, for reflections. */
  haze: THREE.Color;
  zenith: THREE.Color;
  envMap: THREE.Texture;
  setViewHeight: (meters: number) => void;
  update: (time: number) => void;
  dispose: () => void;
};

export function createAtmosphere(renderer: THREE.WebGLRenderer): Atmosphere {
  const sky = new Sky();
  sky.scale.setScalar(40000);
  sky.frustumCulled = false;
  const mat = sky.material as THREE.ShaderMaterial;
  const u = mat.uniforms;
  u.turbidity!.value = SKY.turbidity;
  u.rayleigh!.value = SKY.rayleigh;
  u.mieCoefficient!.value = SKY.mieCoefficient;
  u.mieDirectionalG!.value = SKY.mieDirectionalG;
  (u.sunPosition!.value as THREE.Vector3).copy(SUN_DIR);
  u.cloudCoverage!.value = 0.32;
  u.cloudDensity!.value = 0.5;
  u.cloudElevation!.value = 0.55;
  u.cloudScale!.value = 0.00016;

  const hazeV = new THREE.Vector3();
  const probe = new THREE.Vector3();
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    probe.set(Math.cos(a), 0, Math.sin(a));
    hazeV.add(skyRadiance(probe, SUN_DIR));
  }
  hazeV.multiplyScalar(1 / 16);
  // Low haze over a big lake reads slightly bluer and brighter than the raw model.
  hazeV.multiply(new THREE.Vector3(0.98, 1.0, 1.06));
  const zenV = skyRadiance(probe.set(0, 1, 0), SUN_DIR);
  hazeV.multiply(TINT.skyTint);
  zenV.multiply(TINT.skyTint);
  const haze = new THREE.Color().setRGB(hazeV.x, hazeV.y, hazeV.z);
  const zenith = new THREE.Color().setRGB(zenV.x, zenV.y, zenV.z);

  u.skyGain = { value: SKY.gain };
  u.hazeColor = { value: HAZE_SRGB.clone() };
  u.hazeSun = { value: TINT.hazeSun.clone() };
  u.skyTint = { value: TINT.skyTint.clone() };
  u.horizonY = { value: 0 };
  mat.fragmentShader =
    "uniform float skyGain;\nuniform vec3 skyTint;\nuniform vec3 hazeColor;\nuniform vec3 hazeSun;\nuniform float horizonY;\n" +
    mat.fragmentShader.replace(
      "gl_FragColor = vec4( texColor, 1.0 );",
      `gl_FragColor = vec4( texColor * skyGain * skyTint, 1.0 );`,
    ).replace(
      "#include <colorspace_fragment>",
      `#include <colorspace_fragment>
      float hz = 1.0 - smoothstep( horizonY - 0.004, horizonY + 0.12, direction.y );
      vec3 sunDir = vSunDirection;
      // A low sun keeps its disc and glow instead of sinking into the haze band.
      hz *= 1.0 - smoothstep( 0.93, 0.9995, dot( direction, sunDir ) );
      vec2 flatDir = normalize( direction.xz + 1e-5 );
      vec2 flatSun = normalize( sunDir.xz + 1e-5 );
      float toward = pow( max( dot( flatDir, flatSun ), 0.0 ), 3.0 ) * smoothstep( horizonY, horizonY + 0.05, direction.y );
      vec3 haze = hazeColor * mix( vec3( 1.0 ), hazeSun, toward );
      gl_FragColor.rgb = mix( gl_FragColor.rgb, haze, hz * hz * ( 3.0 - 2.0 * hz ) );`,
    );
  mat.needsUpdate = true;

  const envScene = new THREE.Scene();
  const envSky = new Sky();
  envSky.material.dispose();
  envSky.material = mat;
  envSky.scale.setScalar(100);
  envScene.add(envSky);
  const groundMat = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(0.045, 0.05, 0.052) });
  const ground = new THREE.Mesh(new THREE.CircleGeometry(80, 24), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -3;
  envScene.add(ground);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromScene(envScene, 0.02, 0.1, 400);
  pmrem.dispose();
  ground.geometry.dispose();
  groundMat.dispose();

  return {
    sky,
    fog: HAZE_DISPLAY.clone(),
    haze,
    zenith,
    envMap: envRT.texture,
    setViewHeight(meters: number) {
      // The visible horizon dips below level as you climb.
      u.horizonY!.value = -Math.sqrt((2 * Math.max(meters, 0)) / 6371000);
    },
    update(time: number) {
      u.time!.value = time;
    },
    dispose() {
      envRT.dispose();
    },
  };
}

// Fake aerial view of a city grid: blocks of rooftops, alleys, parking and parks.
export function cityTexture(seed: number, size: number, blocks: number, aniso: number) {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const g = c.getContext("2d");
  if (!g) return null;
  const rnd = rng(seed);
  const s = size / 1024;
  g.fillStyle = "#4a4f55";
  g.fillRect(0, 0, size, size);
  const cell = size / blocks;
  const street = cell * 0.13;
  const roofs = ["#6d6a66", "#7a746c", "#5d6268", "#8a8580", "#9a9288", "#55585c", "#a39d93", "#6b5d52", "#7c6f63", "#5f5a55"];
  const greens = ["#3f5f37", "#4a6b3e", "#36532f", "#56743f"];
  const pick = <T,>(arr: T[]) => arr[Math.floor(rnd() * arr.length)] as T;
  for (let by = 0; by < blocks; by++) {
    for (let bx = 0; bx < blocks; bx++) {
      const x0 = bx * cell + street / 2;
      const y0 = by * cell + street / 2;
      const w = cell - street;
      const h = cell - street;
      const kind = rnd();
      if (kind < 0.08) {
        g.fillStyle = pick(greens);
        g.fillRect(x0, y0, w, h);
        for (let i = 0; i < 40; i++) {
          g.fillStyle = rnd() > 0.5 ? "rgba(30,52,28,0.7)" : "rgba(70,100,52,0.6)";
          g.beginPath();
          g.arc(x0 + rnd() * w, y0 + rnd() * h, (3 + rnd() * 7) * s, 0, Math.PI * 2);
          g.fill();
        }
        continue;
      }
      if (kind < 0.15) {
        g.fillStyle = "#575c61";
        g.fillRect(x0, y0, w, h);
        g.fillStyle = "rgba(220,224,228,0.25)";
        for (let row = 0; row < 6; row++) g.fillRect(x0 + 4 * s, y0 + (row + 0.5) * (h / 6), w - 8 * s, 1 * s);
        for (let i = 0; i < 60; i++) {
          g.fillStyle = pick(["#c9ccd0", "#2b2e33", "#8b1e1e", "#e4e6e8", "#3c4a5c"]);
          g.fillRect(x0 + rnd() * (w - 6 * s), y0 + Math.floor(rnd() * 6 + 0.2) * (h / 6) + 2 * s, 3 * s, 5 * s);
        }
        continue;
      }
      // Alley down the middle, lots on both sides.
      g.fillStyle = "#3f4348";
      g.fillRect(x0, y0, w, h);
      const tall = kind > 0.85;
      const cols = tall ? 2 : 3 + Math.floor(rnd() * 4);
      const half = (h - 4 * s) / 2;
      for (const side of [0, 1]) {
        const ly = y0 + side * (half + 4 * s);
        let lx = x0;
        for (let i = 0; i < cols; i++) {
          const lw = i === cols - 1 ? x0 + w - lx : (w / cols) * (0.75 + rnd() * 0.5);
          const roof = pick(roofs);
          g.fillStyle = roof;
          const inset = (1 + rnd() * 2) * s;
          g.fillRect(lx + inset, ly + inset, lw - inset * 2, half - inset * 2);
          g.fillStyle = "rgba(255,255,255,0.12)";
          g.fillRect(lx + inset, ly + inset, lw - inset * 2, 2 * s);
          g.fillStyle = "rgba(0,0,0,0.18)";
          g.fillRect(lx + inset, ly + half - inset - 3 * s, lw - inset * 2, 3 * s);
          const units = Math.floor(rnd() * 4);
          for (let k = 0; k < units; k++) {
            g.fillStyle = rnd() > 0.5 ? "#b9bcbf" : "#8e9296";
            g.fillRect(lx + inset + rnd() * (lw - 12 * s), ly + inset + rnd() * (half - 12 * s), (3 + rnd() * 5) * s, (3 + rnd() * 5) * s);
          }
          lx += lw;
          if (lx >= x0 + w - 2) break;
        }
      }
      // Street trees along the curb.
      for (let i = 0; i < 18; i++) {
        if (rnd() > 0.6) continue;
        const along = rnd();
        const edge = Math.floor(rnd() * 4);
        const tx = edge < 2 ? x0 + along * w : edge === 2 ? x0 - 2 * s : x0 + w + 2 * s;
        const ty = edge >= 2 ? y0 + along * h : edge === 0 ? y0 - 2 * s : y0 + h + 2 * s;
        g.fillStyle = pick(["rgba(52,84,44,0.85)", "rgba(64,96,50,0.85)", "rgba(44,70,40,0.85)"]);
        g.beginPath();
        g.arc(tx, ty, (2.5 + rnd() * 3) * s, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
  // Lane paint down the middle of each street.
  g.fillStyle = "rgba(225,205,140,0.35)";
  for (let i = 0; i <= blocks; i++) {
    g.fillRect(i * cell - 0.5 * s, 0, 1 * s, size);
    g.fillRect(0, i * cell - 0.5 * s, size, 1 * s);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = aniso;
  return tex;
}

/** Streetlights on cityTexture's street grid, for an emissive map: a sodium glow along each street, brighter at the lamps. */
export function streetLights(blocks: number, aniso: number) {
  const size = 512;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const g = c.getContext("2d");
  if (!g) return null;
  const rnd = rng(21);
  const cell = size / blocks;
  const street = cell * 0.13;
  g.fillStyle = "#000";
  g.fillRect(0, 0, size, size);
  g.fillStyle = "rgba(255,140,50,0.07)";
  for (let i = 0; i <= blocks; i++) {
    g.fillRect(i * cell - street / 2, 0, street, size);
    g.fillRect(0, i * cell - street / 2, size, street);
  }
  for (let i = 0; i <= blocks; i++) {
    for (let t = 0; t < size; t += cell / 5) {
      for (const side of [-0.4, 0.4]) {
        const a = i * cell + side * street;
        for (const [x, y] of [
          [a, t + rnd() * 3],
          [t + rnd() * 3, a],
        ] as const) {
          if (rnd() < 0.3) continue;
          g.fillStyle = rnd() > 0.2 ? "#ffb257" : "#fff1cf";
          g.globalAlpha = 0.5 + rnd() * 0.5;
          g.fillRect(x - 1, y - 1, 2, 2);
        }
      }
    }
  }
  g.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = aniso;
  return tex;
}

export function valueNoise(seed: number) {
  const perm = new Uint8Array(512);
  const r = rng(seed);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [p[i], p[j]] = [p[j]!, p[i]!];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255]!;
  const val = (x: number, y: number) => perm[(perm[x & 255]! + y) & 511]! / 255;
  return (x: number, y: number) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const sx = xf * xf * (3 - 2 * xf);
    const sy = yf * yf * (3 - 2 * yf);
    const a = val(xi, yi);
    const b = val(xi + 1, yi);
    const c = val(xi, yi + 1);
    const d = val(xi + 1, yi + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}

export function createWaterMaterial(normals: THREE.Texture, haze: THREE.Color, zenith: THREE.Color, shoreX: number) {
  normals.wrapS = THREE.RepeatWrapping;
  normals.wrapT = THREE.RepeatWrapping;
  const uniforms = {
    uTime: { value: 0 },
    uSun: { value: SUN_DIR.clone() },
    uGlint: { value: TINT.glint.clone() },
    uFoam: { value: TINT.foam.clone() },
    uLake: { value: TINT.lake.value },
    uCam: { value: new THREE.Vector3() },
    uNormals: { value: normals },
    uHaze: { value: new THREE.Vector3(haze.r, haze.g, haze.b) },
    uFogColor: { value: HAZE_SRGB.clone() },
    uZenith: { value: new THREE.Vector3(zenith.r, zenith.g, zenith.b) },
    uFogNear: { value: 400 },
    uFogFar: { value: 14000 },
    uShore: { value: shoreX },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    fog: false,
    vertexShader: `varying vec3 vWorld;
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: `varying vec3 vWorld;
      uniform float uTime; uniform vec3 uSun; uniform vec3 uGlint; uniform vec3 uFoam; uniform float uLake; uniform vec3 uCam; uniform sampler2D uNormals;
      uniform vec3 uHaze; uniform vec3 uFogColor; uniform vec3 uZenith; uniform float uFogNear; uniform float uFogFar; uniform float uShore;
      vec3 nrm(vec2 p){ return texture2D(uNormals, p).rgb * 2.0 - 1.0; }
      void main(){
        vec3 toCam = uCam - vWorld;
        float dist = length(toCam);
        vec3 view = toCam / dist;
        vec2 p = vWorld.xz;
        vec3 t = nrm(p / 97.0 + vec2(uTime * 0.006, uTime * 0.004));
        t += nrm(p / 31.0 + vec2(-uTime * 0.011, uTime * 0.014));
        t += nrm(p / 9.0 + vec2(uTime * 0.026, -uTime * 0.019)) * 0.5;
        float k = mix(0.42, 0.12, smoothstep(150.0, 7000.0, dist));
        vec3 n = normalize(vec3(t.x * k, 1.0, t.y * k));
        vec3 r = reflect(-view, n);
        r.y = abs(r.y);
        vec3 skyRefl = mix(uHaze, uZenith, pow(clamp(r.y, 0.0, 1.0), 0.45));
        float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, view), 0.0), 5.0);
        float deep = smoothstep(uShore + 10.0, uShore + 900.0, vWorld.x);
        vec3 body = mix(vec3(0.035, 0.20, 0.22), vec3(0.006, 0.03, 0.055), deep);
        body *= (0.55 + 0.45 * max(uSun.y, 0.0)) * uLake;
        vec3 col = mix(body, skyRefl, fres);
        float rs = max(dot(r, uSun), 0.0);
        col += uGlint * pow(rs, 900.0);
        col += uGlint * 0.0178 * pow(rs, 28.0);
        float shore = smoothstep(uShore + 55.0, uShore - 2.0, vWorld.x);
        float breakers = texture2D(uNormals, p / 14.0 + vec2(uTime * 0.03, 0.0)).r;
        float foam = shore * smoothstep(0.45, 0.8, breakers + shore * 0.35) * (1.0 - smoothstep(600.0, 2500.0, dist));
        col = mix(col, uFoam, foam * 0.8);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        float fog = clamp((dist - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, uFogColor, fog);
      }`,
  });
  return { material, uniforms };
}
