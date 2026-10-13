import * as THREE from "three";
import { createBody, type Body, type BodyLook, type BodyPose } from "./body";

// The slow rides up: a helicopter hovering off the lakefront with its doors slid back, and
// hot-air balloons drifting in over the lake on the breeze. All geometry, like the plane.
// Each is built in its own frame with the floor at y = 0: the helicopter's nose toward -z,
// the balloon's basket centered on the origin.

/** Helicopter: you sit in the left door, legs out on the skid, looking out to the left. */
export const HELI_SEAT = new THREE.Vector3(-0.88, 0.92, 0.25);
export const HELI_SEAT_YAW = Math.PI / 2;
/** Where you leave the helicopter from: just outside the door, below the eyes. */
export const HELI_EXIT = new THREE.Vector3(-1.55, 0.25, 0.25);

/** Balloon: the part of the basket floor you can stand on, clear of the pilot and the tanks. */
export const BASKET = { x0: -0.6, x1: 0.02, z0: -0.6, z1: 0.6 };
/** Height of the basket's padded rim. */
export const RIM_Y = 1.1;

export type BalloonTheme = "chicago" | "sunrise" | "ocean" | "rainbow";

type Mat = THREE.Material;

function box(
  parent: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  mat: Mat,
) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

const _up = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();

/** A round bar from a to b. */
function rod(
  parent: THREE.Object3D,
  a: THREE.Vector3Like,
  b: THREE.Vector3Like,
  r: number,
  mat: Mat,
) {
  _dir.set(b.x - a.x, b.y - a.y, b.z - a.z);
  const len = _dir.length() || 1;
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 8), mat);
  mesh.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  mesh.quaternion.setFromUnitVectors(_up, _dir.multiplyScalar(1 / len));
  parent.add(mesh);
  return mesh;
}

function pose(mode: BodyPose["mode"]): BodyPose {
  return {
    mode,
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
  };
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
  return tex;
}

function freeAll(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mat of mats) {
      (mat as THREE.MeshStandardMaterial).map?.dispose();
      mat.dispose();
    }
  });
}

export type Heli = {
  group: THREE.Group;
  /** Spins the rotors and keeps the pilot flying; `thumbs` has him clear you to go. */
  update: (dt: number, time: number, thumbs: boolean) => void;
  dispose: () => void;
};

const HELI_PILOT: BodyLook = { suit: "#3d4a3a", suitDark: "#262f25", helmet: "#eef1f3" };

