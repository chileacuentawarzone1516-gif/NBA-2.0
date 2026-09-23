import { ARCHETYPES } from '../data/archetypes';
import { combineModifiers } from '../data/modifiers';
import type { PlayerDef } from '../data/players';
import { SKILLS, type SkillId } from '../data/skills';
import { BODY, STAMINA } from '../data/tuning';
import { ratingT } from '../data/attributes';
import { vec3 } from '../core/math';
import { emptyStats, type ActionState, type SimPlayer, type TeamIndex } from './types';

export interface RosterEntry {
  def: PlayerDef;
  skills?: readonly SkillId[];
}

export function emptyAction(): ActionState {
  return {
    kind: 'none', t: 0, duration: 0, moveId: null, dirX: 0, dirZ: 0, sideX: 0, sideZ: 0,
    shotType: null, releaseTime: 0, released: false, resolved: false, targetId: -1,
  };
}

export function resetAction(action: ActionState): void {
  action.kind = 'none';
  action.t = 0;
  action.duration = 0;
  action.moveId = null;
  action.dirX = 0;
  action.dirZ = 0;
  action.sideX = 0;
  action.sideZ = 0;
  action.shotType = null;
  action.releaseTime = 0;
  action.released = false;
  action.resolved = false;
  action.targetId = -1;
}

export function createSimPlayer(id: number, team: TeamIndex, slot: number, entry: RosterEntry): SimPlayer {
  const { def } = entry;
  const archetype = ARCHETYPES[def.archetype];
  const skillMods = (entry.skills ?? []).map((skill) => SKILLS[skill].modifiers);
  const jumpRange = BODY.jumpHeightRange;
  const jumpHeight = jumpRange[0] + (jumpRange[1] - jumpRange[0]) * ratingT(def.attributes.vertical);
  return {
    id,
    team,
    slot,
    defId: def.id,
    name: def.lastName,
    number: def.number,
    position: def.position,
    archetype: def.archetype,
    attr: { ...def.attributes },
    mods: combineModifiers(archetype.modifiers, ...skillMods),
    tendencies: archetype.tendencies,
    height: def.height,
    build: def.build,
    look: def.look,
    reach: def.height * BODY.reachRatio,
    jumpHeight,
    pos: vec3(),
    prevPos: vec3(),
    vel: { x: 0, z: 0 },
    vy: 0,
    jumpG: 0,
    airborne: false,
    facing: 0,
    prevFacing: 0,
    stamina: STAMINA.max,
    exhausted: false,
    hand: 1,
    action: emptyAction(),
    prevButtons: 0,
    sprinting: false,
    inStance: false,
    boostMultiplier: 1,
    boostTime: 0,
    sinceMove: 99,
    lastMoveShotStyle: null,
    stealCooldown: 0,
    callForBall: 0,
    autoRelease: false,
    sinceCatch: 99,
    lastPasser: -1,
    stats: emptyStats(),
  };
}
