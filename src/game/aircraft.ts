import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

// Aircraft for the sky over the city, each a single geometry with RGBA vertex colors and no
// UVs, so a whole fleet of one type draws as one instanced mesh. Every one is built flying
// toward -z with its wings along x and its belly down, its middle about the origin.

export type Rgb = readonly [number, number, number];
type Paint = Rgb | ((x: number, y: number, z: number) => Rgb);

export const rgb = (hex: string): Rgb => {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
};

/** Colors a shape per vertex, drops its UVs and unshares its vertices, ready to merge. */
function paint(g: THREE.BufferGeometry, color: Paint, alpha = 1) {
  const flat = g.index ? g.toNonIndexed() : g;
  if (flat !== g) g.dispose();
  const pos = flat.getAttribute("position");
  const c = new Float32Array(pos.count * 4);
  for (let i = 0; i < pos.count; i++) {
    const col = typeof color === "function" ? color(pos.getX(i), pos.getY(i), pos.getZ(i)) : color;
    c.set([col[0], col[1], col[2], alpha], i * 4);
  }
  flat.setAttribute("color", new THREE.Float32BufferAttribute(c, 4));
  if (flat.getAttribute("uv")) flat.deleteAttribute("uv");
  return flat;
}

export function merge(parts: THREE.BufferGeometry[]) {
  const g = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  if (!g) throw new Error("aircraft: geometry merge failed");
  return g;
}

export function block(
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  color: Paint,
) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return paint(g, color);
}

/** A round body along z, `nose` radius at its front (-z) and `tail` at its back. */
export function tube(
  nose: number,
  tail: number,
  len: number,
  x: number,
  y: number,
  z: number,
  color: Paint,
  seg = 12,
) {
  const g = new THREE.CylinderGeometry(tail, nose, len, seg);
  g.rotateX(Math.PI / 2);
  g.translate(x, y, z);
  return paint(g, color);
}

/** An ellipsoid with half-sizes rx, ry, rz. */
export function blob(
  rx: number,
  ry: number,
  rz: number,
  x: number,
  y: number,
  z: number,
  color: Paint,
) {
  const g = new THREE.SphereGeometry(1, 12, 8);
  g.scale(rx, ry, rz);
  g.translate(x, y, z);
  return paint(g, color);
}

/**
 * A wing or tail surface: `span` tip to tip across x, tapering from the `root` chord to the
 * `tip` chord, its leading edge swept back by `sweep` radians. With `half`, one panel only,
 * its root at x = 0 and its tip at x = span. Positioned by its root's middle.
 */
export function surface(
  span: number,
  root: number,
  tip: number,
  sweep: number,
  thick: number,
  x: number,
  y: number,
  z: number,
  color: Paint,
  half = false,
) {
  const g = new THREE.BoxGeometry(span, thick, root, half ? 4 : 8, 1, 1);
  const pos = g.getAttribute("position");
  const reach = half ? span : span / 2;
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i);
    // How far out along the span, and how far back along the chord.
    const u = half ? (px + span / 2) / span : Math.abs(px) / reach;
    const back = (pos.getZ(i) + root / 2) / root;
    const chord = THREE.MathUtils.lerp(root, tip, u);
    pos.setZ(i, -root / 2 + u * reach * Math.tan(sweep) + back * chord);
    pos.setY(i, pos.getY(i) * THREE.MathUtils.lerp(1, 0.55, u));
    if (half) pos.setX(i, px + span / 2);
  }
  g.computeVertexNormals();
  g.translate(x, y, z);
  return paint(g, color);
}

/** A fin standing up from (x, y, z): `height` tall, raked back by `sweep`, canted out by `cant`. */
export function fin(
  height: number,
  root: number,
  tip: number,
  sweep: number,
  thick: number,
  x: number,
  y: number,
  z: number,
  color: Paint,
  cant = 0,
) {
  const g = surface(height, root, tip, sweep, thick, 0, 0, 0, color, true);
  g.rotateZ(Math.PI / 2 - cant);
  g.translate(x, y, z);
  return g;
}

