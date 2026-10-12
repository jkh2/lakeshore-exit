import * as THREE from "three";

// A 9-cell ram-air canopy built in code so it can inflate, flare and turn.
// Coordinates are relative to the jumper: +y up, -z forward.

const CELLS = 9;
const RIBS = CELLS * 2 + 1;
const SEG_PER_RIB = 4;
const NS = (RIBS - 1) * SEG_PER_RIB;
const NC = 22;
const SPAN = 6.4;
const CHORD = 2.45;
const ARC = 0.5;
const THICK = 0.16;
const HEIGHT = 3.55;
const FORWARD = -0.5;
const TRIM = -0.11;
const INLET = 0.08;
const ROWS = [0.05, 0.3, 0.56, 0.84];

const MAIN = ["#b8262a", "#f2f4f6", "#b8262a", "#f2f4f6", "#24467a", "#f2f4f6", "#b8262a", "#f2f4f6", "#b8262a"];
const RESERVE = ["#e8a317", "#e8a317", "#f2f4f6", "#e8a317", "#e8a317", "#e8a317", "#f2f4f6", "#e8a317", "#e8a317"];

const RISER_FRONT = 0.07;
const RISER_TOP_Y = 1.05;
const RISER_X = 0.24;

/** Eye height above the canopy group's origin. */
export const CANOPY_EYE_Y = 0.62;

/** Where a brake toggle sits for a given brake input, in canopy-group space. */
export function togglePosition(out: THREE.Vector3, side: -1 | 1, brake: number) {
  return out.set(side * (RISER_X + 0.02 + brake * 0.04), RISER_TOP_Y - 0.22 - brake * 1.0, RISER_FRONT + 0.03 - brake * 0.28);
}

function upper(c: number) {
  const t = THICK;
  return 5 * t * (0.2969 * Math.sqrt(c) - 0.126 * c - 0.3516 * c * c + 0.2843 * c ** 3 - 0.1036 * c ** 4);
}
const UPPER_MAX = upper(0.3);

function lower(c: number) {
  return -0.2 * upper(c) - 0.012 * Math.sin(Math.PI * c);
}

