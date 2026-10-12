import * as THREE from "three";
import { WING } from "./canopy";
import { SUN_DIR } from "./world";

// Shadows on the ground for canopies and jumpers. On final you judge height by your own shadow:
// it runs out ahead of you toward the lake and comes back to meet your feet as you touch down.
// The sun is low in the west, so each shadow is cast east along the ray from the sun. A
// horizontal wing keeps its shape when projected; an upright body stretches into a streak.

/** Above this height (m) a shadow is too soft and far away to see. */
const FADE_H = 420;
/** The sun is about half a degree across, so a shadow's edge softens with distance along the ray. */
const SUN_SPREAD = 0.0093;
const BODY_H = 1.75;
const BODY_W = 0.5;

export type ShadowCaster = {
  /** Feet of the jumper, in world space. */
  feet: THREE.Vector3;
  /** Their canopy group, or null when no canopy is out. */
  wing: THREE.Object3D | null;
};

export type Shadows = {
  update: (casters: readonly ShadowCaster[], eye: THREE.Vector3) => void;
  dispose: () => void;
};

/** A soft-edged shape: draw it off canvas and keep only its blurred shadow. */
function softTexture(
  w: number,
  h: number,
  blur: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.shadowColor = "#fff";
    ctx.shadowBlur = blur;
    ctx.shadowOffsetX = w * 4;
    ctx.translate(-w * 4, 0);
    ctx.fillStyle = "#fff";
    draw(ctx);
    // Coverage into the color channels, which is what an alpha map reads.
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = d[i + 1] = d[i + 2] = d[i + 3]!;
      d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

export function createShadows(scene: THREE.Scene, count = 3): Shadows {
  // The texture spans 1 unit in mesh space with a margin, so it is scaled up to leave room for the blur.
  const wingTex = softTexture(256, 128, 10, (ctx) => {
    ctx.beginPath();
    ctx.roundRect(24, 26, 208, 76, [30, 30, 18, 18]);
    ctx.fill();
  });
  const bodyTex = softTexture(64, 128, 8, (ctx) => {
    ctx.beginPath();
    ctx.ellipse(32, 64, 18, 52, 0, 0, Math.PI * 2);
    ctx.fill();
  });
  const plane = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const material = (map: THREE.Texture) =>
    new THREE.MeshBasicMaterial({
      color: "#000",
      alphaMap: map,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: false,
      // Over every ground decal, the landing disc included.
      polygonOffset: true,
      polygonOffsetFactor: -6,
      polygonOffsetUnits: -24,
    });
  const make = (map: THREE.Texture) => {
    const mesh = new THREE.Mesh(plane, material(map));
    mesh.visible = false;
    mesh.renderOrder = 1;
    mesh.frustumCulled = false;
    scene.add(mesh);
    return mesh;
  };
  const wings = Array.from({ length: count }, () => make(wingTex));
  const bodies = Array.from({ length: count }, () => make(bodyTex));

  const mid = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const head = new THREE.Vector3();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();

  /** Where a point's shadow lands on the ground. */
  const project = (out: THREE.Vector3, p: THREE.Vector3) =>
    out
      .copy(p)
      .addScaledVector(SUN_DIR, -Math.max(0, p.y) / SUN_DIR.y)
      .setY(0.02);
  const strength = (h: number, at: THREE.Vector3, eye: THREE.Vector3) =>
    (1 - THREE.MathUtils.smoothstep(h, 12, FADE_H)) *
    (1 - THREE.MathUtils.smoothstep(at.distanceTo(eye), 500, 1100));

  return {
    update(casters, eye) {
      for (let i = 0; i < count; i++) {
        const c = casters[i];
        const wing = wings[i]!;
        const body = bodies[i]!;
        wing.visible = false;
        body.visible = false;
        if (!c || c.feet.y > FADE_H + 10) continue;

        if (c.wing?.visible) {
          c.wing.updateWorldMatrix(true, false);
          mid.set(0, WING.y, WING.z).applyMatrix4(c.wing.matrixWorld);
          c.wing.getWorldDirection(fwd);
          project(wing.position, mid);
          const spread = (mid.y / SUN_DIR.y) * SUN_SPREAD;
          const k = strength(mid.y, wing.position, eye);
          if (k > 0.01) {
            wing.visible = true;
            wing.rotation.y = Math.atan2(fwd.x, fwd.z);
            // The texture's shape fills about 80% by 60% of it.
            wing.scale.set((WING.span + spread) / 0.8, 1, (WING.chord + spread) / 0.6);
            (wing.material as THREE.MeshBasicMaterial).opacity =
              0.42 * k * (WING.chord / (WING.chord + spread));
          }
        }

        project(a, c.feet);
        project(b, head.copy(c.feet).setY(c.feet.y + BODY_H));
        const k = strength(c.feet.y, a, eye);
        if (k > 0.01) {
          const spread = (c.feet.y / SUN_DIR.y) * SUN_SPREAD;
          b.sub(a);
          body.visible = true;
          body.position.copy(a).addScaledVector(b, 0.5);
          body.rotation.y = Math.atan2(b.x, b.z);
          // The ellipse fills about 56% by 81% of its texture.
          body.scale.set((BODY_W + spread) / 0.56, 1, (b.length() + BODY_W + spread) / 0.81);
          (body.material as THREE.MeshBasicMaterial).opacity =
            0.48 * k * (BODY_W / (BODY_W + spread));
        }
      }
    },
    dispose() {
      for (const m of [...wings, ...bodies]) {
        scene.remove(m);
        (m.material as THREE.Material).dispose();
      }
      plane.dispose();
      wingTex.dispose();
      bodyTex.dispose();
    },
  };
}
