import * as THREE from "three";

// The city as solid boxes, so you can land on a roof, walk across it and step off, and so a
// canopy flown into a wall stops there instead of passing through. Every building is an
// axis-aligned box: the city blocks exactly, the landmarks one box per part, which is close
// enough for towers that rise straight and a little generous for the ones that taper.

export type Solid = { x0: number; x1: number; z0: number; z1: number; y0: number; y1: number };

/** Where a fall or a step ended: on top of a solid, or against its side. */
export type Contact = { top: true; y: number; solid: Solid } | { top: false; solid: Solid };

const CELL = 64;
const OFFSET = 1 << 12;
const key = (i: number, j: number) => (i + OFFSET) * (OFFSET * 2) + (j + OFFSET);

export class Solids {
  readonly list: Solid[] = [];
  private grid = new Map<number, number[]>();

  add(s: Solid) {
    const id = this.list.push(s) - 1;
    for (let i = Math.floor(s.x0 / CELL); i <= Math.floor(s.x1 / CELL); i++) {
      for (let j = Math.floor(s.z0 / CELL); j <= Math.floor(s.z1 / CELL); j++) {
        const k = key(i, j);
        const cell = this.grid.get(k);
        if (cell) cell.push(id);
        else this.grid.set(k, [id]);
      }
    }
  }

  /** Adds a mesh's world bounds, if it is big enough to stand on or fly into. */
  addMesh(mesh: THREE.Mesh, box = new THREE.Box3()) {
    box.setFromObject(mesh);
    if (box.isEmpty() || box.max.y - box.min.y < 3) return;
    // Masts, spires and railings are too thin to matter.
    if (Math.min(box.max.x - box.min.x, box.max.z - box.min.z) < 3) return;
    const y0 = Math.max(0, box.min.y);
    const y1 = box.max.y;
    const geo = mesh.geometry;
    if (geo instanceof THREE.ExtrudeGeometry) {
      this.addPlan(geo, mesh.matrixWorld, box, y0, y1);
      return;
    }
    const taper = geo.userData.taper as readonly [number, number] | undefined;
    if (taper) {
      // A tower that narrows as it rises: slabs as wide as it is halfway up each one.
      const cx = (box.min.x + box.max.x) / 2;
      const cz = (box.min.z + box.max.z) / 2;
      const hw = (box.max.x - box.min.x) / 2;
      const hd = (box.max.z - box.min.z) / 2;
      const n = 4;
      for (let k = 0; k < n; k++) {
        const u = (k + 0.5) / n;
        const kx = 1 + (taper[0] - 1) * u;
        const kz = 1 + (taper[1] - 1) * u;
        this.add({
          x0: cx - hw * kx,
          x1: cx + hw * kx,
          z0: cz - hd * kz,
          z1: cz + hd * kz,
          y0: y0 + ((y1 - y0) * k) / n,
          y1: y0 + ((y1 - y0) * (k + 1)) / n,
        });
      }
      return;
    }
    this.add({ x0: box.min.x, x1: box.max.x, z0: box.min.z, z1: box.max.z, y0, y1 });
  }

  /**
   * A building extruded from a plan, like a curve or a trefoil, as strips of 6 m cells over
   * its footprint: its bounding box alone would put a roof over the open side of a curve.
   */
  private addPlan(
    geo: THREE.ExtrudeGeometry,
    world: THREE.Matrix4,
    box: THREE.Box3,
    y0: number,
    y1: number,
  ) {
    const shapes = geo.parameters.shapes;
    const shape = Array.isArray(shapes) ? shapes[0] : shapes;
    if (!shape) return;
    // prism() turns the plan's y into -z before the mesh is placed.
    const pts = shape
      .extractPoints(8)
      .shape.map((p) => new THREE.Vector3(p.x, 0, -p.y).applyMatrix4(world));
    const inside = (x: number, z: number) => {
      let hit = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const a = pts[i]!;
        const b = pts[j]!;
        if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) hit = !hit;
      }
      return hit;
    };
    const C = 6;
    for (let z = box.min.z + C / 2; z < box.max.z; z += C) {
      let run: number | null = null;
      for (let x = box.min.x + C / 2; x < box.max.x + C; x += C) {
        const fill = x < box.max.x && inside(x, z);
        if (fill && run === null) run = x;
        if (!fill && run !== null) {
          this.add({ x0: run - C / 2, x1: x - C / 2, z0: z - C / 2, z1: z + C / 2, y0, y1 });
          run = null;
        }
      }
    }
  }

  private *near(x: number, z: number) {
    const cell = this.grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!cell) return;
    for (const id of cell) yield this.list[id]!;
  }

  /** The highest roof under (x, z) at or below `below`, or null over open ground. */
  top(x: number, z: number, below = Infinity): Solid | null {
    let best: Solid | null = null;
    for (const s of this.near(x, z)) {
      if (x < s.x0 || x > s.x1 || z < s.z0 || z > s.z1 || s.y1 > below) continue;
      if (!best || s.y1 > best.y1) best = s;
    }
    return best;
  }

  /** A solid that a body `r` wide at (x, z), from `y` up to `y + h`, would be inside. */
  blocked(x: number, y: number, z: number, r: number, h: number): Solid | null {
    for (const s of this.near(x, z)) {
      if (x < s.x0 - r || x > s.x1 + r || z < s.z0 - r || z > s.z1 + r) continue;
      if (y + h > s.y0 && y < s.y1 - 0.02) return s;
    }
    return null;
  }

  /**
   * Moving from `from` to `to`: landed on a roof if the feet came down through its top,
   * or hit a wall if they went into its side.
   */
  contact(from: THREE.Vector3, to: THREE.Vector3, r: number): Contact | null {
    let roof: Solid | null = null;
    let wall: Solid | null = null;
    for (const s of this.near(to.x, to.z)) {
      if (to.x < s.x0 - r || to.x > s.x1 + r || to.z < s.z0 - r || to.z > s.z1 + r) continue;
      if (to.y >= s.y1 || to.y + 1.6 < s.y0) continue;
      const over = to.x >= s.x0 && to.x <= s.x1 && to.z >= s.z0 && to.z <= s.z1;
      // Coming down through the top lands on it, even beside a neighbor of the same height.
      if (over && from.y >= s.y1 - 0.05) {
        if (!roof || s.y1 > roof.y1) roof = s;
      } else wall = s;
    }
    if (roof) return { top: true, y: roof.y1, solid: roof };
    return wall ? { top: false, solid: wall } : null;
  }
}
