import { clamp, lerp, vec3 } from '../core/math';
import type { Rng } from '../core/rng';
import { ratingT } from '../data/attributes';
import { distanceBeyondArc, distanceToHoop, fromHoopLocal, toHoopLocal } from '../data/court';
import type { DifficultyProfile } from '../data/difficulty';
import { DEFENSE, SHOOTING, SIM_DT } from '../data/tuning';
import { Button, type PlayerInput } from '../sim/input';
import { ballCarryPoint, dirTo, forwardX, forwardZ, handHeight, rightX, rightZ } from '../sim/geometry';
import { predictLanding } from '../sim/systems/rebounding';
import { formationSpot } from '../sim/systems/rules';
import { chooseShotType, shotRating, shotTuning } from '../sim/systems/shooting';
import type { ShotInfo, SimPlayer } from '../sim/types';
import type { World } from '../sim/world';
import { driveLaneTraffic, estimateShot, frontDefender, nearestClearSpot, passLaneRisk } from './perception';
import type { TeamBrain } from './TeamBrain';

/**
 * Per-player AI. Discrete decisions (shoot, pass, drive, move, steal) happen on decision
 * ticks whose rate depends on difficulty; steering toward the chosen target runs every
 * tick. The brain outputs a PlayerInput exactly like a human controller would.
 */

type OffenseMode = 'probe' | 'drive' | 'clear' | 'set' | 'shoot';

const ARRIVE_RADIUS = 0.3;
const SPRINT_DISTANCE = 3.2;

export class PlayerBrain {
  private decisionTimer: number;
  private mode: OffenseMode = 'probe';
  private target = { x: 0, z: 0 };
  private sprint = false;
  private tap = 0;
  private tapMoveX = 0;
  private tapMoveZ = 0;
  private tapPassTarget = -1;
  private holdShoot = false;
  private releaseAt = 0;
  private perceived = { x: 0, z: 0 };
  private perceivedInit = false;
  private possessionTime = 0;
  private hadBall = false;
  private contestPlan: 'none' | 'disciplined' | 'eager' = 'none';
  private contestShotStart = -1;
  private crashBoards = false;
  private lastShot: ShotInfo | null = null;
  private inRebound = false;
  private cutTimer = 0;
  private readonly landing = vec3();
  private readonly carry = vec3();

  constructor(
    readonly playerId: number,
    private readonly difficulty: DifficultyProfile,
    private readonly rng: Rng,
  ) {
    this.decisionTimer = rng.int(0, difficulty.decisionTicks);
  }

  /** Produces this tick's input for the player. */
  think(world: World, team: TeamBrain, out: PlayerInput): void {
    const p = world.players[this.playerId];
    if (!p) return;
    out.buttons = 0;
    out.moveX = 0;
    out.moveZ = 0;
    out.passTarget = -1;

    const { match, ball } = world;
    const hasBall = ball.phase === 'held' && ball.holder === p.id;
    if (hasBall && !this.hadBall) this.onGainBall();
    this.hadBall = hasBall;
    if (hasBall) this.possessionTime += SIM_DT;
    this.trackShotStart(world);

    if (match.phase === 'check' || match.phase === 'final') {
      this.resetTransient();
      return;
    }
    if (match.phase === 'dead') {
      this.resetTransient();
      const offense = match.nextOffense === p.team;
      const spot = formationSpot(world, p.slot, world.mode.teamSize, offense);
      this.target.x = spot.x;
      this.target.z = spot.z;
      this.sprint = false;
      this.steer(p, out, 0.6);
      return;
    }

    const decide = --this.decisionTimer <= 0;
    if (decide) this.decisionTimer = this.difficulty.decisionTicks + this.rng.int(-2, 2);

    const rebounding = !hasBall && this.isReboundSituation(world);
    if (hasBall) this.withBall(world, p, decide);
    else if (rebounding) this.rebound(world, p, team, decide || !this.inRebound);
    else if (p.team === match.offense) this.offBallOffense(world, p, team, decide);
    else this.defend(world, p, team, decide);
    this.inRebound = rebounding;

    this.emit(p, out);
  }