const WHITE = rgb("#f3f5f7");
const BELLY = rgb("#c3c8ce");
const WING = rgb("#b9bec5");
const GLASS = rgb("#1c2733");
const DARK = rgb("#2a2f36");
const METAL = rgb("#8f969e");

/** Half the span of the airliner's wing, and how far back its swept tips sit. */
export const AIRLINER_TIP = { x: 17, y: -1.1, z: 1 + 16.5 * Math.tan(0.44) };

/**
 * A narrow-body airliner, about 38 m long with a 34 m span. Two parts: the white airframe,
 * and the airline's colors (tail and cheatline) in white to tint per instance.
 */
export function airliner() {
  const fuselage = (_x: number, y: number): Rgb => (y < -0.5 ? BELLY : WHITE);
  const body = merge([
    tube(1.95, 1.95, 24, 0, 0, -1, fuselage, 14),
    tube(1.15, 1.95, 3.6, 0, -0.12, -14.8, fuselage, 14),
    blob(1.15, 1.1, 2.2, 0, -0.22, -16.6, fuselage),
    tube(1.95, 0.4, 8, 0, 0.55, 15, fuselage, 14),
    // Cockpit glass and the row of cabin windows.
    block(2.3, 0.4, 1.1, 0, 0.62, -15.4, GLASS),
    block(3.96, 0.32, 21, 0, 0.42, -2, GLASS),
    surface(34, 6.4, 1.6, 0.44, 0.5, 0, -1.1, 0.8, WING),
    surface(12.4, 3.4, 1.2, 0.52, 0.26, 0, 0.75, 16.4, WING),
    tube(1.05, 0.95, 4.3, -5.8, -2.15, -2.4, METAL),
    tube(1.05, 0.95, 4.3, 5.8, -2.15, -2.4, METAL),
    block(0.3, 1.0, 2.6, -5.8, -1.45, -1.6, WING),
    block(0.3, 1.0, 2.6, 5.8, -1.45, -1.6, WING),
    block(1.6, 0.16, 0.16, -5.8, -2.15, -4.6, DARK),
    block(1.6, 0.16, 0.16, 5.8, -2.15, -4.6, DARK),
  ]);
  const colors = merge([
    fin(6.6, 5.4, 1.9, 0.68, 0.32, 0, 1.6, 13.6, WHITE),
    block(3.98, 0.34, 25, 0, -0.32, -0.5, WHITE),
  ]);
  return { body, colors };
}

/** Nav lights for an airliner at night: red left tip, green right, white tail, red beacon. */
export function airlinerLights() {
  const t = AIRLINER_TIP;
  return merge([
    block(0.9, 0.9, 0.9, -t.x, t.y, t.z, [1, 0.1, 0.08]),
    block(0.9, 0.9, 0.9, t.x, t.y, t.z, [0.1, 1, 0.3]),
    block(0.8, 0.8, 0.8, 0, 0.6, 19.2, [1, 1, 1]),
    block(0.7, 0.4, 0.7, 0, -2.1, 0, [1, 0.15, 0.1]),
    // Landing lights in the wing roots.
    block(0.8, 0.5, 0.5, -2.6, -1.3, -2.2, [1, 0.95, 0.85]),
    block(0.8, 0.5, 0.5, 2.6, -1.3, -2.2, [1, 0.95, 0.85]),
  ]);
}

/**
 * A contrail behind a high airliner, `len` meters long: two crossed ribbons, thin and dense at
 * the engines and spreading and fading behind. RGBA, for an additive or plain transparent pass.
 */
export function contrail(len: number) {
  const seg = 28;
  const pos: number[] = [];
  const col: number[] = [];
  const start = 26;
  for (let flat = 0; flat < 2; flat++) {
    for (let i = 0; i < seg; i++) {
      const u0 = i / seg;
      const u1 = (i + 1) / seg;
      const ring = (u: number) => {
        const z = start + u ** 1.15 * len;
        const w = 1.5 + u * 60;
        const a = 0.55 * Math.min(1, u * 40) * (1 - u) ** 1.4;
        return { z, w, a };
      };
      const p = ring(u0);
      const q = ring(u1);
      const corner = (s: number, r: { z: number; w: number; a: number }) => {
        if (flat) pos.push(s * r.w * 0.5, -1.4, r.z);
        else pos.push(0, -1.4 + s * r.w * 0.35, r.z);
        col.push(1, 1, 1, r.a);
      };
      corner(-1, p);
      corner(1, p);
      corner(1, q);
      corner(-1, p);
      corner(1, q);
      corner(-1, q);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 4));
  g.computeVertexNormals();
  return g;
}

