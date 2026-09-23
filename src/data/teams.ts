/** Fictional teams. Colors are hex numbers consumed by both the renderer and the UI. */
export interface TeamColors {
  primary: number;
  secondary: number;
  accent: number;
}

export interface TeamDef {
  id: string;
  city: string;
  name: string;
  /** Three-letter scoreboard abbreviation. */
  short: string;
  colors: TeamColors;
  arena: { name: string; floorTint: number };
  roster: readonly string[];
}

export const TEAMS: readonly TeamDef[] = [
  {
    id: 'comets', city: 'Vantage City', name: 'Comets', short: 'VCC',
    colors: { primary: 0x1f6fff, secondary: 0xf4f7ff, accent: 0xffc83d },
    arena: { name: 'Meridian Dome', floorTint: 0xd9a066 },
    roster: ['dorian-vale', 'marek-holloway', 'tobias-crane', 'nnamdi-roarke', 'evander-stroud'],
  },
  {
    id: 'tides', city: 'Port Solace', name: 'Tides', short: 'PST',
    colors: { primary: 0x00a6a6, secondary: 0x0e1f3d, accent: 0xe8f7f7 },
    arena: { name: 'Harborline Pavilion', floorTint: 0xcf9a5f },
    roster: ['caius-whitlock', 'rafe-oyelaran', 'soren-lindqvist', 'dax-moreau', 'bram-keteku'],
  },
  {
    id: 'foxes', city: 'Emberfall', name: 'Foxes', short: 'EMB',
    colors: { primary: 0xff6a13, secondary: 0x262626, accent: 0xfff1e0 },
    arena: { name: 'Cinder Hall', floorTint: 0xd49a62 },
    roster: ['quincy-ashdown', 'lior-benhamou', 'anton-varga', 'mateo-salcedo', 'hollis-grange'],
  },
  {
    id: 'owls', city: 'Glacier Bay', name: 'Owls', short: 'GBO',
    colors: { primary: 0x5b3fa8, secondary: 0x9ad8ff, accent: 0xffffff },
    arena: { name: 'Aurora Court', floorTint: 0xdcae78 },
    roster: ['emeric-faye', 'tavian-rhodes', 'niko-varda', 'osric-blane', 'gideon-mbeki'],
  },
  {
    id: 'vipers', city: 'Sunset Mesa', name: 'Vipers', short: 'SMV',
    colors: { primary: 0x7bc618, secondary: 0x111111, accent: 0xf2ffe0 },
    arena: { name: 'Red Rock Arena', floorTint: 0xc98f58 },
    roster: ['zeke-talmadge', 'callum-reyes', 'imani-okoro', 'brennan-voss', 'ulrich-stenberg'],
  },
  {
    id: 'bison', city: 'Ironhaven', name: 'Bison', short: 'IRB',
    colors: { primary: 0xc8102e, secondary: 0xb08d57, accent: 0xffffff },
    arena: { name: 'Foundry Fieldhouse', floorTint: 0xd6a36c },
    roster: ['remy-castellanos', 'otis-farrow', 'jarek-novak', 'silas-hargrove', 'magnus-adeyemi'],
  },
];

export function getTeam(id: string): TeamDef {
  const team = TEAMS.find((t) => t.id === id);
  if (!team) throw new Error(`Unknown team id "${id}"`);
  return team;
}

export function colorToCss(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}