  private resetTransient(): void {
    this.holdShoot = false;
    this.tap = 0;
    this.mode = 'probe';
    this.contestPlan = 'none';
    this.perceivedInit = false;
    this.cutTimer = 0;
  }

  private onGainBall(): void {
    this.possessionTime = 0;
    this.mode = 'probe';
    this.holdShoot = false;
    this.decisionTimer = Math.min(this.decisionTimer, this.difficulty.decisionTicks);
  }

  // --- Offense with the ball -------------------------------------------------------

  private withBall(world: World, p: SimPlayer, decide: boolean): void {
    const { hoop, match } = world;

    if (this.holdShoot) {
      // Release the jumper at the planned moment (the sim grades the timing).
      if (p.action.kind === 'shotGather' && p.action.t + SIM_DT * 0.5 >= this.releaseAt) this.holdShoot = false;
      else if (p.action.kind !== 'shotGather') this.holdShoot = false;
      this.stop(p);
      return;
    }
    if (p.action.kind !== 'none' && p.action.kind !== 'dribbleMove') {
      this.stop(p);
      return;
    }

    const dist = distanceToHoop(hoop, p.pos.x, p.pos.z);
    // Set shot: plant the feet, then rise (avoids off-balance fades/pull-ups).
    if (this.mode === 'set') {
      this.stop(p);
      if (Math.hypot(p.vel.x, p.vel.z) < 1.2 && p.action.kind === 'none') this.startShot(world, p);
      return;
    }
    // Finishing reflex: attacking the rim in layup range.
    if (this.mode === 'drive' && dist < SHOOTING.layupRange - 0.2 && !match.needsClear && p.action.kind === 'none') {
      this.startShot(world, p);
      return;
    }

    if (decide && p.action.kind === 'none') this.decideWithBall(world, p, dist);
    if (this.mode === 'drive') {
      this.target.x = hoop.x;
      this.target.z = hoop.z;
    }
  }

  private decideWithBall(world: World, p: SimPlayer, dist: number): void {
    const { match } = world;
    const diff = this.difficulty;

    if (match.needsClear) {
      const spot = nearestClearSpot(world, p.pos.x, p.pos.z, 1.1);
      this.mode = 'clear';
      this.target.x = spot.x;
      this.target.z = spot.z;
      this.sprint = p.stamina > 20;
      return;
    }

    const shot = estimateShot(world, p, diff.closeoutAnticipation);
    const clock = match.shotClock ?? 99;
    const tendency = shot.beyondArc ? p.tendencies.shootThree : dist < 3 ? 1 : p.tendencies.shootMid;
    let threshold = diff.shotSelectivity * (1.25 - 0.45 * tendency);
    // Patience: with time on the clock, only take clearly good looks (threes most of all).
    const patience = clamp((clock - 5) / 9, 0, 1);
    threshold *= 1 + patience * (shot.beyondArc ? 0.3 : 0.15);
    if (this.possessionTime < 1.1 && shot.ev < threshold * 1.3) threshold = Infinity;
    if (clock < 4) threshold *= 0.65;
    if (clock < 1.6) threshold = 0;

    // Pass options (vision limits which teammates the AI "sees").
    let bestPass: SimPlayer | null = null;
    let bestPassValue = -Infinity;
    for (const mate of world.players) {
      if (mate.team !== p.team || mate.id === p.id) continue;
      if (!this.rng.chance(diff.passVision)) continue;
      const est = estimateShot(world, mate, diff.closeoutAnticipation + 0.3);
      const risk = passLaneRisk(world, p, mate);
      let value = est.ev - risk * 1.6;
      if (mate.callForBall > 0) value += 0.25;
      const mateDist = distanceToHoop(world.hoop, mate.pos.x, mate.pos.z);
      if (mateDist < 2.5) value += 0.2;
      if (value > bestPassValue) {
        bestPassValue = value;
        bestPass = mate;
      }
    }
    const passBias = 0.35 * (1 - p.tendencies.pass);

    const traffic = driveLaneTraffic(world, p);
    const front = frontDefender(world, p);
    const finishing = ratingT(Math.max(p.attr.finishing, p.attr.dunk));
    const driveValue = dist > 2.2 ? (1 - traffic) * (0.9 + finishing * 0.9) * (0.5 + p.tendencies.drive) : 0;

    if (shot.ev >= threshold) {
      const speed = Math.hypot(p.vel.x, p.vel.z);
      const pullUpShooter = p.tendencies.shootMid > 0.6 && p.attr.midRange > 70;
      if (dist > SHOOTING.layupRange && speed > 2.2 && !pullUpShooter && clock > 2.5) this.mode = 'set';
      else this.startShot(world, p);
      return;
    }
    if (bestPass && bestPassValue > Math.max(shot.ev, driveValue * 0.8) + passBias && this.possessionTime > 0.5) {
      this.tap |= Button.Pass;
      this.tapPassTarget = bestPass.id;
      this.mode = 'probe';
      return;
    }
    if (traffic < 0.45 && dist > 2.4 && this.rng.chance(0.25 + p.tendencies.drive * 0.6)) {
      this.mode = 'drive';
      this.sprint = p.stamina > 25;
      return;
    }
    if (front.player && front.dist < 1.7 && this.rng.chance(0.15 + p.tendencies.dribbleMoves * 0.45)) {
      this.startDribbleMove(p, front.player);
      return;
    }
    if (front.player && front.dist < 1.6 && p.tendencies.dribbleMoves > 0.5 && this.rng.chance(0.08)) {
      // Pump fake to bait a jump.
      this.tap |= Button.Shoot;
      return;
    }
    this.mode = 'probe';
    this.pickProbeSpot(world, p);
    this.sprint = false;
  }

