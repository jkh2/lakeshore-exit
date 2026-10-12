import * as THREE from "three";

// Specks of moisture and dust hanging in the air. You fall through them, so they streak
// past at your speed: thin lines in clear air, a rush of them inside a cloud.

const RANGE = 20;

export type Streaks = {
  /** `airVel` is your velocity through the air; `amount` 0 to 1 sets how many show and how bright. */
  update: (eye: THREE.Vector3, airVel: THREE.Vector3, amount: number) => void;
  dispose: () => void;
};

export function createStreaks(scene: THREE.Scene, count = 220): Streaks {
  const pts = Array.from({ length: count }, () => new THREE.Vector3(1e9, 0, 0));
  const seeds = Array.from({ length: count }, () => Math.random());
  const pos = new Float32Array(count * 6);
  const col = new Float32Array(count * 8);
  const geo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
  const colAttr = new THREE.BufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute("position", posAttr);
  geo.setAttribute("color", colAttr);
  const mat = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  lines.visible = false;
  scene.add(lines);

  const dir = new THREE.Vector3();
  const side = new THREE.Vector3();
  const up = new THREE.Vector3();
  const rel = new THREE.Vector3();

  /** Drops a speck somewhere ahead along the direction of travel. */
  function respawn(p: THREE.Vector3, eye: THREE.Vector3, anywhere: boolean) {
    const ahead = anywhere
      ? (Math.random() * 2 - 1) * RANGE
      : RANGE * (0.35 + Math.random() * 0.65);
    p.copy(eye)
      .addScaledVector(dir, ahead)
      .addScaledVector(side, (Math.random() * 2 - 1) * RANGE * 0.6)
      .addScaledVector(up, (Math.random() * 2 - 1) * RANGE * 0.6);
  }

  return {
    update(eye, airVel, amount) {
      const speed = airVel.length();
      lines.visible = amount > 0.01 && speed > 2;
      if (!lines.visible) return;
      dir.copy(airVel).divideScalar(speed);
      side.set(0, 1, 0).cross(dir);
      if (side.lengthSq() < 1e-4) side.set(1, 0, 0);
      side.normalize();
      up.crossVectors(dir, side);
      const tail = Math.min(0.055, 3 / speed);
      const shown = Math.floor(count * Math.min(1, amount));
      for (let i = 0; i < count; i++) {
        const p = pts[i]!;
        rel.subVectors(p, eye);
        if (rel.lengthSq() > RANGE * RANGE * 2.2)
          respawn(p, eye, rel.lengthSq() > RANGE * RANGE * 40);
        rel.subVectors(p, eye);
        const d = rel.length();
        const on = i < shown;
        // Bright up close, gone at the edge of the range and right at the eye.
        const fade = Math.min(1, (RANGE - d) / (RANGE * 0.6)) * Math.min(1, d / 1.2);
        const a = on ? fade * (0.15 + 0.3 * seeds[i]!) * (0.4 + 0.6 * amount) : 0;
        const o = i * 6;
        pos[o] = p.x;
        pos[o + 1] = p.y;
        pos[o + 2] = p.z;
        pos[o + 3] = p.x + airVel.x * tail;
        pos[o + 4] = p.y + airVel.y * tail;
        pos[o + 5] = p.z + airVel.z * tail;
        const c = i * 8;
        col.fill(0.92, c, c + 3);
        col[c + 3] = Math.max(0, a);
        col.fill(0.92, c + 4, c + 7);
        col[c + 7] = 0;
      }
      posAttr.needsUpdate = true;
      colAttr.needsUpdate = true;
    },
    dispose() {
      scene.remove(lines);
      geo.dispose();
      mat.dispose();
    },
  };
}
