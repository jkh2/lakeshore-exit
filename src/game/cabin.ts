import * as THREE from "three";
import { createBody, type Body, type BodyLook, type BodyPose } from "./body";

// The inside of the Twin Otter: padded walls, a ribbed rubber floor, vinyl benches with
// seat belts, ceiling handles and a light strip, a rolled-up door with a striped sill, a
// spotter's timer by the door, and the load sitting astride the benches. The bar across
// the door lifts out of the way on the green light so you can run straight out.

const BAR_DOWN = 1.05;
const BAR_UP = 1.66;

export type CabinParts = {
  inner: THREE.MeshStandardMaterial;
  floor: THREE.MeshStandardMaterial;
  seat: THREE.MeshStandardMaterial;
  bar: THREE.Object3D;
};

export type CabinState = {
  /** The load is aboard: the menu and the climb to altitude. */
  aboard: boolean;
  green: boolean;
  /** Text for the spotter's screen by the door. */
  spot: string;
  time: number;
};

export type Cabin = {
  update: (dt: number, state: CabinState) => void;
  /** 0 with the bar across the door, 1 once it is fully up. */
  barOpen: () => number;
  dispose: () => void;
};

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  if (g) draw(g);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

function speckle(g: CanvasRenderingContext2D, w: number, h: number, amount: number, seed: number) {
  let a = seed;
  const rnd = () => {
    a = (a * 16807) % 2147483647;
    return a / 2147483647;
  };
  for (let i = 0; i < w * h * 0.08; i++) {
    const v = rnd() < 0.5 ? 0 : 255;
    g.fillStyle = `rgba(${v},${v},${v},${rnd() * amount})`;
    g.fillRect(rnd() * w, rnd() * h, 1.5, 1.5);
  }
}

/** Tuck-and-roll padding: rounded horizontal rolls with a stitch line between each. */
function paddingTexture() {
  return canvasTexture(256, 256, (g) => {
    const rolls = 4;
    const rh = 256 / rolls;
    for (let i = 0; i < rolls; i++) {
      const y = i * rh;
      const grad = g.createLinearGradient(0, y, 0, y + rh);
      grad.addColorStop(0, "#39424c");
      grad.addColorStop(0.3, "#5c6772");
      grad.addColorStop(0.55, "#626d79");
      grad.addColorStop(1, "#343c45");
      g.fillStyle = grad;
      g.fillRect(0, y, 256, rh);
      g.strokeStyle = "rgba(20,24,28,0.55)";
      g.setLineDash([5, 4]);
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(0, y + 2);
      g.lineTo(256, y + 2);
      g.stroke();
    }
    g.setLineDash([]);
    // A vertical seam between panels.
    g.fillStyle = "rgba(18,22,26,0.6)";
    g.fillRect(0, 0, 3, 256);
    speckle(g, 256, 256, 0.06, 7);
  });
}

/** Ribbed rubber matting, the ribs running fore and aft. */
function floorTexture() {
  return canvasTexture(128, 128, (g) => {
    g.fillStyle = "#2a2f35";
    g.fillRect(0, 0, 128, 128);
    for (let x = 0; x < 128; x += 16) {
      g.fillStyle = "#3a4048";
      g.fillRect(x + 3, 0, 6, 128);
      g.fillStyle = "rgba(255,255,255,0.06)";
      g.fillRect(x + 3, 0, 2, 128);
    }
    speckle(g, 128, 128, 0.12, 3);
  });
}

/** Blue vinyl bench cushions with a piped seam. */
function vinylTexture() {
  return canvasTexture(128, 128, (g) => {
    const grad = g.createLinearGradient(0, 0, 128, 0);
    grad.addColorStop(0, "#1b2c44");
    grad.addColorStop(0.5, "#26405f");
    grad.addColorStop(1, "#1b2c44");
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = "rgba(10,14,20,0.7)";
    g.fillRect(0, 0, 128, 3);
    g.fillRect(0, 0, 3, 128);
    speckle(g, 128, 128, 0.05, 11);
  });
}