  private startShot(world: World, p: SimPlayer): void {
    const type = chooseShotType(world, p);
    const tuning = shotTuning(type);
    this.mode = 'shoot';
    if (!tuning.usesMeter) {
      this.tap |= Button.Shoot;
      return;
    }
    const beyond = distanceBeyondArc(world.hoop, p.pos.x, p.pos.z) > 0;
    const consistency = lerp(1.25, 0.8, ratingT(shotRating(p, type, beyond)));
    const error = this.rng.normal(0, this.difficulty.shotTimingSigma * consistency);
    this.releaseAt = tuning.releaseTime + error;
    this.holdShoot = true;
  }

  private startDribbleMove(p: SimPlayer, defender: SimPlayer): void {
    const fx = forwardX(p);
    const fz = forwardZ(p);
    const rx = rightX(p);
    const rz = rightZ(p);
    // Side with more room: away from the defender's lateral offset.
    const lateral = (defender.pos.x - p.pos.x) * rx + (defender.pos.z - p.pos.z) * rz;
    const side = lateral > 0 ? -1 : 1;
    const shooter = Math.max(p.attr.threePoint, p.attr.midRange);
    const r = this.rng.next();
    let mx: number;
    let mz: number;
    if (shooter > 72 && p.attr.ballHandle >= 55 && r < 0.3) {
      mx = -fx;
      mz = -fz; // stepback
    } else if (defender.action.kind === 'stumble' || r < 0.45) {
      mx = fx * 0.4 + rx * side;
      mz = fz * 0.4 + rz * side; // cross / between the legs toward space
    } else if (r < 0.65) {
      mx = fx;
      mz = fz; // burst
    } else if (r < 0.8) {
      mx = -fx * 0.6 + rx * side;
      mz = -fz * 0.6 + rz * side; // behind the back
    } else {
      mx = 0;
      mz = 0; // hesitation
    }
    this.tap |= Button.Skill;
    this.tapMoveX = mx;
    this.tapMoveZ = mz;
    this.mode = 'probe';
  }