/**
 * A single-engine high-wing light plane, 8 m long with an 11 m span: the white airframe, and
 * a stripe in white to tint.
 */
export function lightPlane() {
  const body = merge([
    tube(0.55, 0.62, 3.2, 0, 0, -1.4, WHITE, 10),
    tube(0.62, 0.2, 4.2, 0, 0.12, 2.3, WHITE, 10),
    tube(0.18, 0.55, 0.8, 0, -0.02, -3.4, METAL, 10),
    block(1.12, 0.5, 1.3, 0, 0.42, -1.8, GLASS),
    surface(11, 1.6, 1.15, 0, 0.16, 0, 0.82, -1.0, WHITE),
    surface(3.6, 1.0, 0.7, 0.1, 0.1, 0, 0.18, 4.0, WHITE),
    fin(1.4, 1.3, 0.7, 0.6, 0.1, 0, 0.3, 3.9, WHITE),
    // Struts, wheels and the spinner.
    block(0.06, 1.0, 0.1, -1.5, 0.15, -1.1, METAL),
    block(0.06, 1.0, 0.1, 1.5, 0.15, -1.1, METAL),
    block(0.18, 0.4, 0.4, -0.9, -0.95, -1.0, DARK),
    block(0.18, 0.4, 0.4, 0.9, -0.95, -1.0, DARK),
    block(0.16, 0.36, 0.36, 0, -0.92, -3.0, DARK),
  ]);
  const colors = merge([
    block(1.28, 0.16, 6.5, 0, -0.12, 0.2, WHITE),
    block(5.2, 0.17, 0.5, -2.9, 0.82, -1.55, WHITE),
    block(5.2, 0.17, 0.5, 2.9, 0.82, -1.55, WHITE),
  ]);
  return { body, colors };
}

/** A blurred propeller disk in front of a light plane's nose, to draw see-through. */
export function propDisk() {
  const g = new THREE.CircleGeometry(0.95, 18);
  g.translate(0, -0.02, -3.86);
  return paint(g, [0.25, 0.27, 0.3], 0.35);
}

/** The air show team's jet, 15 m long with a 10 m span, in Chicago flag colors. */
export function showJet() {
  const SKY = rgb("#41b6e6");
  const RED = rgb("#d6202f");
  const hull = (_x: number, y: number): Rgb => (y > 0.35 ? SKY : WHITE);
  return merge([
    tube(0.78, 0.82, 7.5, 0, 0, 0.2, hull, 12),
    tube(0.12, 0.78, 3.8, 0, -0.05, -5.5, WHITE, 12),
    tube(0.82, 0.6, 3.4, 0, 0.02, 5.6, hull, 12),
    blob(0.5, 0.42, 1.5, 0, 0.62, -3.6, GLASS),
    // Intakes either side behind the cockpit.
    block(0.5, 0.9, 2.6, -0.95, -0.12, -1.4, METAL),
    block(0.5, 0.9, 2.6, 0.95, -0.12, -1.4, METAL),
    surface(10, 5.4, 1.4, 0.62, 0.22, 0, -0.1, 1.6, (x) => (Math.abs(x) > 4.2 ? RED : WHITE)),
    surface(4.6, 2.0, 1.0, 0.55, 0.14, 0, 0.05, 6.4, WHITE),
    fin(2.6, 2.6, 1.0, 0.7, 0.14, -0.75, 0.55, 5.3, RED, -0.35),
    fin(2.6, 2.6, 1.0, 0.7, 0.14, 0.75, 0.55, 5.3, RED, 0.35),
    tube(0.55, 0.48, 0.8, 0, 0, 7.5, DARK, 12),
  ]);
}