function hazardTexture() {
  return canvasTexture(128, 32, (g) => {
    g.fillStyle = "#f0b400";
    g.fillRect(0, 0, 128, 32);
    g.fillStyle = "#15181c";
    for (let x = -32; x < 160; x += 32) {
      g.beginPath();
      g.moveTo(x, 32);
      g.lineTo(x + 16, 32);
      g.lineTo(x + 32, 0);
      g.lineTo(x + 16, 0);
      g.closePath();
      g.fill();
    }
  });
}

function signTexture(text: string, fg: string, bg: string, w = 256, h = 96) {
  const tex = canvasTexture(w, h, (g) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.fillStyle = fg;
    g.font = `700 ${Math.round(h * 0.55)}px "Barlow Condensed", sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, w / 2, h / 2 + 2);
  });
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/**
 * BoxGeometry maps a whole texture onto every face. Scale each face's UVs by its size so a
 * texture tiles at the same size in meters on a long wall and a short one.
 */
function tileBox(mesh: THREE.Mesh, tile: number) {
  const geo = mesh.geometry as THREE.BoxGeometry;
  const p = geo.parameters;
  if (!p || geo.userData.tiled) return;
  geo.userData.tiled = true;
  const uv = geo.getAttribute("uv");
  const faces = [
    [p.depth, p.height],
    [p.depth, p.height],
    [p.width, p.depth],
    [p.width, p.depth],
    [p.width, p.height],
    [p.width, p.height],
  ];
  const per = uv.count / 6;
  for (let f = 0; f < 6; f++) {
    const [fw, fh] = faces[f]!;
    for (let i = 0; i < per; i++) {
      const k = f * per + i;
      uv.setXY(k, (uv.getX(k) * fw!) / tile, (uv.getY(k) * fh!) / tile);
    }
  }
  uv.needsUpdate = true;
}

export function dressCabin(plane: THREE.Group, parts: CabinParts, looks: BodyLook[]): Cabin {
  const textures: THREE.Texture[] = [];
  const keep = <T extends THREE.Texture>(t: T) => {
    textures.push(t);
    return t;
  };
  const pad = keep(paddingTexture());
  const rubber = keep(floorTexture());
  const vinyl = keep(vinylTexture());
  const hazard = keep(hazardTexture());

  parts.inner.map = pad;
  parts.inner.bumpMap = pad;
  parts.inner.bumpScale = 0.9;
  parts.inner.color.set("#a3abb3");
  parts.inner.roughness = 0.82;
  parts.floor.map = rubber;
  parts.floor.color.set("#ffffff");
  parts.seat.map = vinyl;
  parts.seat.color.set("#ffffff");
  parts.seat.roughness = 0.5;
  for (const child of plane.children) {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || !(mesh.geometry instanceof THREE.BoxGeometry)) continue;
    if (mesh.material === parts.inner) tileBox(mesh, 0.62);
    else if (mesh.material === parts.floor) tileBox(mesh, 0.5);
    else if (mesh.material === parts.seat) tileBox(mesh, 0.6);
  }

  const group = new THREE.Group();
  plane.add(group);
  const add = (
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    parent: THREE.Object3D = group,
  ) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };
  const metal = new THREE.MeshStandardMaterial({
    color: "#aeb6bd",
    roughness: 0.35,
    metalness: 0.7,
  });
  const frameMat = new THREE.MeshStandardMaterial({ color: "#2d343c", roughness: 0.7 });
  const webbing = new THREE.MeshStandardMaterial({ color: "#d4621c", roughness: 0.8 });
  const hazardMat = new THREE.MeshStandardMaterial({ map: hazard, roughness: 0.7 });
  const lightMat = new THREE.MeshStandardMaterial({
    color: "#fff6e8",
    emissive: "#fff1dc",
    emissiveIntensity: 1.6,
  });
  const rollMat = new THREE.MeshStandardMaterial({
    color: "#d8e4ea",
    transparent: true,
    opacity: 0.55,
    roughness: 0.15,
    metalness: 0.1,
  });

  // Ribs: the fuselage frames standing proud of the padding, ceiling to floor.
  for (const z of [-2.6, -1.95, -1.3, -0.65, 0.0, 1.85, 2.3]) {
    for (const s of [-1, 1]) {
      if (s < 0 && z > -1.2 && z < 0.9) continue; // the window band on the left
      add(new THREE.BoxGeometry(0.04, 1.66, 0.05), frameMat, s * 1.1, 0.9, z);
    }
    add(new THREE.BoxGeometry(2.2, 0.04, 0.05), frameMat, 0, 1.76, z);
  }

  // Window frames splitting the left pane into three, with rubber surrounds.
  for (const z of [-0.49, 0.19])
    add(new THREE.BoxGeometry(0.05, 0.74, 0.06), frameMat, -1.1, 0.95, z);
  add(new THREE.BoxGeometry(0.05, 0.05, 2.1), frameMat, -1.1, 1.31, -0.15);
  add(new THREE.BoxGeometry(0.05, 0.05, 2.1), frameMat, -1.1, 0.59, -0.15);

  // Ceiling light strip and grab handles.
  add(new THREE.BoxGeometry(0.1, 0.02, 4.6), lightMat, 0, 1.765, -0.45);
  const handleGeo = new THREE.TorusGeometry(0.07, 0.013, 6, 14, Math.PI);
  for (const z of [-2.3, -1.6, -0.9, -0.2]) {
    for (const s of [-1, 1]) {
      const h = add(handleGeo, metal, s * 0.55, 1.77, z);
      h.rotation.set(Math.PI, Math.PI / 2, 0);
    }
  }

  // Seat belts lying across the benches, with buckles.
  const belt = new THREE.BoxGeometry(0.57, 0.012, 0.05);
  const buckle = new THREE.BoxGeometry(0.06, 0.02, 0.07);
  for (const [x, zs] of [
    [-0.72, [-1.05, -0.3, 0.45]],
    [0.72, [-2.05, -1.25, -0.5]],
  ] as const) {
    for (const z of zs) {
      add(belt, webbing, x, 0.678, z + 0.2);
      add(buckle, metal, x + (x < 0 ? 0.1 : -0.1), 0.69, z + 0.2);
    }
  }

  // The door: a striped sill, the rolled-up door at the top of the opening, and its strap.
  const sill = add(new THREE.BoxGeometry(1.5, 0.012, 0.12), hazardMat, 1.52, 0.086, 0.95);
  sill.rotation.y = Math.PI / 2;
  tileBox(sill, 0.12);
  // The texture is four stripes wide and one tall, so stretch it back to that shape.
  hazard.repeat.set(0.25, 1);
  const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.62, 16), rollMat);
  roll.rotation.x = Math.PI / 2;
  roll.position.set(1.17, 1.66, 0.95);
  group.add(roll);
  add(new THREE.BoxGeometry(0.012, 0.42, 0.05), frameMat, 1.12, 1.42, 0.95);
  // Inside handle above the door, where climbers hold on.
  const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 1.3, 8), metal);
  rail.rotation.x = Math.PI / 2;
  rail.position.set(0.98, 1.7, 0.95);
  group.add(rail);

  // Signs: EXIT over the door, and the spotter's screen just forward of it.
  const exitTex = keep(signTexture("EXIT", "#ffffff", "#1d7a3c", 192, 72));
  const exitSign = add(
    new THREE.PlaneGeometry(0.3, 0.11),
    new THREE.MeshBasicMaterial({ map: exitTex }),
    0.86,
    1.66,
    1.76,
  );
  exitSign.rotation.y = Math.PI;
  add(new THREE.BoxGeometry(0.32, 0.13, 0.02), frameMat, 0.86, 1.66, 1.775);
  const screenCanvas = document.createElement("canvas");
  screenCanvas.width = 256;
  screenCanvas.height = 128;
  const screenTex = keep(new THREE.CanvasTexture(screenCanvas));
  screenTex.colorSpace = THREE.SRGBColorSpace;
  const screenMat = new THREE.MeshBasicMaterial({ map: screenTex, toneMapped: false });
  const screen = add(new THREE.PlaneGeometry(0.34, 0.17), screenMat, 1.1, 1.38, -0.42);
  screen.rotation.y = -Math.PI / 2;
  add(new THREE.BoxGeometry(0.03, 0.21, 0.38), frameMat, 1.115, 1.38, -0.42);
  let shown = "";
  let shownGreen = false;
  const drawScreen = (text: string, green: boolean) => {
    const g = screenCanvas.getContext("2d");
    if (!g) return;
    g.fillStyle = "#081008";
    g.fillRect(0, 0, 256, 128);
    g.fillStyle = green ? "#46e07a" : "#ff5a4a";
    g.beginPath();
    g.arc(30, 32, 13, 0, Math.PI * 2);
    g.fill();
    g.font = '700 30px "Barlow Condensed", sans-serif';
    g.textBaseline = "middle";
    g.fillText(green ? "GREEN" : "RED", 52, 33);
    g.fillStyle = "#cfe9d2";
    g.font = '700 44px "Barlow Condensed", sans-serif';
    g.textAlign = "center";
    g.fillText(text, 128, 88);
    g.textAlign = "left";
    screenTex.needsUpdate = true;
  };

  // The load: astride the benches facing the tail, the way a Twin Otter is packed. The two in
  // the formation's colors sit nearest the door. The pilot faces forward up front.
  const PILOT: BodyLook = { suit: "#33404d", suitDark: "#232c36", helmet: "#2b3036" };
  const OTHERS: BodyLook[] = [
    { suit: "#1f6f6a", suitDark: "#124441", helmet: "#e7eaee" },
    { suit: "#5a3d8c", suitDark: "#382559", helmet: "#f0c419" },
    { suit: "#3a4048", suitDark: "#24282e", helmet: "#c4322a" },
  ];
  const seats: { look: BodyLook; x: number; z: number; yaw: number }[] = [
    { look: looks[0] ?? OTHERS[0]!, x: -0.72, z: 0.45, yaw: Math.PI },
    { look: looks[1] ?? OTHERS[1]!, x: 0.72, z: -1.25, yaw: Math.PI },
    { look: OTHERS[0]!, x: -0.72, z: -0.3, yaw: Math.PI },
    { look: OTHERS[1]!, x: -0.72, z: -1.05, yaw: Math.PI },
    { look: OTHERS[2]!, x: 0.72, z: -2.05, yaw: Math.PI },
    { look: PILOT, x: 0.15, z: -3.3, yaw: 0 },
  ];
  const BENCH_EYE = 1.55;
  const riders = seats.map((seat, i) => {
    const body: Body = createBody({ thirdPerson: true, look: seat.look });
    plane.add(body.group);
    const pose: BodyPose = {
      mode: "seated",
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
    const frame = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const at = new THREE.Vector3();
    // The pilot sits lower in the cockpit seat.
    const eye = i === seats.length - 1 ? 1.25 : BENCH_EYE;
    return { body, pose, frame, q, at, seat, eye, phase: i * 1.7 };
  });

  let open = 0;
  const one = new THREE.Vector3(1, 1, 1);
  const up = new THREE.Vector3(0, 1, 0);

  return {
    update(dt, state) {
      // The bar rides up its posts on green and back down on red.
      const want = state.green ? 1 : 0;
      open += Math.sign(want - open) * Math.min(Math.abs(want - open), dt / 0.6);
      const eased = open * open * (3 - 2 * open);
      parts.bar.position.y = BAR_DOWN + (BAR_UP - BAR_DOWN) * eased;

      if (state.spot !== shown || state.green !== shownGreen) {
        shown = state.spot;
        shownGreen = state.green;
        drawScreen(state.green ? "GO" : state.spot || "--", state.green);
      }

      for (const r of riders) {
        r.body.group.visible = state.aboard;
        if (!state.aboard) {
          r.pose.mode = "hidden";
          r.body.update(r.frame, r.pose, dt);
          continue;
        }
        r.pose.mode = "seated";
        r.pose.time = state.time;
        // A little sway with the airplane, and now and then a glance around.
        const t = state.time + r.phase;
        const glance = Math.sin(t * 0.37) * 0.35 + Math.sin(t * 1.3) * 0.05;
        r.q.setFromAxisAngle(up, r.seat.yaw + glance * 0.25);
        r.at.set(r.seat.x + Math.sin(t * 2.1) * 0.006, r.eye + Math.sin(t * 7.3) * 0.004, r.seat.z);
        r.frame.compose(r.at, r.q, one);
        r.body.update(r.frame, r.pose, dt);
      }
    },
    barOpen: () => open,
    dispose() {
      for (const r of riders) {
        plane.remove(r.body.group);
        r.body.dispose();
      }
      textures.forEach((t) => t.dispose());
    },
  };
}