  private pickProbeSpot(world: World, p: SimPlayer): void {
    const t = p.tendencies;
    const r = this.rng.next() * (t.shootThree + t.shootMid + t.post + 0.2);
    let lateral: number;
    let out: number;
    const side = this.rng.chance(0.5) ? -1 : 1;
    if (r < t.shootThree) {
      const angle = this.rng.range(-1.2, 1.2);
      lateral = Math.sin(angle) * 7.3;
      out = Math.cos(angle) * 7.3;
    } else if (r < t.shootThree + t.shootMid) {
      lateral = side * this.rng.range(1.5, 4.5);
      out = this.rng.range(3.5, 5.5);
    } else if (r < t.shootThree + t.shootMid + t.post) {
      lateral = side * this.rng.range(1.4, 2.6);
      out = this.rng.range(1.2, 2.6);
    } else {
      const local = toHoopLocal(world.hoop, p.pos.x, p.pos.z);
      lateral = clamp(local.lateral + this.rng.range(-2.5, 2.5), -6.5, 6.5);
      out = clamp(local.out + this.rng.range(-2, 1), 1, 9);
    }
    const spot = fromHoopLocal(world.hoop, lateral, out);
    this.target.x = spot.x;
    this.target.z = spot.z;
  }

  // --- Offense without the ball ----------------------------------------------------

  private offBallOffense(world: World, p: SimPlayer, team: TeamBrain, decide: boolean): void {
    const { ball, hoop } = world;
    if (ball.phase === 'pass' && ball.pass?.target === p.id) {
      this.stop(p);
      return; // The sim's receive assist steps toward the ball.
    }
    if (this.cutTimer > 0) {
      this.cutTimer -= SIM_DT;
      const spot = fromHoopLocal(hoop, clamp(toHoopLocal(hoop, p.pos.x, p.pos.z).lateral * 0.25, -1.2, 1.2), 1.3);
      this.target.x = spot.x;
      this.target.z = spot.z;
      this.sprint = true;
      return;
    }
    const spacing = team.spacing.get(p.id);
    if (spacing) {
      this.target.x = spacing.x;
      this.target.z = spacing.z;
    }
    this.sprint = Math.hypot(this.target.x - p.pos.x, this.target.z - p.pos.z) > 5;
    if (!decide) return;
    // Backdoor cut when the defender sags or ball-watches.
    let defenderDist = Infinity;
    for (const d of world.players) {
      if (d.team === p.team) continue;
      defenderDist = Math.min(defenderDist, Math.hypot(d.pos.x - p.pos.x, d.pos.z - p.pos.z));
    }
    const iq = ratingT(p.attr.offensiveIQ);
    if (defenderDist > 2.6 && distanceToHoop(hoop, p.pos.x, p.pos.z) > 4 && this.rng.chance(0.12 + iq * 0.2)) {
      this.cutTimer = 1.5;
      this.tap |= Button.Pass; // call for the ball
    }
  }

  // --- Defense -----------------------------------------------------------------------

