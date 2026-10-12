import * as THREE from "three";
import { RUN_X } from "./constants";
import { HAZE_SRGB, SUN_DIR, rng, valueNoise } from "./world";

// A scattered deck of cumulus built from soft, camera-facing puffs. From the plane it is a
// field of clouds below; in freefall you fall past and through them. Inside one, a veil
// just beyond arm's length whites out the view while your own arms and anyone holding on
// to you stay in sight.

/** Cloud bases, in meters (about 6,100 ft). */
export const CLOUD_BASE = 1850;
/** How far in front of the eye the whiteout veil sits: past your arms and your neighbors. */
const VEIL_DIST = 1.6;

type Puff = {
  center: THREE.Vector3;
  size: number;
  light: number;
  variant: number;
  rot: number;
  alpha: number;
  dist: number;
};

type Cloud = { center: THREE.Vector3; reach: number; puffs: Puff[] };

export type CloudField = {
  /** Places the puffs and the veil for this camera and returns how deep in cloud it is, 0 to 1. */
  update: (camera: THREE.PerspectiveCamera, fogNear: number, fogFar: number) => number;
  dispose: () => void;
};

/** Wispy high cirrus, stretched along the wind and fading out toward the edges. */
function cirrusTexture(seed: number) {
  const size = 512;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const g = c.getContext("2d");
  if (!g) return null;
  const n = valueNoise(seed);
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      let f = 0;
      let amp = 0.5;
      let fx = 3;
      let fy = 14;
      for (let o = 0; o < 5; o++) {
        f += n(u * fx + o * 13, v * fy) * amp;
        amp *= 0.5;
        fx *= 2;
        fy *= 2;
      }
      const edge = Math.max(0, 1 - Math.hypot(u - 0.5, v - 0.5) * 2.1);
      const a = Math.max(0, Math.min(1, (f - 0.5) * 3.2)) * edge * edge;
      const i = (y * size + x) * 4;
      img.data[i] = 255;
      img.data[i + 1] = 255;
      img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(a * 255);
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Four soft puff shapes in a 2x2 atlas. Alpha is density; red carries detail for shading. */
function puffAtlas(seed: number) {
  const cell = 128;
  const size = cell * 2;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const g = c.getContext("2d");
  if (!g) return null;
  const img = g.createImageData(size, size);
  for (let v = 0; v < 4; v++) {
    const n = valueNoise(seed + v * 31);
    const ox = (v % 2) * cell;
    const oy = Math.floor(v / 2) * cell;
    for (let y = 0; y < cell; y++) {
      for (let x = 0; x < cell; x++) {
        const u = (x + 0.5) / cell - 0.5;
        const w = (y + 0.5) / cell - 0.5;
        let f = 0;
        let amp = 0.5;
        let freq = 4;
        for (let o = 0; o < 4; o++) {
          f += n(u * freq + 7, w * freq + 3) * amp;
          amp *= 0.5;
          freq *= 2;
        }
        const r = Math.hypot(u, w) * 2;
        const dens = Math.max(0, Math.min(1, (1 - r) * 2.1 + (f - 0.5) * 1.3));
        const i = ((oy + y) * size + ox + x) * 4;
        img.data[i] = Math.round(f * 255);
        img.data[i + 1] = 255;
        img.data[i + 2] = 255;
        img.data[i + 3] = Math.round(dens * dens * (3 - 2 * dens) * 255);
      }
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

function buildClouds(seed: number, detail: number): Cloud[] {
  const r = rng(seed);
  const clouds: Cloud[] = [];
  // One big cloud sits under the usual freefall from the jump run, so most jumps pass
  // through or right beside it. The rest scatter around with clear gaps between them.
  const spots: [number, number, number][] = [[RUN_X - 90, -30, 230]];
  for (let tries = 0; spots.length < 22 && tries < 400; tries++) {
    const x = -1700 + r() * 4400;
    const z = -2700 + r() * 5400;
    const rad = 110 + r() * 170;
    if (spots.every(([sx, sz, sr]) => Math.hypot(sx - x, sz - z) > sr + rad + 120))
      spots.push([x, z, rad]);
  }
  for (const [x, z, rad] of spots) {
    const height = rad * (0.5 + r() * 0.35);
    const base = CLOUD_BASE + (r() - 0.5) * 90;
    const center = new THREE.Vector3(x, base + height * 0.45, z);
    const puffs: Puff[] = [];
    const count = Math.round((20 + rad / 5) * detail);
    for (let i = 0; i < count; i++) {
      const a = r() * Math.PI * 2;
      const d = Math.sqrt(r()) * rad * 0.9;
      // Domed top, flat base: puffs reach higher toward the middle.
      const top = height * Math.sqrt(Math.max(0, 1 - (d / rad) ** 2));
      // Fewer puffs on a small screen, each a little bigger to keep the clouds full.
      const size = (rad * (0.26 + r() * 0.22) * (1 - (d / rad) * 0.3)) / Math.sqrt(detail);
      const y = base + size * 0.35 + r() * Math.max(0, top - size * 0.5);
      const p = new THREE.Vector3(x + Math.cos(a) * d, y, z + Math.sin(a) * d);
      const off = p.clone().sub(center).normalize();
      const h = (y - base) / height;
      puffs.push({
        center: p,
        size,
        light: Math.min(1, Math.max(0, 0.18 + 0.38 * (0.5 + 0.5 * off.dot(SUN_DIR)) + 0.5 * h)),
        variant: Math.floor(r() * 4),
        rot: r() * Math.PI * 2,
        alpha: 0.75 + r() * 0.25,
        dist: 0,
      });
    }
    clouds.push({ center, reach: rad + height, puffs });
  }
  return clouds;
}

/** `detail` scales the puff count: 1 on a desktop, less on a phone to spare its GPU. */
export function createCloudField(scene: THREE.Scene, detail = 1): CloudField {
  const clouds = buildClouds(73, detail);
  const puffs = clouds.flatMap((c) => c.puffs);
  const n = puffs.length;
  const tex = puffAtlas(73);

  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3),
  );
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  const iCenter = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
  // size, light, variant, rotation, alpha, base height
  const iData = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
  const iMore = new THREE.InstancedBufferAttribute(new Float32Array(n * 2), 2);
  for (const a of [iCenter, iData, iMore]) a.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute("iCenter", iCenter);
  geo.setAttribute("iData", iData);
  geo.setAttribute("iMore", iMore);
  geo.instanceCount = n;
  const baseOf = new Map<Puff, number>();
  for (const c of clouds) {
    const base = Math.min(...c.puffs.map((p) => p.center.y - p.size * 0.35));
    for (const p of c.puffs) baseOf.set(p, base);
  }

  const uniforms = {
    uTex: { value: tex },
    uSun: { value: SUN_DIR.clone() },
    uFogColor: { value: HAZE_SRGB.clone() },
    uFogNear: { value: 500 },
    uFogFar: { value: 16000 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    fog: false,
    vertexShader: `attribute vec3 iCenter; attribute vec4 iData; attribute vec2 iMore;
      uniform vec3 uSun;
      varying vec2 vUv; varying vec2 vDir; varying vec2 vSun; varying float vLight;
      varying float vAlpha; varying float vWorldY; varying float vBase; varying float vDist;
      void main(){
        float size = iData.x;
        float c = cos(iData.w);
        float s = sin(iData.w);
        vec2 corner = position.xy;
        vec2 rc = vec2(c * corner.x - s * corner.y, s * corner.x + c * corner.y);
        vec4 mv = viewMatrix * vec4(iCenter, 1.0);
        float dist = length(mv.xyz);
        // Fade a puff out as you enter it; the veil takes over from there.
        float near = smoothstep(size * 0.15, size * 0.75, dist);
        mv.xy += rc * size;
        vec3 worldOff = vec3(rc * size, 0.0) * mat3(viewMatrix);
        vWorldY = iCenter.y + worldOff.y;
        vBase = iMore.y;
        float v = iData.z;
        vUv = (corner * 0.5 + 0.5) * 0.5 + vec2(mod(v, 2.0), floor(v / 2.0)) * 0.5;
        vDir = rc;
        vec3 sunView = (viewMatrix * vec4(uSun, 0.0)).xyz;
        vSun = normalize(sunView.xy + 1e-4) * (1.0 - abs(sunView.z) * 0.5);
        vLight = iData.y;
        vAlpha = iMore.x * near;
        vDist = length(mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform sampler2D uTex; uniform vec3 uFogColor; uniform float uFogNear; uniform float uFogFar;
      varying vec2 vUv; varying vec2 vDir; varying vec2 vSun; varying float vLight;
      varying float vAlpha; varying float vWorldY; varying float vBase; varying float vDist;
      void main(){
        vec4 t = texture2D(uTex, vUv);
        float a = t.a * vAlpha * smoothstep(vBase - 4.0, vBase + 26.0, vWorldY);
        if (a < 0.004) discard;
        float lit = clamp(vLight + 0.24 * dot(vDir, vSun) + (t.r - 0.5) * 0.3, 0.0, 1.0);
        vec3 col = mix(vec3(0.42, 0.48, 0.58), vec3(1.1, 1.06, 1.0), lit);
        gl_FragColor = vec4(col, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        float fog = clamp((vDist - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, uFogColor, fog);
      }`,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  scene.add(mesh);

  // The veil: a quad just past arm's length, brighter at the top like light through cloud.
  const veilGeo = new THREE.PlaneGeometry(1, 1);
  const veilColors = [0.93, 0.95, 0.97, 0.93, 0.95, 0.97, 0.74, 0.78, 0.83, 0.74, 0.78, 0.83];
  veilGeo.setAttribute("color", new THREE.Float32BufferAttribute(veilColors, 3));
  const veilMat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
  const veil = new THREE.Mesh(veilGeo, veilMat);
  veil.frustumCulled = false;
  veil.renderOrder = 10;
  scene.add(veil);

  // Cirrus far above the jump plane, for something to look up at.
  const cirrusTex = cirrusTexture(19);
  const cirrusGeo = new THREE.PlaneGeometry(26000, 26000);
  const cirrusMat = new THREE.MeshBasicMaterial({
    map: cirrusTex,
    color: "#f4f7fb",
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
    fog: false,
    side: THREE.DoubleSide,
  });
  const cirrus = new THREE.Mesh(cirrusGeo, cirrusMat);
  cirrus.rotation.x = Math.PI / 2;
  cirrus.rotation.z = 0.35;
  cirrus.position.set(600, 6400, 0);
  scene.add(cirrus);

  const order = puffs.slice();
  const lastSort = new THREE.Vector3(1e9, 0, 0);
  const fwd = new THREE.Vector3();

  function write() {
    for (let i = 0; i < n; i++) {
      const p = order[i]!;
      iCenter.setXYZ(i, p.center.x, p.center.y, p.center.z);
      iData.setXYZW(i, p.size, p.light, p.variant, p.rot);
      iMore.setXY(i, p.alpha, baseOf.get(p) ?? 0);
    }
    iCenter.needsUpdate = true;
    iData.needsUpdate = true;
    iMore.needsUpdate = true;
  }

  return {
    update(camera, fogNear, fogFar) {
      uniforms.uFogNear.value = fogNear;
      uniforms.uFogFar.value = fogFar;
      const eye = camera.position;
      // Back to front, so the nearer puffs blend over the farther ones.
      if (eye.distanceToSquared(lastSort) > 4) {
        lastSort.copy(eye);
        for (const p of order) p.dist = p.center.distanceToSquared(eye);
        order.sort((a, b) => b.dist - a.dist);
        write();
      }
      let clear = 1;
      for (const c of clouds) {
        if (c.center.distanceToSquared(eye) > c.reach * c.reach) continue;
        for (const p of c.puffs) {
          const r = p.size * 0.7;
          const d = p.center.distanceTo(eye);
          if (d > r) continue;
          const k = 1 - Math.min(1, Math.max(0, (d - r * 0.3) / (r * 0.7)));
          clear *= 1 - k * k * (3 - 2 * k) * p.alpha;
        }
      }
      const density = 1 - clear;
      veilMat.opacity = Math.min(0.94, density * 1.1);
      veil.visible = veilMat.opacity > 0.005;
      if (veil.visible) {
        camera.getWorldDirection(fwd);
        veil.position.copy(eye).addScaledVector(fwd, VEIL_DIST);
        veil.quaternion.copy(camera.quaternion);
        const h = 2 * VEIL_DIST * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * 1.25;
        veil.scale.set(h * camera.aspect * 1.25, h, 1);
      }
      return density;
    },
    dispose() {
      scene.remove(mesh, veil, cirrus);
      cirrusGeo.dispose();
      cirrusMat.dispose();
      cirrusTex?.dispose();
      geo.dispose();
      material.dispose();
      tex?.dispose();
      veilGeo.dispose();
      veilMat.dispose();
    },
  };
}
