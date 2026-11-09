// Grundlegende Spieltypen für „Sternenhafen“.

export type Resource = 'ore' | 'ice' | 'crystal' | 'food' | 'fuel';

export const RESOURCES: Resource[] = ['ore', 'ice', 'crystal', 'food', 'fuel'];

export type Terrain = 'asteroid' | 'icefield' | 'nebula' | 'biodome' | 'gascloud' | 'void';

/** Welcher Rohstoff wird von welchem Feld abgebaut (der leere Raum liefert nichts). */
export const TERRAIN_RESOURCE: Record<Terrain, Resource | null> = {
  asteroid: 'ore',
  icefield: 'ice',
  nebula: 'crystal',
  biodome: 'food',
  gascloud: 'fuel',
  void: null,
};

export interface Tile {
  hexId: number;
  terrain: Terrain;
  /** Zahlenchip 2–12, null beim leeren Raum */
  number: number | null;
}

export type HarborKind = Resource | 'any';

export interface Harbor {
  /** Küstenkante, an der der Hafen liegt */
  edgeId: number;
  kind: HarborKind;
}

export interface Board {
  seed: number;
  tiles: Tile[];
  harbors: Harbor[];
  /** Feld, auf dem das Piratenschiff steht */
  pirateHex: number;
}