  private defend(world: World, p: SimPlayer, team: TeamBrain, decide: boolean): void {
    const { ball, hoop } = world;
    const diff = this.difficulty;
    const handler = ball.phase === 'held' ? world.players[ball.holder] : undefined;
    const manId = team.assignment.get(p.id);
    const man = manId !== undefined ? world.players[manId] : undefined;
    const focus = team.helperId === p.id && handler ? handler : man;
    if (!focus) {
      this.stop(p);
      return;
    }

    // Reaction lag: defenders track a smoothed perception of their target.
    if (!this.perceivedInit) {
      this.perceived.x = focus.pos.x;
      this.perceived.z = focus.pos.z;
      this.perceivedInit = true;
    }
    const k = 1 - Math.exp(-SIM_DT / Math.max(0.02, diff.defenseReaction));
    this.perceived.x += (focus.pos.x - this.perceived.x) * k;
    this.perceived.z += (focus.pos.z - this.perceived.z) * k;

    const onBall = handler !== undefined && focus.id === handler.id;
    const toHoop = { x: hoop.x - this.perceived.x, z: hoop.z - this.perceived.z };
    const toHoopLen = Math.hypot(toHoop.x, toHoop.z) || 1;
    toHoop.x /= toHoopLen;
    toHoop.z /= toHoopLen;

    if (onBall) {
      const shooterThreat = ratingT(Math.max(focus.attr.threePoint, focus.attr.midRange));
      const speedThreat = ratingT((focus.attr.speed + focus.attr.acceleration) / 2);
      let gap = clamp(1.15 + 0.55 * (speedThreat - shooterThreat), 0.9, 1.75);
      if (toHoopLen < 3.2) gap = 0.75;
      if (focus.action.kind === 'shotGather') gap = 0.6;
      this.target.x = this.perceived.x + toHoop.x * gap;
      this.target.z = this.perceived.z + toHoop.z * gap;
    } else {
      // Off-ball: stay between man and rim, sagging toward the ball by help tendency.
      const ballX = ball.pos.x;
      const ballZ = ball.pos.z;
      const sag = clamp(0.18 + p.tendencies.helpDefense * 0.25 * diff.helpDiscipline, 0.1, 0.45);
      const gx = this.perceived.x + (ballX - this.perceived.x) * sag + toHoop.x * 1.2;
      const gz = this.perceived.z + (ballZ - this.perceived.z) * sag + toHoop.z * 1.2;
      this.target.x = gx;
      this.target.z = gz;
    }
    if (decide && diff.positionNoise > 0) {
      this.target.x += this.rng.range(-diff.positionNoise, diff.positionNoise) * 0.5;
      this.target.z += this.rng.range(-diff.positionNoise, diff.positionNoise) * 0.5;
    }
    const distToTarget = Math.hypot(this.target.x - p.pos.x, this.target.z - p.pos.z);
    this.sprint = distToTarget > SPRINT_DISTANCE && p.stamina > 15;

    if (handler) {
      this.contest(world, p, handler);
      if (decide && onBall) this.maybeSteal(p, handler);
    }
  }

  private trackShotStart(world: World): void {
    const holderId = world.ball.phase === 'held' ? world.ball.holder : -1;
    const holder = holderId >= 0 ? world.players[holderId] : undefined;
    const shooting = holder && (holder.action.kind === 'shotGather' || holder.action.kind === 'layup' || holder.action.kind === 'dunk');
    if (!shooting) {
      this.contestShotStart = -1;
      this.contestPlan = 'none';
      return;
    }
    if (this.contestShotStart < 0) {
      this.contestShotStart = world.match.tick;
      this.contestPlan = this.rng.chance(this.difficulty.contestDiscipline) ? 'disciplined' : 'eager';
    }
  }

  private contest(world: World, p: SimPlayer, handler: SimPlayer): void {
    if (this.contestPlan === 'none' || p.airborne || p.action.kind !== 'none') return;
    const dist = Math.hypot(handler.pos.x - p.pos.x, handler.pos.z - p.pos.z);
    const finishing = handler.action.kind === 'layup' || handler.action.kind === 'dunk';
    if (dist > (finishing ? 2.0 : 2.3)) return;
    const elapsed = (world.match.tick - this.contestShotStart) * SIM_DT;
    const reaction = this.difficulty.defenseReaction;
    const ready = this.contestPlan === 'disciplined' ? handler.airborne && elapsed >= reaction : elapsed >= reaction * 0.5;
    if (!ready) return;
    this.tap |= Button.Shoot;
    this.contestPlan = 'none';
  }

  private maybeSteal(p: SimPlayer, handler: SimPlayer): void {
    if (p.stealCooldown > 0 || p.action.kind !== 'none') return;
    // Only reach when the ball itself is within reach (not just the handler's body).
    ballCarryPoint(handler, this.carry);
    const dist = Math.hypot(this.carry.x - p.pos.x, this.carry.z - p.pos.z);
    if (dist > DEFENSE.stealRange * 0.9) return;
    if (handler.action.kind === 'shotGather' || handler.action.kind === 'layup' || handler.action.kind === 'dunk') return;
    const exposed = handler.action.kind === 'dribbleMove' ? 2 : 1;
    const chance = 0.1 * this.difficulty.stealAggression * (0.5 + p.tendencies.stealGamble) * exposed;
    if (this.rng.chance(chance)) this.tap |= Button.Skill;
  }

