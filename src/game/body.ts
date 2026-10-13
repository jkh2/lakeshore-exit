import * as THREE from "three";

// A jumper's body. The player's own is seen in first person; other jumpers use the
// same rig in third person with a head, helmet and container added. Everything is
// placed in an "eye frame": origin at the eyes, -z forward, +y up. The caller
// supplies that frame each phase.

export type BodyMode = "hidden" | "cabin" | "seated" | "perch" | "freefall" | "canopy" | "down";
export type Gesture = "pull" | "cutaway" | "reserve";

export type BodyPose = {
  mode: BodyMode;
  /** -1 dive .. +1 arch in freefall. */
  forward: number;
  /** +1 is a left turn. */
  turn: number;
  /** Eye-frame hand targets that override the pose (toggles, door bar). */
  leftHand: THREE.Vector3 | null;
  rightHand: THREE.Vector3 | null;
  gesture: Gesture | null;
  gestureT: number;
  /** Walking phase in the cabin. */
  walk: number;
  /** 0..1 legs forward for the landing. */
  flare: number;
  /** Air speed in m/s, shakes the arms in freefall. */
  air: number;
  altFt: number;
  time: number;
  /** Deploying or malfunctioning: hands go up to the risers. */
  reaching: boolean;
  /** Third person: 0 upright .. 1 lying belly-to-earth. */
  lean?: number;
  /** Third person: 0..1 tracking, arms swept back and legs straight. */
  trackAmt?: number;
  /** First person in freefall: 0..1 how full the wingsuit is; arms spread and the arm wings show. */
  wing?: number;
};

export type BodyLook = { suit: string; suitDark: string; helmet: string };

/** Standing eye height above the feet. */
export const EYE_UP = 1.6;

const UPPER = 0.3;
const FORE = 0.29;
const THIGH = 0.43;
const SHIN = 0.42;

export const PLAYER_LOOK: BodyLook = { suit: "#2c5a8c", suitDark: "#1d3d61", helmet: "#e9ecef" };
const GLOVE = "#17191c";
const SHOE = "#2a2c30";
const HARNESS = "#121417";

type Key = [number, number, number, number];

function track(out: THREE.Vector3, keys: Key[], t: number) {
  if (t <= keys[0]![0]) return out.set(keys[0]![1], keys[0]![2], keys[0]![3]);
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1]!;
    const b = keys[i]!;
    if (t <= b[0]) {
      let u = (t - a[0]) / Math.max(1e-4, b[0] - a[0]);
      u = u * u * (3 - 2 * u);
      return out.set(a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u, a[3] + (b[3] - a[3]) * u);
    }
  }
  const last = keys[keys.length - 1]!;
  return out.set(last[1], last[2], last[3]);
}

// Hand paths for the big moves, in the freefall eye frame.
const GESTURES: Record<Gesture, { dur: number; right: Key[]; left: Key[] }> = {
  // Right hand sweeps back to the pilot chute; left hand goes up and forward for symmetry.
  pull: {
    dur: 1.1,
    right: [
      [0, 0.37, -0.08, -0.34],
      [0.22, 0.3, -0.38, 0.12],
      [0.38, 0.24, -0.42, 0.36],
      [0.62, 0.62, -0.14, 0.3],
      [1.1, 0.3, 0.2, -0.04],
    ],
    left: [
      [0, -0.37, -0.08, -0.34],
      [0.2, -0.12, 0.14, -0.5],
      [0.8, -0.12, 0.14, -0.5],
      [1.1, -0.3, 0.2, -0.04],
    ],
  },
  // Both hands find the cutaway pad, then the right hand peels it away.
  cutaway: {
    dur: 1.0,
    right: [
      [0, 0.37, -0.08, -0.34],
      [0.18, 0.12, -0.33, -0.14],
      [0.42, 0.12, -0.33, -0.14],
      [0.62, 0.42, -0.18, -0.5],
      [1.0, 0.37, -0.08, -0.34],
    ],
    left: [
      [0, -0.37, -0.08, -0.34],
      [0.18, -0.12, -0.33, -0.14],
      [1.0, -0.12, -0.33, -0.14],
    ],
  },
  // Left hand pulls the reserve handle, then both reach for the risers.
  reserve: {
    dur: 0.9,
    right: [
      [0, 0.37, -0.08, -0.34],
      [0.9, 0.3, 0.2, -0.04],
    ],
    left: [
      [0, -0.12, -0.33, -0.14],
      [0.12, -0.12, -0.34, -0.13],
      [0.4, -0.44, -0.14, -0.52],
      [0.9, -0.3, 0.2, -0.04],
    ],
  },
};

