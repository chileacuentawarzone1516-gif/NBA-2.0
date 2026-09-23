import { distanceToHoop } from '../data/court';
import type { SimPlayer, TeamIndex } from '../sim/types';
import type { World } from '../sim/world';
import { SPACING_SPOTS, spotWorld } from './perception';

/**
 * Team-level tactical layer: man-to-man assignments, the designated help defender and
 * off-ball spacing spots. Player brains read these instead of each deciding alone,
 * which prevents every AI from chasing the ball.
 */
export class TeamBrain {
  /** defender id → offensive player id */
  readonly assignment = new Map<number, number>();
  /** off-ball offensive player id → spacing spot (world XZ) */
  readonly spacing = new Map<number, { x: number; z: number }>();
  /** Defender currently rotating to stop a beaten ball handler (-1 = none). */
  helperId = -1;

  private lastOffense: TeamIndex | -1 = -1;
  private lastPhase = '';
  private spacingTimer = 0;

  constructor(readonly team: TeamIndex) {}

  update(world: World, dt: number): void {
    const { match } = world;
    if (match.offense !== this.lastOffense || (match.phase === 'check' && this.lastPhase !== 'check')) {
      this.assignDefense(world);
      this.spacingTimer = 0;
    }
    this.lastOffense = match.offense;
    this.lastPhase = match.phase;

    if (match.offense === this.team) {
      this.helperId = -1;
      this.spacingTimer -= dt;
      if (this.spacingTimer <= 0) {
        this.assignSpacing(world);
        this.spacingTimer = 0.6;
      }
    } else {
      this.helperId = this.pickHelper(world);
    }
  }

  private members(world: World): SimPlayer[] {
    return world.players.filter((p) => p.team === this.team);
  }

  private opponents(world: World): SimPlayer[] {
    return world.players.filter((p) => p.team !== this.team);
  }

  /** Minimizes total matchup distance (brute force: team sizes are ≤ 5). */
  private assignDefense(world: World): void {
    this.assignment.clear();
    const defenders = this.members(world);
    const attackers = this.opponents(world);
    if (defenders.length === 0 || attackers.length === 0) return;
    const n = Math.min(defenders.length, attackers.length);
    let best: number[] = [];
    let bestCost = Infinity;
    const used = new Array<boolean>(attackers.length).fill(false);
    const current: number[] = [];
    const search = (i: number, cost: number): void => {
      if (cost >= bestCost) return;
      if (i === n) {
        bestCost = cost;
        best = current.slice();
        return;
      }
      const d = defenders[i]!;
      for (let j = 0; j < attackers.length; j++) {
        if (used[j]) continue;
        const a = attackers[j]!;
        // Size mismatch costs a little: bigs guard bigs where possible.
        const c = Math.hypot(a.pos.x - d.pos.x, a.pos.z - d.pos.z) + Math.abs(a.height - d.height) * 4;
        used[j] = true;
        current.push(j);
        search(i + 1, cost + c);
        current.pop();
        used[j] = false;
      }
    };
    search(0, 0);
    best.forEach((attackerIndex, i) => {
      this.assignment.set(defenders[i]!.id, attackers[attackerIndex]!.id);
    });
  }

  private assignSpacing(world: World): void {
    this.spacing.clear();
    const { ball } = world;
    const handler = ball.phase === 'held' ? world.players[ball.holder] : undefined;
    const offBall = this.members(world).filter((p) => p.id !== handler?.id);
    if (offBall.length === 0) return;
    const spots = SPACING_SPOTS.map((s) => spotWorld(world, s)).filter(
      (s) => !handler || Math.hypot(s.x - handler.pos.x, s.z - handler.pos.z) > 3.6,
    );
    const taken = new Set<number>();
    // Bigs prefer the short spots near the paint; guards/wings the perimeter.
    for (const p of offBall) {
      let bestIndex = -1;
      let bestScore = Infinity;
      spots.forEach((s, i) => {
        if (taken.has(i)) return;
        const near = distanceToHoop(world.hoop, s.x, s.z) < 4.5;
        const preference = near ? (1 - p.tendencies.post) * 4 : p.tendencies.post * 4;
        const score = Math.hypot(s.x - p.pos.x, s.z - p.pos.z) + preference;
        if (score < bestScore) {
          bestScore = score;
          bestIndex = i;
        }
      });
      if (bestIndex >= 0) {
        taken.add(bestIndex);
        this.spacing.set(p.id, spots[bestIndex]!);
      }
    }
  }

  /** When the ball handler has beaten his defender near the rim, the closest other defender helps. */
  private pickHelper(world: World): number {
    const { ball, hoop } = world;
    if (ball.phase !== 'held') return -1;
    const handler = world.players[ball.holder];
    if (!handler || handler.team === this.team) return -1;
    const handlerDist = distanceToHoop(hoop, handler.pos.x, handler.pos.z);
    if (handlerDist > 5.5) return -1;
    let primary: SimPlayer | undefined;
    for (const [defId, attId] of this.assignment) if (attId === handler.id) primary = world.players[defId];
    if (primary) {
      const primaryDist = distanceToHoop(hoop, primary.pos.x, primary.pos.z);
      const beaten = primary.action.kind === 'stumble' || primaryDist > handlerDist + 0.3;
      if (!beaten) return -1;
    }
    let best = -1;
    let bestDist = Infinity;
    for (const d of this.members(world)) {
      if (d.id === primary?.id) continue;
      const dist = Math.hypot(d.pos.x - handler.pos.x, d.pos.z - handler.pos.z);
      if (dist < bestDist) {
        bestDist = dist;
        best = d.id;
      }
    }
    return best;
  }
}