  // --- Rebounds / loose balls ----------------------------------------------------------

  private isReboundSituation(world: World): boolean {
    const { ball } = world;
    if (ball.phase === 'loose') return true;
    return ball.phase === 'shot' && ball.shot !== null && !ball.shot.scored;
  }

  private rebound(world: World, p: SimPlayer, team: TeamBrain, refresh: boolean): void {
    const { ball, hoop, match } = world;
    const shot = ball.shot;
    if (shot && this.lastShot !== shot) {
      this.lastShot = shot;
      this.crashBoards = p.team !== shot.team || this.rng.chance(p.tendencies.crashBoards);
    }
    const isShooterTeam = shot ? p.team === shot.team : p.team === match.offense;
    if (ball.phase === 'shot' && shot && shot.t < 0.55 && !isShooterTeam) {
      // Box out: get between your man and the rim.
      const manId = team.assignment.get(p.id);
      const man = manId !== undefined ? world.players[manId] : undefined;
      if (man) {
        const dir = dirTo(man, hoop.x, hoop.z);
        this.target.x = man.pos.x + dir.x * 0.75;
        this.target.z = man.pos.z + dir.z * 0.75;
        this.sprint = false;
        return;
      }
    }
    if (isShooterTeam && !this.crashBoards && ball.phase === 'shot') {
      const spacing = team.spacing.get(p.id);
      if (spacing) {
        this.target.x = spacing.x;
        this.target.z = spacing.z;
      }
      this.sprint = false;
      return;
    }
    if (refresh) {
      predictLanding(world, handHeight(p) + p.jumpHeight * 0.6, this.landing);
      this.target.x = this.landing.x;
      this.target.z = this.landing.z;
    }
    if (ball.phase === 'loose' && ball.pos.y < 1.2) {
      this.target.x = ball.pos.x;
      this.target.z = ball.pos.z;
    }
    this.sprint = true;
    // Jump when the ball is dropping into reach but above standing reach.
    const horizontal = Math.hypot(ball.pos.x - p.pos.x, ball.pos.z - p.pos.z);
    if (
      !p.airborne &&
      p.action.kind === 'none' &&
      horizontal < 1.1 &&
      ball.vel.y < 0 &&
      ball.pos.y > p.reach - 0.05 &&
      ball.pos.y < p.reach + p.jumpHeight + 0.45
    ) {
      this.tap |= Button.Jump;
    }
  }

  // --- Output ------------------------------------------------------------------------

  private stop(p: SimPlayer): void {
    this.target.x = p.pos.x;
    this.target.z = p.pos.z;
    this.sprint = false;
  }

  private emit(p: SimPlayer, out: PlayerInput): void {
    this.steer(p, out, 1);
    if (this.sprint) out.buttons |= Button.Sprint;
    if (this.holdShoot) out.buttons |= Button.Shoot;
    if (this.tap) {
      out.buttons |= this.tap;
      if (this.tap & Button.Skill) {
        out.moveX = this.tapMoveX;
        out.moveZ = this.tapMoveZ;
      }
      if (this.tap & Button.Pass) out.passTarget = this.tapPassTarget;
      // Starting a jumper with a tap is a pump fake; real shots hold the button.
      if ((this.tap & Button.Shoot) && this.mode === 'shoot' && !this.holdShoot) this.mode = 'probe';
      this.tap = 0;
      this.tapPassTarget = -1;
    }
  }

  private steer(p: SimPlayer, out: PlayerInput, maxMag: number): void {
    const dx = this.target.x - p.pos.x;
    const dz = this.target.z - p.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < ARRIVE_RADIUS) return;
    const mag = Math.min(maxMag, Math.max(0.25, dist / 1.2));
    out.moveX = (dx / dist) * mag;
    out.moveZ = (dz / dist) * mag;
  }
}
