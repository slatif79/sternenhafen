// Hex-Geometrie und Brett-Topologie (Felder, Ecken, Kanten).
// Spitze Hexagone ("pointy-top") in axialen Koordinaten (q, r), Kantenlänge 1.

export interface Hex {
  id: number;
  q: number;
  r: number;
  x: number;
  y: number;
  /** Ecken-IDs im Uhrzeigersinn, beginnend oben */
  vertices: number[];
  /** Kanten-IDs, edges[i] verbindet vertices[i] und vertices[i+1] */
  edges: number[];
  /** Benachbarte Felder */
  neighbors: number[];
}

export interface Vertex {
  id: number;
  x: number;
  y: number;
  hexes: number[];
  /** Über eine Kante erreichbare Nachbarecken */
  neighbors: number[];
  edges: number[];
}

export interface Edge {
  id: number;
  /** Die beiden Endpunkte (Ecken-IDs) */
  a: number;
  b: number;
  hexes: number[];
}

export interface Topology {
  hexes: Hex[];
  vertices: Vertex[];
  edges: Edge[];
  /** Küstenkanten (gehören zu genau einem Feld), im Uhrzeigersinn sortiert */
  coastEdges: number[];
}

const SQRT3 = Math.sqrt(3);

export function hexToPixel(q: number, r: number): { x: number; y: number } {
  return { x: SQRT3 * (q + r / 2), y: 1.5 * r };
}

/** Ecke i (0 = oben, im Uhrzeigersinn) eines Feldes mit Mittelpunkt (cx, cy). */
export function cornerOffset(i: number): { x: number; y: number } {
  const angle = (Math.PI / 180) * (60 * i - 90);
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

const AXIAL_DIRS: [number, number][] = [
  [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1],
];

/** Alle Felder eines sechseckigen Bretts mit gegebenem Radius (Basisspiel: 2 → 19 Felder). */
export function hexCoords(radius: number): [number, number][] {
  const out: [number, number][] = [];
  for (let r = -radius; r <= radius; r++) {
    for (let q = -radius; q <= radius; q++) {
      if (Math.abs(q + r) <= radius) out.push([q, r]);
    }
  }
  return out;
}

export function buildTopology(radius = 2): Topology {
  const coords = hexCoords(radius);
  const hexes: Hex[] = [];
  const vertices: Vertex[] = [];
  const edges: Edge[] = [];
  const vertexKey = new Map<string, number>();
  const edgeKey = new Map<string, number>();
  const hexKey = new Map<string, number>();

  const keyOf = (x: number, y: number) => `${Math.round(x * 1000)},${Math.round(y * 1000)}`;

  coords.forEach(([q, r], id) => {
    const { x, y } = hexToPixel(q, r);
    hexKey.set(`${q},${r}`, id);
    const hex: Hex = { id, q, r, x, y, vertices: [], edges: [], neighbors: [] };

    for (let i = 0; i < 6; i++) {
      const o = cornerOffset(i);
      const vx = x + o.x;
      const vy = y + o.y;
      const k = keyOf(vx, vy);
      let vid = vertexKey.get(k);
      if (vid === undefined) {
        vid = vertices.length;
        vertexKey.set(k, vid);
        vertices.push({ id: vid, x: vx, y: vy, hexes: [], neighbors: [], edges: [] });
      }
      vertices[vid].hexes.push(id);
      hex.vertices.push(vid);
    }

    for (let i = 0; i < 6; i++) {
      const a = hex.vertices[i];
      const b = hex.vertices[(i + 1) % 6];
      const k = a < b ? `${a}-${b}` : `${b}-${a}`;
      let eid = edgeKey.get(k);
      if (eid === undefined) {
        eid = edges.length;
        edgeKey.set(k, eid);
        edges.push({ id: eid, a: Math.min(a, b), b: Math.max(a, b), hexes: [] });
        vertices[a].neighbors.push(b);
        vertices[b].neighbors.push(a);
        vertices[a].edges.push(eid);
        vertices[b].edges.push(eid);
      }
      edges[eid].hexes.push(id);
      hex.edges.push(eid);
    }
    hexes.push(hex);
  });

  for (const hex of hexes) {
    for (const [dq, dr] of AXIAL_DIRS) {
      const n = hexKey.get(`${hex.q + dq},${hex.r + dr}`);
      if (n !== undefined) hex.neighbors.push(n);
    }
  }

  const coastEdges = edges
    .filter((e) => e.hexes.length === 1)
    .map((e) => {
      const mx = (vertices[e.a].x + vertices[e.b].x) / 2;
      const my = (vertices[e.a].y + vertices[e.b].y) / 2;
      return { id: e.id, angle: Math.atan2(my, mx) };
    })
    .sort((p, q) => p.angle - q.angle)
    .map((p) => p.id);

  return { hexes, vertices, edges, coastEdges };
}
