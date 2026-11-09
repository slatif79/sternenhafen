import type { HarborKind, Resource, Terrain } from '../engine/types';

export const TERRAIN_STYLE: Record<Terrain, { name: string; color: string; icon: string }> = {
  asteroid: { name: 'Asteroid', color: '#8b8299', icon: '🪨' },
  icefield: { name: 'Eisfeld', color: '#6fc3e6', icon: '❄️' },
  nebula: { name: 'Kristallnebel', color: '#a77be6', icon: '💎' },
  biodome: { name: 'Biokuppel', color: '#5cbd6b', icon: '🌱' },
  gascloud: { name: 'Gaswolke', color: '#e9a646', icon: '⚡' },
  void: { name: 'Leerer Raum', color: '#232a46', icon: '' },
};

export const RESOURCE_STYLE: Record<Resource, { name: string; icon: string; color: string }> = {
  ore: { name: 'Erz', icon: '🪨', color: TERRAIN_STYLE.asteroid.color },
  ice: { name: 'Eis', icon: '❄️', color: TERRAIN_STYLE.icefield.color },
  crystal: { name: 'Kristall', icon: '💎', color: TERRAIN_STYLE.nebula.color },
  food: { name: 'Nahrung', icon: '🌱', color: TERRAIN_STYLE.biodome.color },
  fuel: { name: 'Treibstoff', icon: '⚡', color: TERRAIN_STYLE.gascloud.color },
};

export function harborLabel(kind: HarborKind): { ratio: string; icon: string } {
  return kind === 'any' ? { ratio: '3:1', icon: '' } : { ratio: '2:1', icon: RESOURCE_STYLE[kind].icon };
}