function dial() {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const g = c.getContext("2d");
  if (!g) return null;
  const cx = 128;
  const r = 120;
  g.fillStyle = "#c9ced3";
  g.beginPath();
  g.arc(cx, cx, r + 6, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#0d0f12";
  g.beginPath();
  g.arc(cx, cx, r, 0, Math.PI * 2);
  g.fill();
  const arc = (from: number, to: number, color: string) => {
    g.strokeStyle = color;
    g.lineWidth = 16;
    g.beginPath();
    g.arc(cx, cx, r - 14, -Math.PI / 2 + (from / 12) * Math.PI * 2, -Math.PI / 2 + (to / 12) * Math.PI * 2);
    g.stroke();
  };
  arc(0, 2, "#d92b2b");
  arc(2, 4.5, "#f0a202");
  g.fillStyle = "#f2f4f6";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = "700 34px sans-serif";
  for (let i = 0; i < 12; i++) {
    const a = -Math.PI / 2 + (i / 12) * Math.PI * 2;
    g.fillText(String(i), cx + Math.cos(a) * (r - 46), cx + Math.sin(a) * (r - 46));
    g.fillRect(cx + Math.cos(a) * (r - 26) - 2, cx + Math.sin(a) * (r - 26) - 2, 4, 4);
  }
  g.font = "600 16px sans-serif";
  g.fillStyle = "#8f9aa6";
  g.fillText("x1000 FT", cx, cx + 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export type Body = {
  group: THREE.Group;
  update: (frame: THREE.Matrix4, pose: BodyPose, dt: number) => void;
  dispose: () => void;
};

export function createBody(opts: { thirdPerson?: boolean; look?: BodyLook } = {}): Body {
  const third = opts.thirdPerson ?? false;
  const look = opts.look ?? PLAYER_LOOK;
  const group = new THREE.Group();
  group.matrixAutoUpdate = false;
  const suit = new THREE.MeshStandardMaterial({ color: look.suit, roughness: 0.85 });
  const suitDark = new THREE.MeshStandardMaterial({ color: look.suitDark, roughness: 0.85 });
  const glove = new THREE.MeshStandardMaterial({ color: GLOVE, roughness: 0.6 });
  const shoe = new THREE.MeshStandardMaterial({ color: SHOE, roughness: 0.7 });
  const harness = new THREE.MeshStandardMaterial({ color: HARNESS, roughness: 0.7 });
  const geos: THREE.BufferGeometry[] = [];
  const cyl = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true);
  const trunk = new THREE.CylinderGeometry(1, 0.9, 1, 16, 1, false);
  const ball = new THREE.SphereGeometry(1, 12, 8);
  const footGeo = new THREE.BoxGeometry(0.1, 0.09, 0.27);
  geos.push(cyl, trunk, ball, footGeo);

  const limb = (mat: THREE.Material, r: number, depth = r, geo = cyl) => {
    const m = new THREE.Mesh(geo, mat);
    m.userData.r = r;
    m.userData.depth = depth;
    m.frustumCulled = false;
    group.add(m);
    return m;
  };
  const joint = (mat: THREE.Material, r: number) => {
    const m = new THREE.Mesh(ball, mat);
    m.scale.setScalar(r);
    m.frustumCulled = false;
    group.add(m);
    return m;
  };

  const arms = [-1, 1].map((side) => ({
    side,
    upper: limb(suit, 0.055),
    fore: limb(suit, 0.047),
    cuff: limb(glove, 0.05),
    elbow: joint(suit, 0.055),
    shoulderBall: joint(suit, 0.06),
    hand: (() => {
      // A mitten: flat palm with the fingers along -z and a thumb on the inside.
      const g = new THREE.Group();
      const palm = new THREE.Mesh(ball, glove);
      palm.scale.set(0.046, 0.025, 0.05);
      palm.position.set(0, 0, -0.045);
      const fingers = new THREE.Mesh(ball, glove);
      fingers.scale.set(0.045, 0.02, 0.036);
      fingers.position.set(0, -0.006, -0.09);
      fingers.rotation.x = -0.3;
      const thumb = new THREE.Mesh(ball, glove);
      thumb.scale.set(0.015, 0.016, 0.032);
      thumb.position.set(-side * 0.04, -0.004, -0.05);
      thumb.rotation.y = side * 0.5;
      for (const m of [palm, fingers, thumb]) m.frustumCulled = false;
      g.add(palm, fingers, thumb);
      group.add(g);
      return g;
    })(),
    target: new THREE.Vector3(side * 0.36, -0.12, -0.42),
    shoulder: new THREE.Vector3(),
    elbowPos: new THREE.Vector3(),
    wrist: new THREE.Vector3(),
  }));
  const legs = [-1, 1].map((side) => ({
    side,
    thigh: limb(suit, 0.08),
    shin: limb(suit, 0.062),
    knee: joint(suit, 0.068),
    foot: (() => {
      const m = new THREE.Mesh(footGeo, shoe);
      m.frustumCulled = false;
      group.add(m);
      return m;
    })(),
    footPos: new THREE.Vector3(side * 0.12, -1.55, 0),
    kneeAt: new THREE.Vector3(),
    ankleAt: new THREE.Vector3(),
  }));
  const torso = limb(suit, 0.17, 0.11, trunk);
  const hips = joint(suitDark, 0.17);
  const chest = joint(suit, 0.17);
  const chestStrap = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.035, 0.02), harness);
  chestStrap.frustumCulled = false;
  group.add(chestStrap);
  geos.push(chestStrap.geometry);
  const webs = [-1, 1].map(() => limb(harness, 0.022));
  const legStraps = [-1, 1].map(() => {
    const m = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.016, 6, 16), harness);
    m.frustumCulled = false;
    group.add(m);
    geos.push(m.geometry);
    return m;
  });

  // Third person only: helmet, visor, neck and the container on the back.
  const helmetMat = new THREE.MeshStandardMaterial({ color: look.helmet, roughness: 0.35 });
  const visorMat = new THREE.MeshStandardMaterial({
    color: "#0b0d10",
    roughness: 0.15,
    metalness: 0.4,
  });
  const rigMat = new THREE.MeshStandardMaterial({ color: "#2b3138", roughness: 0.8 });
  const trayMat = new THREE.MeshStandardMaterial({ color: "#1c2026", roughness: 0.8 });
  const helmet = joint(helmetMat, 0.125);
  helmet.scale.set(0.12, 0.125, 0.135);
  helmet.position.set(0, 0.035, 0.07);
  const visor = joint(visorMat, 0.1);
  visor.scale.set(0.1, 0.042, 0.06);
  visor.position.set(0, 0.0, -0.025);
  const neck = limb(suitDark, 0.05);
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  geos.push(boxGeo);
  const container = new THREE.Mesh(boxGeo, rigMat);
  container.scale.set(0.34, 0.44, 0.13);
  const tray = new THREE.Mesh(boxGeo, trayMat);
  tray.scale.set(0.34, 0.14, 0.14);
  for (const m of [container, tray]) {
    m.frustumCulled = false;
    group.add(m);
  }
  for (const m of [helmet, visor, neck, container, tray]) m.visible = third;

  // The wingsuit's arm wings. The arms are inside the wing, so they take its color, and the
  // fabric runs from the arm back to the hip. Each wing is a grid: across
  // the span armpit, elbow and wrist; along the chord stations from the arm to the trailing
  // edge, so the fabric can bulge where the air fills it and carry a dark stripe at the back.
  const WING_ORANGE = "#f06a1e";
  const wingTop = new THREE.MeshStandardMaterial({ color: WING_ORANGE, roughness: 0.7 });
  const wingMat = new THREE.MeshStandardMaterial({
    color: "#ffffff",
    vertexColors: true,
    roughness: 0.75,
    side: THREE.DoubleSide,
  });
  const CHORD = [0, 0.45, 0.84, 0.87, 1];
  const BULGE = [0, 1, 0.3, 0.25, 0];
  const NC = CHORD.length;
  const WING_INDEX: number[] = [];
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < NC - 1; j++) {
      const v = i * NC + j;
      WING_INDEX.push(v, v + NC, v + NC + 1, v, v + NC + 1, v + 1);
    }
  }
  const wings = [-1, 1].map(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(3 * NC * 3), 3));
    const orange = new THREE.Color(WING_ORANGE);
    const stripe = new THREE.Color("#1f2a3c");
    const cols = [0, 1, 2].flatMap(() => CHORD.map((_, j) => (j < 3 ? orange : stripe)));
    g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(cols.flatMap((c) => [c.r, c.g, c.b])), 3));
    g.setIndex(WING_INDEX);
    const m = new THREE.Mesh(g, wingMat);
    m.frustumCulled = false;
    m.visible = false;
    group.add(m);
    geos.push(g);
    return m;
  });

  // Seen from outside, a wingsuit also has a tail wing between the legs: crotch, knee, ankle,
  // ankle, knee, with the dark stripe along the trailing edge at the feet.
  const tail = (() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(15), 3));
    const orange = new THREE.Color(WING_ORANGE);
    const stripe = new THREE.Color("#1f2a3c");
    const cols = [orange, orange, stripe, stripe, orange];
    g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(cols.flatMap((c) => [c.r, c.g, c.b])), 3));
    g.setIndex([0, 1, 2, 0, 2, 3, 0, 3, 4]);
    const m = new THREE.Mesh(g, wingMat);
    m.frustumCulled = false;
    m.visible = false;
    group.add(m);
    geos.push(g);
    return m;
  })();

  const back = (() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(18), 3));
    const orange = new THREE.Color(WING_ORANGE);
    const rig = new THREE.Color("#1f2a3c");
    const cols = [orange, rig, orange, orange, rig, orange];
    g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(cols.flatMap((c) => [c.r, c.g, c.b])), 3));
    g.setIndex([0, 3, 4, 0, 4, 1, 1, 4, 5, 1, 5, 2]);
    const m = new THREE.Mesh(g, wingMat);
    m.frustumCulled = false;
    m.visible = false;
    group.add(m);
    geos.push(g);
    return m;
  })();

  const dialTex = dial();
  const face = new THREE.Mesh(new THREE.CircleGeometry(0.036, 28), new THREE.MeshBasicMaterial({ map: dialTex ?? undefined }));
  const needle = new THREE.Mesh(
    new THREE.PlaneGeometry(0.004, 0.028),
    new THREE.MeshBasicMaterial({ color: "#f2f4f6" }),
  );
  needle.geometry.translate(0, 0.012, 0.0008);
  face.add(needle);
  face.frustumCulled = false;
  needle.frustumCulled = false;
  face.visible = !third;
  group.add(face);
  geos.push(face.geometry, needle.geometry);

  const _a = new THREE.Vector3();
  const _b = new THREE.Vector3();
  const _c = new THREE.Vector3();
  const _d = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  function place(m: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3) {
    _d.subVectors(b, a);
    const len = _d.length() || 1e-4;
    m.position.addVectors(a, b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(up, _d.multiplyScalar(1 / len));
    const r = (m.userData.r as number) ?? 0.05;
    m.scale.set(r, len, (m.userData.depth as number) ?? r);
  }

  // Two-bone IK: elbow/knee from root, target and a pole hint.
  function solve(out: THREE.Vector3, root: THREE.Vector3, target: THREE.Vector3, pole: THREE.Vector3, a: number, b: number) {
    _a.subVectors(target, root);
    let d = _a.length();
    const dir = _a.multiplyScalar(1 / (d || 1));
    d = THREE.MathUtils.clamp(d, Math.abs(a - b) + 1e-3, a + b - 1e-3);
    const along = (a * a + d * d - b * b) / (2 * d);
    const h = Math.sqrt(Math.max(0, a * a - along * along));
    _b.subVectors(pole, root);
    _b.addScaledVector(dir, -_b.dot(dir));
    if (_b.lengthSq() < 1e-8) _b.set(0, -1, 0);
    _b.normalize();
    out.copy(root).addScaledVector(dir, along).addScaledVector(_b, h);
    // Clamp the reach so the hand never stretches past the arm.
    return d;
  }

  const tmp = new THREE.Vector3();
  const wristTip = new THREE.Vector3();
  const pole = new THREE.Vector3();
  const fingerFwd = new THREE.Vector3(0, 0.2, -1).normalize();
  const xAxis = new THREE.Vector3(1, 0, 0);
  const minusZ = new THREE.Vector3(0, 0, -1);
  const trunkQ = new THREE.Quaternion();
  const partQ = new THREE.Quaternion();
  const knee = new THREE.Vector3();
  const hip = new THREE.Vector3();
  const hipEdge = new THREE.Vector3();
  // The trunk pivots at the neck; lying belly-to-earth tips it back 78 degrees.
  const NECK_Y = -0.16;
  const NECK_Z = 0.07;
  const tp = (out: THREE.Vector3, x: number, y: number, z: number) =>
    out.set(x, y - NECK_Y, z - NECK_Z).applyQuaternion(trunkQ).add(_d.set(0, NECK_Y, NECK_Z));

  return {
    group,
    update(frame: THREE.Matrix4, pose: BodyPose, dt: number) {
      group.visible = pose.mode !== "hidden";
      if (!group.visible) return;
      group.matrix.copy(frame);
      group.matrixWorldNeedsUpdate = true;
      const upright = pose.mode !== "freefall";
      const lean = third ? (pose.lean ?? (upright ? 0 : 1)) : 0;
      const trackAmt = pose.trackAmt ?? 0;
      trunkQ.setFromAxisAngle(xAxis, -1.37 * lean);
      const k = 1 - Math.exp(-(pose.gesture ? 22 : 11) * dt);
      const g = pose.gesture ? GESTURES[pose.gesture] : null;

      for (const arm of arms) {
        const s = arm.side;
        if (third) tp(arm.shoulder, s * 0.19, -0.24, 0.07);
        else if (upright) arm.shoulder.set(s * 0.19, -0.24, 0.07);
        else arm.shoulder.set(s * 0.2, -0.24, 0.12);
        const override = s < 0 ? pose.leftHand : pose.rightHand;
        if (g && pose.gestureT < g.dur) {
          track(tmp, s < 0 ? g.left : g.right, pose.gestureT);
        } else if (override) {
          tmp.copy(override);
        } else if (pose.mode === "freefall" && third) {
          // Seen from outside: a relaxed box with bent elbows, or arms back to track, or spread
          // wide to hold a wingsuit open, the inside arm low in a turn.
          const wing = pose.wing ?? 0;
          if (pose.reaching) tmp.set(s * 0.3, 0.2, -0.04);
          else tmp.set(s * 0.45, -0.02, -0.06).lerp(_a.set(s * 0.3, -0.3, 0.62), trackAmt);
          if (!pose.reaching && wing > 0) {
            tmp.lerp(_a.set(s * 0.72, -0.12, 0.2), wing);
            tmp.y += pose.turn * s * 0.06 * wing;
          }
          const flap = Math.min(pose.air / 55, 1) * 0.015;
          tmp.x += Math.sin(pose.time * 29 + s) * flap;
          tmp.y += Math.cos(pose.time * 23 + s * 2) * flap;
        } else if (pose.mode === "freefall") {
          const wing = pose.wing ?? 0;
          if (pose.reaching) tmp.set(s * 0.3, 0.2, -0.04);
          else if (wing > 0) {
            // Arms spread wide to hold the wings open. The arm on the inside of a turn
            // drops; a dive sweeps them back, a flare brings them forward.
            tmp.set(s * 0.37, -0.08, -0.34).lerp(_a.set(s * 0.66, -0.25, -0.26), wing);
            tmp.y += pose.turn * s * 0.07 * wing;
            tmp.z += pose.forward * 0.12 * wing;
            tmp.y -= Math.max(0, -pose.forward) * 0.04 * wing;
          } else if (pose.forward > 0.4) tmp.set(s * 0.43, -0.04, -0.33);
          else if (pose.forward < -0.4) tmp.set(s * 0.27, -0.44, 0.18);
          else tmp.set(s * 0.37, -0.08, -0.34);
          const lean = pose.turn * s * (1 - wing);
          tmp.y += lean * 0.08;
          tmp.z += lean * 0.06;
          const flap = Math.min(pose.air / 55, 1) * 0.012;
          tmp.x += Math.sin(pose.time * 31 + s) * flap;
          tmp.y += Math.cos(pose.time * 27 + s * 2) * flap;
        } else if (pose.mode === "seated") {
          // Astride a bench, hands resting on the thighs.
          tmp.set(s * 0.2, -0.86, -0.3);
        } else if (pose.mode === "perch") {
          // Sitting on the edge of a doorway, hands on the sill either side.
          tmp.set(s * 0.25, -0.8, -0.2);
        } else if (pose.mode === "cabin") {
          // Crouched under the low cabin roof, hands ready in front of the thighs.
          const swing = Math.sin(pose.walk) * 0.06 * s;
          tmp.set(s * 0.2, -0.7, -0.2 + swing);
        } else {
          tmp.set(s * 0.26, -0.8, -0.02);
        }
        arm.target.lerp(tmp, k);
        if (upright) pole.set(arm.shoulder.x + s * 0.7, arm.shoulder.y - 0.4, arm.shoulder.z + 0.4);
        else if (third) pole.set(arm.shoulder.x + s, arm.shoulder.y - 0.15, arm.shoulder.z + 0.1);
        else pole.set(arm.shoulder.x + s * 1.0, arm.shoulder.y + 0.1, arm.shoulder.z + 0.1);
        solve(arm.elbowPos, arm.shoulder, arm.target, pole, UPPER, FORE);
        // Wrist sits exactly a forearm's length from the elbow, toward the target.
        wristTip.subVectors(arm.target, arm.elbowPos).setLength(FORE).add(arm.elbowPos);
        place(arm.upper, arm.shoulder, arm.elbowPos);
        _c.copy(arm.elbowPos).lerp(wristTip, 0.82);
        place(arm.fore, arm.elbowPos, _c);
        place(arm.cuff, _c, wristTip);
        arm.elbow.position.copy(arm.elbowPos);
        arm.shoulderBall.position.copy(arm.shoulder);
        _d.subVectors(wristTip, arm.elbowPos).normalize();
        // In freefall the wrists bend so the palms face the wind, fingers forward.
        if (!upright && !g) _d.lerp(fingerFwd, 0.55).normalize();
        arm.wrist.copy(wristTip);
        arm.hand.position.copy(wristTip);
        arm.hand.quaternion.setFromUnitVectors(minusZ, _d);
        arm.hand.rotateZ(-s * 0.5);
        if (s < 0 && !third) {
          // Wrist altimeter on the left forearm, turned toward the eyes.
          face.position.copy(arm.elbowPos).lerp(wristTip, 0.78);
          _a.copy(face.position).multiplyScalar(-1).normalize();
          face.position.addScaledVector(_a, 0.05);
          face.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), _a);
          needle.rotation.z = -(Math.max(0, pose.altFt) / 12000) * Math.PI * 2;
        }
      }

      const wingAmt = pose.mode === "freefall" ? (pose.wing ?? 0) : 0;
      for (let i = 0; i < 2; i++) {
        const arm = arms[i]!;
        const m = wings[i]!;
        m.visible = wingAmt > 0.02;
        const armMat = wingAmt > 0.5 ? wingTop : suit;
        arm.upper.material = armMat;
        arm.fore.material = armMat;
        arm.elbow.material = armMat;
        arm.shoulderBall.material = armMat;
        if (!m.visible) continue;
        const s = arm.side;
        const pos = m.geometry.getAttribute("position") as THREE.BufferAttribute;
        const slack = 1 - wingAmt;
        const ripple = Math.sin(pose.time * 37 + s) * 0.008 * wingAmt;
        // The trailing edge's root at the hip: behind the eyes where the first-person body lies
        // in flight, or on the leaned trunk seen from outside.
        if (third) tp(hipEdge, s * 0.2, -0.84, 0.07);
        else hipEdge.set(s * 0.24, -0.33, 0.62);
        for (let i = 0; i < 3; i++) {
          // The arm is the leading edge: shoulder, elbow, wrist. The root rides over the top
          // of the shoulder, where the suit's back joins it.
          if (i === 0) _a.set(arm.shoulder.x, arm.shoulder.y + 0.06, arm.shoulder.z + 0.03);
          else _a.copy(i === 1 ? arm.elbowPos : arm.wrist);
          // The trailing edge runs from the hip, behind the eyes where the body lies in flight,
          // out to a hand's width behind the wrist, curving in a little between them.
          if (i === 0) _b.copy(hipEdge);
          else if (i === 2) _b.copy(arm.wrist).add(_c.set(-s * 0.03, -0.02, 0.2));
          else {
            _b.copy(arm.wrist).add(_c.set(-s * 0.03, -0.02, 0.2));
            _b.lerp(hipEdge, 0.5);
            _b.x -= s * 0.03;
            _b.y += ripple;
          }
          // Until the suit fills, the fabric hangs slack in toward the arm.
          _b.lerp(_a, 0.6 * slack);
          _b.y -= 0.08 * slack;
          // The middle bulges up where the air fills it.
          const bulge = [0.04, 0.045, 0.02][i]! * wingAmt;
          for (let j = 0; j < NC; j++) {
            _c.copy(_a).lerp(_b, CHORD[j]!);
            pos.setXYZ(i * NC + j, _c.x, _c.y + BULGE[j]! * bulge, _c.z);
          }
        }
        pos.needsUpdate = true;
        m.geometry.computeVertexNormals();
      }
      if (third) {
        // Outside, the whole suit is the wing's color.
        const m = wingAmt > 0.5 ? wingTop : suit;
        torso.material = m;
        chest.material = m;
        for (const leg of legs) {
          leg.thigh.material = m;
          leg.shin.material = m;
          leg.knee.material = m;
        }
      }
      tail.visible = third && wingAmt > 0.02;
      back.visible = !third && wingAmt > 0.02;
      if (back.visible) {
        // The suit's back between the wing roots, with the rig down the middle.
        const pos = back.geometry.getAttribute("position") as THREE.BufferAttribute;
        const sh = arms[0]!.shoulder;
        pos.setXYZ(0, sh.x, sh.y + 0.06, sh.z + 0.03);
        pos.setXYZ(1, 0, sh.y + 0.04, sh.z + 0.1);
        pos.setXYZ(2, -sh.x, sh.y + 0.06, sh.z + 0.03);
        pos.setXYZ(3, -0.24, -0.33, 0.62);
        pos.setXYZ(4, 0, -0.28, 0.62);
        pos.setXYZ(5, 0.24, -0.33, 0.62);
        pos.needsUpdate = true;
        back.geometry.computeVertexNormals();
      }

      const showLegs = upright || third;
      torso.visible = showLegs;
      hips.visible = showLegs;
      chest.visible = showLegs;
      chestStrap.visible = showLegs;
      webs.forEach((w) => (w.visible = showLegs));
      legStraps.forEach((l) => (l.visible = showLegs));
      for (const leg of legs) {
        leg.thigh.visible = showLegs;
        leg.shin.visible = showLegs;
        leg.knee.visible = showLegs;
        leg.foot.visible = showLegs;
      }
      if (!showLegs) return;

      // Placed waist-to-shoulders so the wide end of the trunk is at the chest.
      tp(_a, 0, -0.22, 0.07);
      tp(_b, 0, -0.74, 0.07);
      place(torso, _b, _a);
      tp(chest.position, 0, -0.22, 0.07);
      chest.quaternion.copy(trunkQ);
      chest.scale.set(0.17, 0.06, 0.11);
      tp(hips.position, 0, -0.76, 0.07);
      hips.quaternion.copy(trunkQ);
      hips.scale.set(0.155, 0.1, 0.11);
      tp(chestStrap.position, 0, -0.38, -0.045);
      chestStrap.quaternion.copy(trunkQ);
      if (third) {
        tp(_a, 0, -0.2, 0.07);
        place(neck, _c.set(0, -0.08, 0.08), _a);
        tp(container.position, 0, -0.5, 0.245);
        container.quaternion.copy(trunkQ);
        tp(tray.position, 0, -0.24, 0.245);
        tray.quaternion.copy(trunkQ);
      }
      for (let i = 0; i < 2; i++) {
        const s = i === 0 ? -1 : 1;
        tp(_a, s * 0.1, -0.24, -0.04);
        tp(_b, s * 0.12, -0.8, -0.04);
        place(webs[i]!, _a, _b);
        const strap = legStraps[i]!;
        tp(strap.position, s * 0.1, -0.86, 0.06);
        strap.quaternion.copy(trunkQ).multiply(partQ.setFromAxisAngle(xAxis, Math.PI / 2));
      }
      const hanging = pose.mode === "canopy";
      const prone = third && pose.mode === "freefall";
      for (const leg of legs) {
        const s = leg.side;
        tp(hip, s * 0.09, -0.78, 0.07);
        if (prone) {
          // Belly-to-earth: knees down, shins up behind. Tracking straightens the legs, and a
          // wingsuit spreads them to open the tail wing.
          tmp.set(s * 0.2, -1.38, 0.32).lerp(_a.set(s * 0.13, -1.62, 0.12), trackAmt);
          if (wingAmt > 0) tmp.lerp(_a.set(s * 0.27, -1.6, 0.1), wingAmt);
          tp(tmp, tmp.x, tmp.y, tmp.z);
        } else if (pose.mode === "seated") {
          // Straddling a bench: feet flat on the floor either side of it.
          tmp.set(s * 0.33, -1.49, -0.14);
        } else if (pose.mode === "perch") {
          // Legs out over the edge, boots hanging over the skid below.
          tmp.set(s * 0.16, -1.25, -0.6);
        } else if (pose.mode === "cabin") {
          // The Twin Otter cabin is too low to stand straight; knees stay bent.
          const stride = Math.sin(pose.walk + (s > 0 ? Math.PI : 0)) * 0.12;
          tmp.set(s * 0.12, -1.42, 0.02 + stride);
        } else if (hanging) {
          const sway = Math.sin(pose.time * 1.3 + s) * 0.03;
          tmp.set(s * 0.11, -1.6, 0.1 + sway);
          tmp.lerp(_a.set(s * 0.08, -1.5, -0.32), pose.flare);
          tp(tmp, tmp.x, tmp.y, tmp.z);
        } else {
          tmp.set(s * 0.13, -1.52, 0.05);
        }
        leg.footPos.lerp(tmp, 1 - Math.exp(-9 * dt));
        if (prone) tp(pole, s * 0.24, -1.1, -0.9);
        else if (pose.mode === "seated") pole.set(hip.x + s * 0.7, hip.y - 0.05, hip.z - 0.6);
        else if (pose.mode === "perch") pole.set(hip.x + s * 0.25, hip.y + 0.35, hip.z - 0.9);
        else pole.set(hip.x + s * 0.1, hip.y - 0.2, hip.z - 0.8);
        solve(knee, hip, leg.footPos, pole, THIGH, SHIN);
        const ankle = _a.subVectors(leg.footPos, knee).setLength(SHIN).add(knee);
        place(leg.thigh, hip, knee);
        place(leg.shin, knee, ankle);
        leg.knee.position.copy(knee);
        leg.kneeAt.copy(knee);
        leg.ankleAt.copy(ankle);
        if (prone) {
          // Pointed toes, along the shin.
          _b.subVectors(ankle, knee).normalize();
          leg.foot.quaternion.setFromUnitVectors(minusZ, _b);
          leg.foot.position.copy(ankle).addScaledVector(_b, 0.07);
        } else {
          leg.foot.position.copy(ankle).add(_b.set(0, -0.03, -0.08));
          leg.foot.rotation.set(hanging ? 0.35 - pose.flare * 0.45 : 0, 0, 0);
        }
      }
      if (tail.visible) {
        const pos = tail.geometry.getAttribute("position") as THREE.BufferAttribute;
        const [l, r] = legs as [(typeof legs)[0], (typeof legs)[0]];
        tp(_a, 0, -0.9, 0.09);
        pos.setXYZ(0, _a.x, _a.y, _a.z);
        pos.setXYZ(1, l.kneeAt.x, l.kneeAt.y, l.kneeAt.z);
        pos.setXYZ(2, l.ankleAt.x, l.ankleAt.y, l.ankleAt.z);
        pos.setXYZ(3, r.ankleAt.x, r.ankleAt.y, r.ankleAt.z);
        pos.setXYZ(4, r.kneeAt.x, r.kneeAt.y, r.kneeAt.z);
        pos.needsUpdate = true;
        tail.geometry.computeVertexNormals();
      }
    },
    dispose() {
      geos.forEach((g) => g.dispose());
      [suit, suitDark, glove, shoe, harness, helmetMat, visorMat, rigMat, trayMat, wingMat, wingTop].forEach((m) =>
        m.dispose(),
      );
      dialTex?.dispose();
      (face.material as THREE.Material).dispose();
      (needle.material as THREE.Material).dispose();
    },
  };
}