/** A Huey-style utility helicopter: big sliding doors, two-blade rotor, skids. */
export function createHeli(): Heli {
  const group = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({
    color: "#f1f4f6",
    roughness: 0.4,
    metalness: 0.2,
  });
  const red = new THREE.MeshStandardMaterial({
    color: "#c4322a",
    roughness: 0.45,
    metalness: 0.15,
  });
  const inner = new THREE.MeshStandardMaterial({ color: "#4a535b", roughness: 0.85 });
  const floor = new THREE.MeshStandardMaterial({ color: "#2b3138", roughness: 0.95 });
  const seat = new THREE.MeshStandardMaterial({ color: "#3a3f45", roughness: 0.8 });
  const dark = new THREE.MeshStandardMaterial({ color: "#1d2227", roughness: 0.5, metalness: 0.3 });
  const steel = new THREE.MeshStandardMaterial({
    color: "#aeb8c1",
    roughness: 0.35,
    metalness: 0.6,
  });
  const glass = new THREE.MeshStandardMaterial({
    color: "#7fa9bf",
    transparent: true,
    opacity: 0.32,
    roughness: 0.05,
    metalness: 0.4,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  // Cabin: floor, roof, the bench along the back wall, and the door frames, both doors open.
  box(group, 2.3, 0.08, 2.75, 0, -0.04, 0.1, floor);
  box(group, 2.2, 0.5, 3.05, 0, -0.33, 0.13, paint);
  box(group, 2.06, 0.04, 2.7, 0, 1.41, 0.1, inner);
  box(group, 2.3, 0.1, 2.9, 0, 1.48, 0.0, paint);
  box(group, 2.2, 1.45, 0.08, 0, 0.72, 1.5, inner);
  box(group, 1.96, 0.42, 0.45, 0, 0.21, 1.22, seat);
  box(group, 1.96, 0.6, 0.1, 0, 0.75, 1.42, seat);
  for (const s of [-1, 1]) {
    box(group, 0.1, 1.45, 0.14, s * 1.12, 0.72, -1.25, paint);
    box(group, 0.1, 1.45, 0.14, s * 1.12, 0.72, 1.48, paint);
    // The red stripe down the belly, and the door slid back along the tail.
    box(group, 0.03, 0.14, 3.0, s * 1.115, -0.2, 0.13, red);
    box(group, 0.05, 1.36, 1.3, s * 1.2, 0.7, 2.22, paint);
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 0.5), glass);
    pane.position.set(s * 1.23, 1.02, 2.22);
    pane.rotation.y = s * (Math.PI / 2);
    group.add(pane);
    // Grab handle inside the door frame.
    rod(group, { x: s * 1.05, y: 0.95, z: -1.18 }, { x: s * 1.05, y: 1.35, z: -1.18 }, 0.02, steel);
  }
  // Behind the cabin: the transmission bay and the engine on the roof, then the tail boom.
  box(group, 2.2, 1.55, 1.4, 0, 0.7, 2.25, paint);
  box(group, 1.3, 0.55, 3.4, 0, 1.8, 1.0, paint);
  const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.5, 12), dark);
  exhaust.rotation.x = Math.PI / 2;
  exhaust.position.set(0, 1.86, 2.85);
  group.add(exhaust);
  const boomGeo = new THREE.CylinderGeometry(0.2, 0.5, 7.6, 14);
  boomGeo.rotateX(Math.PI / 2);
  const boom = new THREE.Mesh(boomGeo, paint);
  boom.position.set(0, 1.05, 6.7);
  group.add(boom);
  const fin = box(group, 0.1, 1.6, 0.9, 0, 1.8, 10.35, red);
  fin.rotation.x = 0.35;
  box(group, 2.0, 0.06, 0.45, 0, 0.95, 7.3, paint);
  // A tail number down the boom.
  const tailTex = canvasTex(256, 64, (g) => {
    g.fillStyle = "#f1f4f6";
    g.fillRect(0, 0, 256, 64);
    g.fillStyle = "#1d2227";
    g.font = "700 44px sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("N312LX", 128, 34);
  });
  const tailMat = new THREE.MeshStandardMaterial({ map: tailTex, roughness: 0.45 });
  for (const s of [-1, 1]) {
    const tag = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.3), tailMat);
    tag.position.set(s * 0.44, 1.12, 4.4);
    tag.rotation.y = s * (Math.PI / 2);
    group.add(tag);
  }

  // Cockpit: a floor down in the chin, two seats, the panel, and a glass nose over a painted chin.
  box(group, 2.0, 0.08, 1.45, 0, -0.32, -2.0, floor);
  for (const s of [-1, 1]) {
    box(group, 0.48, 0.12, 0.5, s * 0.55, 0.42, -1.75, seat);
    box(group, 0.48, 0.62, 0.08, s * 0.55, 0.74, -1.47, seat);
  }
  const panel = box(group, 1.9, 0.38, 0.1, 0, 0.95, -2.45, dark);
  panel.rotation.x = -0.4;
  box(group, 0.32, 0.5, 0.9, 0, 0.28, -2.05, dark);
  const NOSE_Z = -1.3;
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(1.15, 22, 10, Math.PI, Math.PI, 0, Math.PI / 2),
    glass,
  );
  dome.scale.set(1, 0.92, 1.3);
  dome.position.set(0, 0.45, NOSE_Z);
  dome.renderOrder = 2;
  group.add(dome);
  const chinPaint = paint.clone();
  chinPaint.side = THREE.DoubleSide;
  const chin = new THREE.Mesh(
    new THREE.SphereGeometry(1.15, 22, 8, Math.PI, Math.PI, Math.PI / 2, Math.PI / 2),
    chinPaint,
  );
  chin.scale.set(1, 0.9, 1.3);
  chin.position.set(0, 0.45, NOSE_Z);
  group.add(chin);
  // The frame between the windscreens.
  rod(group, { x: 0, y: 1.5, z: -1.32 }, { x: 0, y: 0.5, z: -2.78 }, 0.03, dark);

  // Skids on bowed cross tubes, turned up at the front.
  for (const s of [-1, 1]) {
    rod(
      group,
      { x: s * 1.38, y: -0.68, z: -1.95 },
      { x: s * 1.38, y: -0.68, z: 2.15 },
      0.05,
      steel,
    );
    rod(
      group,
      { x: s * 1.38, y: -0.68, z: -1.95 },
      { x: s * 1.38, y: -0.45, z: -2.35 },
      0.05,
      steel,
    );
    for (const z of [-1.0, 1.2])
      rod(group, { x: s * 0.95, y: -0.45, z }, { x: s * 1.38, y: -0.68, z }, 0.045, steel);
  }

  // Main rotor: mast, hub, and two blades with fading copies behind them for the blur.
  rod(group, { x: 0, y: 2.05, z: 0.15 }, { x: 0, y: 2.66, z: 0.15 }, 0.09, dark);
  const rotor = new THREE.Group();
  rotor.position.set(0, 2.62, 0.15);
  group.add(rotor);
  box(rotor, 0.55, 0.14, 0.3, 0, 0, 0, dark);
  const bladeGeo = new THREE.BoxGeometry(14.6, 0.05, 0.53);
  [0.85, 0.35, 0.15].forEach((opacity, i) => {
    const mat = new THREE.MeshStandardMaterial({
      color: "#262a2f",
      roughness: 0.5,
      transparent: i > 0,
      opacity,
      depthWrite: i === 0,
    });
    const blade = new THREE.Mesh(bladeGeo, mat);
    blade.rotation.y = i * 0.13;
    rotor.add(blade);
  });
  // The blur of the blades: faint across the disc, darker toward the tips where they move fastest.
  const discTex = canvasTex(256, 256, (g) => {
    const grad = g.createRadialGradient(128, 128, 8, 128, 128, 127);
    grad.addColorStop(0, "rgba(40,44,50,0.05)");
    grad.addColorStop(0.8, "rgba(40,44,50,0.16)");
    grad.addColorStop(0.97, "rgba(40,44,50,0.3)");
    grad.addColorStop(1, "rgba(40,44,50,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
  });
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(7.3, 48),
    new THREE.MeshBasicMaterial({
      map: discTex,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  disc.rotation.x = -Math.PI / 2;
  disc.position.set(0, 2.62, 0.15);
  group.add(disc);
  // Tail rotor on the left of the fin.
  const tail = new THREE.Group();
  tail.position.set(-0.2, 2.15, 10.5);
  group.add(tail);
  box(
    tail,
    0.05,
    2.6,
    0.2,
    0,
    0,
    0,
    new THREE.MeshStandardMaterial({
      color: "#262a2f",
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    }),
  );
  const tailDisc = new THREE.Mesh(
    new THREE.CircleGeometry(1.3, 24),
    new THREE.MeshBasicMaterial({
      color: "#d7dee4",
      transparent: true,
      opacity: 0.1,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  tailDisc.rotation.y = Math.PI / 2;
  tailDisc.position.set(-0.2, 2.15, 10.5);
  group.add(tailDisc);
  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(0.07, 8, 8),
    new THREE.MeshStandardMaterial({ color: "#ff3b3b", emissive: "#ff2020", emissiveIntensity: 1 }),
  );
  beacon.position.set(0, 2.1, 2.4);
  group.add(beacon);

  // The pilot flies from the right seat, hands on the stick and the collective.
  const pilot: Body = createBody({ thirdPerson: true, look: HELI_PILOT });
  group.add(pilot.group);
  const pilotPose = pose("seated");
  const pilotFrame = new THREE.Matrix4().makeTranslation(0.55, 1.22, -1.72);
  const stick = new THREE.Vector3(0.04, -0.62, -0.4);
  const collective = new THREE.Vector3(-0.32, -0.72, -0.06);
  const thumbsUp = new THREE.Vector3(-0.26, -0.02, -0.34);
  const leftHand = new THREE.Vector3();
  const rightHand = new THREE.Vector3();

  return {
    group,
    update(dt, time, thumbs) {
      rotor.rotation.y += dt * 13.8;
      tail.rotation.x += dt * 40;
      (beacon.material as THREE.MeshStandardMaterial).emissiveIntensity =
        Math.sin(time * 7) > 0.6 ? 2.2 : 0.1;
      pilotPose.time = time;
      rightHand.copy(stick).x += Math.sin(time * 1.7) * 0.012;
      leftHand.copy(thumbs ? thumbsUp : collective);
      pilotPose.rightHand = rightHand;
      pilotPose.leftHand = leftHand;
      pilot.update(pilotFrame, pilotPose, dt);
    },
    dispose() {
      pilot.dispose();
      freeAll(group);
    },
  };
}

export type Balloon = {
  group: THREE.Group;
  /** `burn` 0..1 lights the burner: the flame, the glow inside the envelope, the pilot's hand. */
  update: (dt: number, time: number, burn: number) => void;
  dispose: () => void;
};

const BALLOON_PILOT: BodyLook = { suit: "#7a2e26", suitDark: "#4d1c17", helmet: "#cdb48a" };
/** Height of the envelope's mouth above the basket floor. */
const MOUTH_Y = 4.6;
const ENVELOPE: [number, number][] = [
  [1.7, 0],
  [2.6, 1.6],
  [4.3, 4.2],
  [6.2, 7.2],
  [7.7, 10.4],
  [8.5, 13.4],
  [8.6, 15.6],
  [8.0, 17.9],
  [6.6, 19.9],
  [4.4, 21.3],
  [2.0, 22.0],
  [0.01, 22.2],
];

function envelopeGeo() {
  const curve = new THREE.SplineCurve(ENVELOPE.map(([r, y]) => new THREE.Vector2(r, y)));
  return new THREE.LatheGeometry(curve.getSpacedPoints(44), 48);
}

/** A six-pointed star, like the four on the Chicago flag. */
function star(g: CanvasRenderingContext2D, x: number, y: number, r: number, sx: number) {
  g.beginPath();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
    const k = i % 2 ? 0.52 : 1;
    g.lineTo(x + Math.cos(a) * r * k * sx, y + Math.sin(a) * r * k);
  }
  g.closePath();
  g.fill();
}

const GORES: Record<Exclude<BalloonTheme, "chicago">, string[]> = {
  sunrise: ["#f2a541", "#e4572e", "#f3d34a", "#ad2e24"],
  ocean: ["#1d4e89", "#00b2ca", "#7dcfb6", "#f2f4ef"],
  rainbow: ["#d7263d", "#f46036", "#f9c80e", "#3bb273", "#2e86de", "#6c3fb5"],
};

/** The envelope's fabric: u runs around it, v from the mouth (bottom) to the crown. */
function envelopeTex(theme: BalloonTheme) {
  return canvasTex(1024, 512, (g) => {
    const W = 1024;
    const H = 512;
    const yOf = (v: number) => (1 - v) * H;
    if (theme === "chicago") {
      // The city's flag wrapped around it: white, two light-blue bands, red stars between.
      g.fillStyle = "#f4f5f2";
      g.fillRect(0, 0, W, H);
      g.fillStyle = "#41b6e6";
      for (const [a, b] of [
        [0.3, 0.37],
        [0.63, 0.7],
      ] as const)
        g.fillRect(0, yOf(b), W, yOf(a) - yOf(b));
      g.fillStyle = "#e4002b";
      for (let k = 0; k < 8; k++) star(g, ((k + 0.5) / 8) * W, yOf(0.5), 30, 1.23);
    } else {
      const cols = GORES[theme];
      const n = 16;
      for (let i = 0; i < n; i++) {
        g.fillStyle = cols[i % cols.length]!;
        g.fillRect((i / n) * W, 0, W / n + 1, H);
      }
      if (theme === "ocean") {
        g.fillStyle = "#f2f4ef";
        g.fillRect(0, yOf(0.56), W, yOf(0.48) - yOf(0.56));
      }
    }
    // Fire-proof skirt at the mouth, a darker crown, and the load tapes along the seams.
    g.fillStyle = "#33302c";
    g.fillRect(0, yOf(0.06), W, H - yOf(0.06));
    g.fillStyle = "rgba(0,0,0,0.14)";
    g.fillRect(0, 0, W, yOf(0.955));
    for (let i = 0; i < 16; i++) g.fillRect((i / 16) * W - 1, 0, 2.5, H);
    g.fillStyle = "rgba(0,0,0,0.05)";
    for (let j = 1; j < 12; j++) g.fillRect(0, (j / 12) * H, W, 1.5);
  });
}

function wickerTex() {
  const tex = canvasTex(256, 256, (g) => {
    g.fillStyle = "#8a6638";
    g.fillRect(0, 0, 256, 256);
    // Rows of weave over and under the stakes.
    for (let row = 0; row < 32; row++) {
      for (let col = 0; col < 16; col++) {
        const x = col * 16 + (row % 2) * 8;
        const y = row * 8;
        const shade = 150 + ((row * 7 + col * 13) % 30);
        g.fillStyle = `rgb(${shade + 20},${shade - 10},${shade - 70})`;
        g.beginPath();
        g.ellipse(x + 8, y + 4, 8, 3.2, 0, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.fillStyle = "rgba(60,40,20,0.35)";
    for (let x = 0; x < 256; x += 16) g.fillRect(x, 0, 2, 256);
  });
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 2);
  return tex;
}

/** A hot-air balloon. `pilot` adds the pilot and the burner's blast valve the player watches. */
export function createBalloon(theme: BalloonTheme, opts: { pilot: boolean }): Balloon {
  const group = new THREE.Group();
  const wicker = new THREE.MeshStandardMaterial({ map: wickerTex(), roughness: 0.95 });
  const suede = new THREE.MeshStandardMaterial({ color: "#4a3324", roughness: 0.9 });
  const deck = new THREE.MeshStandardMaterial({ color: "#5a4632", roughness: 0.95 });
  const steel = new THREE.MeshStandardMaterial({
    color: "#b9c2ca",
    roughness: 0.3,
    metalness: 0.7,
  });
  const sleeve = new THREE.MeshStandardMaterial({ color: "#7a6450", roughness: 0.85 });
  const tank = new THREE.MeshStandardMaterial({
    color: "#d9dde0",
    roughness: 0.35,
    metalness: 0.5,
  });

  // The basket: wicker walls with a padded rim, two tanks in the far corners.
  box(group, 1.68, 0.06, 1.68, 0, -0.03, 0, deck);
  for (const s of [-1, 1]) {
    box(group, 1.76, RIM_Y, 0.08, 0, RIM_Y / 2, s * 0.84, wicker);
    box(group, 0.08, RIM_Y, 1.6, s * 0.84, RIM_Y / 2, 0, wicker);
    box(group, 1.86, 0.12, 0.16, 0, RIM_Y + 0.02, s * 0.84, suede);
    box(group, 0.16, 0.12, 1.86, s * 0.84, RIM_Y + 0.02, 0, suede);
  }
  for (const z of [-0.56, 0.56]) {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.9, 14), tank);
    t.position.set(0.56, 0.47, z);
    group.add(t);
  }

  // The burner on its frame of sleeved poles, and the cables up to the envelope's mouth.
  const BURNER_Y = 2.35;
  const corner = (sx: number, sz: number, y: number, k: number) => ({ x: sx * k, y, z: sz * k });
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      rod(group, corner(sx, sz, RIM_Y, 0.78), corner(sx, sz, BURNER_Y - 0.1, 0.42), 0.024, sleeve);
    }
  }
  for (const [a, b] of [
    [corner(-1, -1, BURNER_Y - 0.1, 0.42), corner(1, -1, BURNER_Y - 0.1, 0.42)],
    [corner(1, -1, BURNER_Y - 0.1, 0.42), corner(1, 1, BURNER_Y - 0.1, 0.42)],
    [corner(1, 1, BURNER_Y - 0.1, 0.42), corner(-1, 1, BURNER_Y - 0.1, 0.42)],
    [corner(-1, 1, BURNER_Y - 0.1, 0.42), corner(-1, -1, BURNER_Y - 0.1, 0.42)],
  ] as const)
    rod(group, a, b, 0.025, steel);
  for (const x of [-0.14, 0.14]) {
    const can = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.13, 0.32, 14), steel);
    can.position.set(x, BURNER_Y, 0);
    group.add(can);
    const coil = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.03, 6, 16), steel);
    coil.rotation.x = Math.PI / 2;
    coil.position.set(x, BURNER_Y + 0.2, 0);
    group.add(coil);
  }
  // The blast valve's handle hangs toward the pilot.
  const VALVE = new THREE.Vector3(0.22, BURNER_Y - 0.42, 0.02);
  rod(group, { x: 0.14, y: BURNER_Y - 0.12, z: 0 }, VALVE, 0.018, steel);

  const cable: number[] = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const mx = Math.cos(a) * 1.7;
    const mz = Math.sin(a) * 1.7;
    const c = corner(mx > 0 ? 1 : -1, mz > 0 ? 1 : -1, BURNER_Y - 0.1, 0.42);
    cable.push(c.x, c.y, c.z, mx, MOUTH_Y, mz);
  }
  const cableGeo = new THREE.BufferGeometry();
  cableGeo.setAttribute("position", new THREE.Float32BufferAttribute(cable, 3));
  group.add(new THREE.LineSegments(cableGeo, new THREE.LineBasicMaterial({ color: "#3b3631" })));

  // The envelope: the outside in the sun, and the inside glowing with the light through the
  // fabric, brighter while the burner fires.
  const geo = envelopeGeo();
  const map = envelopeTex(theme);
  // While the burner fires, the fabric glows with it, inside and (fainter) out.
  const outsideMat = new THREE.MeshStandardMaterial({
    map,
    roughness: 0.75,
    emissive: "#ff9a4a",
    emissiveMap: map,
    emissiveIntensity: 0,
  });
  const outside = new THREE.Mesh(geo, outsideMat);
  const insideMat = new THREE.MeshStandardMaterial({
    map,
    side: THREE.BackSide,
    roughness: 0.9,
    emissive: "#ffffff",
    emissiveMap: map,
    emissiveIntensity: 0.2,
  });
  const inside = new THREE.Mesh(geo, insideMat);
  for (const m of [outside, inside]) {
    m.position.y = MOUTH_Y;
    group.add(m);
  }

  // The flame: an additive cone with a hot core, pointed up into the mouth.
  const flame = new THREE.Group();
  flame.position.set(0, BURNER_Y + 0.2, 0);
  group.add(flame);
  const outerGeo = new THREE.ConeGeometry(0.3, 2.0, 14, 1, true);
  outerGeo.translate(0, 1.0, 0);
  const coreGeo = new THREE.ConeGeometry(0.13, 1.1, 12, 1, true);
  coreGeo.translate(0, 0.55, 0);
  // The outer flame blends normally so it shows against the glowing fabric; the core adds light.
  const fire = (color: string, opacity: number, add: boolean) =>
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      blending: add ? THREE.AdditiveBlending : THREE.NormalBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  flame.add(new THREE.Mesh(outerGeo, fire("#ff6a12", 0.85, false)));
  flame.add(new THREE.Mesh(coreGeo, fire("#ffe9a8", 0.95, true)));
  flame.visible = false;

  let pilot: Body | null = null;
  const pilotPose = pose("down");
  const pilotFrame = new THREE.Matrix4();
  const pilotInv = new THREE.Matrix4();
  const valveHand = new THREE.Vector3();
  if (opts.pilot) {
    pilot = createBody({ thirdPerson: true, look: BALLOON_PILOT });
    group.add(pilot.group);
    // On the tank side, facing into the basket.
    pilotFrame.compose(
      new THREE.Vector3(0.4, 1.6, 0.04),
      new THREE.Quaternion().setFromAxisAngle(_up, Math.PI / 2),
      new THREE.Vector3(1, 1, 1),
    );
    pilotInv.copy(pilotFrame).invert();
    valveHand.copy(VALVE).applyMatrix4(pilotInv);
  }
  const warm = new THREE.Color("#ff9a4a");
  const cool = new THREE.Color("#ffffff");

  return {
    group,
    update(dt, time, burn) {
      flame.visible = burn > 0.02;
      if (flame.visible) {
        const flicker = 0.9 + Math.sin(time * 37) * 0.06 + Math.sin(time * 23.7) * 0.05;
        flame.scale.set(0.8 + 0.2 * burn, burn * flicker, 0.8 + 0.2 * burn);
      }
      insideMat.emissiveIntensity = 0.2 + burn * 0.45;
      insideMat.emissive.copy(cool).lerp(warm, burn);
      outsideMat.emissiveIntensity = burn * 0.22;
      if (pilot) {
        pilotPose.time = time;
        pilotPose.rightHand = burn > 0.02 ? valveHand : null;
        pilot.update(pilotFrame, pilotPose, dt);
      }
    },
    dispose() {
      pilot?.dispose();
      freeAll(group);
    },
  };
}