function ripstop() {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const g = c.getContext("2d");
  if (!g) return null;
  g.fillStyle = "#808080";
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = "#a0a0a0";
  for (let i = 0; i < 64; i += 8) {
    g.fillRect(i, 0, 1, 64);
    g.fillRect(0, i, 64, 1);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export type Canopy = {
  group: THREE.Group;
  /** open 0..1 inflation, brakes 0..1 per side. */
  update: (open: number, brakeL: number, brakeR: number) => void;
  setReserve: (reserve: boolean) => void;
  dispose: () => void;
};

/** Nine cell colors, left to right. */
export function createCanopy(colors: readonly string[] = MAIN): Canopy {
  const group = new THREE.Group();
  const bump = ripstop();

  const surfVerts = (NS + 1) * (NC + 1);
  const ribVerts = RIBS * (NC + 1) * 2;
  const total = surfVerts * 2 + ribVerts;
  const position = new Float32Array(total * 3);
  const color = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  const index: number[] = [];
  const top = 0;
  const bot = surfVerts;
  const rib0 = surfVerts * 2;
  for (const base of [top, bot]) {
    for (let i = 0; i < NS; i++) {
      for (let j = 0; j < NC; j++) {
        const a = base + i * (NC + 1) + j;
        const b = a + NC + 1;
        if (base === top) index.push(a, a + 1, b, b, a + 1, b + 1);
        else index.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
  }
  for (let r = 0; r < RIBS; r++) {
    const base = rib0 + r * (NC + 1) * 2;
    for (let j = 0; j < NC; j++) {
      const a = base + j * 2;
      index.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(position, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(color, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geo.setIndex(index);
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    roughness: 0.72,
    metalness: 0,
    bumpMap: bump ?? undefined,
    bumpScale: 0.6,
  });
  // Sunlit nylon glows through from above, so the underside never goes black.
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <emissivemap_fragment>",
      "#include <emissivemap_fragment>\n  totalEmissiveRadiance += vColor.rgb * 0.32;",
    );
  };
  const wing = new THREE.Mesh(geo, mat);
  wing.frustumCulled = false;
  group.add(wing);

  // Lines: per loaded rib, rows A-B and C-D cascade, then run to the risers.
  const loaded: number[] = [];
  for (let r = 0; r < RIBS; r += 2) loaded.push(r);
  const brakeRibs = [0, 1, 2, 3, 4, RIBS - 5, RIBS - 4, RIBS - 3, RIBS - 2, RIBS - 1];
  const lineCount = loaded.length * 6 + brakeRibs.length + 2 + 8;
  const linePos = new Float32Array(lineCount * 6);
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute("position", new THREE.BufferAttribute(linePos, 3));
  const lineMat = new THREE.LineBasicMaterial({ color: "#d8d2c4", transparent: true, opacity: 0.85 });
  const lines = new THREE.LineSegments(lineGeo, lineMat);
  lines.frustumCulled = false;
  group.add(lines);

  const strapMat = new THREE.MeshStandardMaterial({ color: "#1d232a", roughness: 0.8 });
  const toggleMat = new THREE.MeshStandardMaterial({ color: "#e8a317", roughness: 0.6 });
  const straps: THREE.Mesh[] = [];
  const toggles: THREE.Mesh[] = [];
  for (const side of [-1, 1]) {
    for (const fz of [-RISER_FRONT, RISER_FRONT]) {
      const strap = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.6, 0.007), strapMat);
      strap.position.set(side * (RISER_X - 0.03), RISER_TOP_Y - 0.3, fz);
      strap.rotation.z = side * 0.06;
      group.add(strap);
      straps.push(strap);
    }
    const toggle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.11, 0.05), toggleMat);
    group.add(toggle);
    toggles.push(toggle);
  }
  const slider = new THREE.Mesh(
    new THREE.PlaneGeometry(0.34, 0.2),
    new THREE.MeshStandardMaterial({ color: "#3a4656", roughness: 0.8, side: THREE.DoubleSide, transparent: true, opacity: 0.7 }),
  );
  slider.rotation.x = -Math.PI / 2;
  group.add(slider);

  const trim = new THREE.Matrix4().makeRotationX(TRIM);
  const p = new THREE.Vector3();
  const col = new THREE.Color();
  let palette = colors;
  let colorsDirty = true;
  let last = [-1, -1, -1];

  // A point on the wing: s across the span (-1..1), c along the chord (0 nose .. 1 tail).
  function wingPoint(out: THREE.Vector3, s: number, c: number, side: 1 | -1 | 0, open: number, brakeL: number, brakeR: number) {
    const arc = ARC * (0.35 + 0.65 * open);
    const span = SPAN * (0.3 + 0.7 * open);
    const R = span / 2 / Math.sin(arc);
    const th = s * arc;
    const nx = Math.sin(th);
    const ny = Math.cos(th);
    const chord = CHORD * (1 - 0.13 * s * s) * (0.65 + 0.35 * open);
    const thick = 0.35 + 0.65 * open;
    const r = ((s + 1) / 2) * (RIBS - 1);
    const frac = r - Math.floor(r);
    const pillow = Math.sin(Math.PI * frac) * 0.045 * open;
    let h = 0;
    if (side === 1) h = upper(c) * thick + pillow * (upper(c) / UPPER_MAX);
    else if (side === -1) h = lower(c) * thick - pillow * 0.35 * Math.sin(Math.PI * c);
    else h = 0;
    const brake = s < 0 ? brakeL : brakeR;
    const outer = 0.35 + 0.65 * Math.abs(s);
    const deflect = c > 0.62 ? -brake * ((c - 0.62) / 0.38) ** 2 * 0.3 * outer : 0;
    const y = R * (ny - 1) + (h * chord + deflect) * ny;
    const x = R * nx + (h * chord + deflect) * nx;
    const z = (c - 0.42) * chord;
    out.set(x, y, z).applyMatrix4(trim);
    out.y += HEIGHT * (0.55 + 0.45 * open);
    out.z += FORWARD;
    return out;
  }

  function rebuild(open: number, brakeL: number, brakeR: number) {
    for (const [base, side] of [
      [top, 1],
      [bot, -1],
    ] as const) {
      for (let i = 0; i <= NS; i++) {
        const s = (i / NS) * 2 - 1;
        const cell = Math.min(CELLS - 1, Math.floor(((s + 1) / 2) * CELLS));
        if (colorsDirty) col.set(palette[cell] ?? "#ffffff");
        for (let j = 0; j <= NC; j++) {
          let c = j / NC;
          c = c * c * (side === -1 ? 1 - INLET : 1) + (side === -1 ? INLET : 0);
          if (side === 1) c = (j / NC) ** 1.6;
          wingPoint(p, s, c, side, open, brakeL, brakeR);
          const k = base + i * (NC + 1) + j;
          position.set([p.x, p.y, p.z], k * 3);
          uv.set([s * 10, c * 4], k * 2);
          if (colorsDirty) {
            const shade = side === -1 ? 0.82 : 1;
            color.set([col.r * shade, col.g * shade, col.b * shade], k * 3);
          }
        }
      }
    }
    for (let r = 0; r < RIBS; r++) {
      const s = (r / (RIBS - 1)) * 2 - 1;
      const cell = Math.min(CELLS - 1, Math.floor(((s + 1) / 2) * CELLS));
      if (colorsDirty) col.set(palette[cell] ?? "#ffffff");
      const base = rib0 + r * (NC + 1) * 2;
      for (let j = 0; j <= NC; j++) {
        const cu = (j / NC) ** 1.6;
        const cl = INLET + (1 - INLET) * (j / NC) ** 2;
        wingPoint(p, s, cu, 1, open, brakeL, brakeR);
        position.set([p.x, p.y, p.z], (base + j * 2) * 3);
        wingPoint(p, s, Math.max(cu, cl), -1, open, brakeL, brakeR);
        position.set([p.x, p.y, p.z], (base + j * 2 + 1) * 3);
        uv.set([0, cu * 4], (base + j * 2) * 2);
        uv.set([0, cl * 4], (base + j * 2 + 1) * 2);
        if (colorsDirty) {
          color.set([col.r * 0.7, col.g * 0.7, col.b * 0.7], (base + j * 2) * 3);
          color.set([col.r * 0.7, col.g * 0.7, col.b * 0.7], (base + j * 2 + 1) * 3);
        }
      }
    }
    geo.attributes.position!.needsUpdate = true;
    geo.attributes.uv!.needsUpdate = true;
    if (colorsDirty) geo.attributes.color!.needsUpdate = true;
    colorsDirty = false;
    geo.computeVertexNormals();
    geo.computeBoundingSphere();

    const sliderY = THREE.MathUtils.lerp(HEIGHT * 0.6, RISER_TOP_Y + 0.08, Math.min(1, open * 1.15));
    slider.position.set(0, sliderY, 0);
    const sliderScale = THREE.MathUtils.lerp(2.8, 1, Math.min(1, open * 1.15));
    slider.scale.set(sliderScale, sliderScale, 1);

    let n = 0;
    const seg = (a: THREE.Vector3, b: THREE.Vector3) => {
      linePos.set([a.x, a.y, a.z, b.x, b.y, b.z], n * 6);
      n++;
    };
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const casc = new THREE.Vector3();
    const riser = new THREE.Vector3();
    for (const r of loaded) {
      const s = (r / (RIBS - 1)) * 2 - 1;
      const sideX = s < 0 ? -RISER_X : RISER_X;
      for (const pair of [
        [0, 1],
        [2, 3],
      ]) {
        const front = pair[0] === 0;
        riser.set(sideX, RISER_TOP_Y, front ? -RISER_FRONT : RISER_FRONT);
        wingPoint(a, s, ROWS[pair[0]!]!, -1, open, brakeL, brakeR);
        wingPoint(b, s, ROWS[pair[1]!]!, -1, open, brakeL, brakeR);
        casc.addVectors(a, b).multiplyScalar(0.5).lerp(riser, 0.32);
        seg(a, casc);
        seg(b, casc);
        seg(casc, riser);
      }
    }
    for (const side of [-1, 1] as const) {
      const brake = side < 0 ? brakeL : brakeR;
      const hand = togglePosition(new THREE.Vector3(), side, brake);
      const toggle = toggles[side < 0 ? 0 : 1];
      if (toggle) toggle.position.copy(hand);
      riser.set(side * RISER_X, RISER_TOP_Y, RISER_FRONT + 0.02);
      const ribs = brakeRibs.filter((r) => (side < 0 ? r < RIBS / 2 : r > RIBS / 2));
      const cascade = new THREE.Vector3();
      wingPoint(cascade, side * 0.78, 1, 0, open, brakeL, brakeR);
      cascade.lerp(riser, 0.38);
      for (const r of ribs) {
        const s = (r / (RIBS - 1)) * 2 - 1;
        wingPoint(a, s, 1, 0, open, brakeL, brakeR);
        seg(a, cascade);
      }
      seg(cascade, hand);
    }
    while (n < lineCount) {
      linePos.set([0, 0, 0, 0, 0, 0], n * 6);
      n++;
    }
    lineGeo.attributes.position!.needsUpdate = true;
    lineGeo.computeBoundingSphere();
  }

  return {
    group,
    update(open: number, brakeL: number, brakeR: number) {
      const o = Math.round(open * 200) / 200;
      const l = Math.round(brakeL * 100) / 100;
      const r = Math.round(brakeR * 100) / 100;
      if (!colorsDirty && o === last[0] && l === last[1] && r === last[2]) return;
      last = [o, l, r];
      rebuild(o, l, r);
    },
    setReserve(reserve: boolean) {
      const next = reserve ? RESERVE : colors;
      if (next === palette) return;
      palette = next;
      colorsDirty = true;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      bump?.dispose();
      lineGeo.dispose();
      lineMat.dispose();
      strapMat.dispose();
      toggleMat.dispose();
      straps.forEach((s) => s.geometry.dispose());
      toggles.forEach((t) => t.geometry.dispose());
      slider.geometry.dispose();
      (slider.material as THREE.Material).dispose();
    },
  };
}
