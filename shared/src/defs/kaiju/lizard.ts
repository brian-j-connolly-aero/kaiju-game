/** Gragnor, the Lizard: the all-rounder with a beam special (DESIGN.md sections 2 to 4). */

import { DEG } from '../../math/angle';
import type { KaijuKindDef } from '../schema';

export const LIZARD: KaijuKindDef = {
  id: 'lizard',
  name: 'Gragnor',
  species: 'Lizard',
  hp: 1000,
  nerveCapacity: 100,
  nerveLeak: 7.5,

  stages: [
    {
      height: 4.5,
      bodyRadius: 2.4,
      topSpeed: 8.5,
      turnRate: 200 * DEG,
      accel: 16,
      trampleHeight: 3.5,
      wadesTall: false,
      wadeSpeedMult: 1,
      wadeContactDps: 0,
      waterSpeedMult: 0.5,
      // Eye and mouth are where the model has them (docs/art/client-notes-kaiju-lizard.md, section 7).
      eyeHeight: 4.2,
      eyeForward: 1.73,
      mouthHeight: 2.9,
      mouthForward: 2.5,
      handHeight: 2.2,
      // Measured on the model (kaiju_lizard_s1.glb): head and jaw reach 2.6 m ahead and 2.6 to
      // 4.5 m up; the tail sweeps down from 1.6 m at its root to 0.6 m, 3.5 m behind the axis.
      hit: {
        neck: [0.2, 3.3],
        snout: [1.65, 3.55],
        headRadius: 0.95,
        tail: [
          [-0.9, 1.6],
          [-2.1, 1.0],
          [-3.2, 0.6],
        ],
        tailRadii: [0.6, 0.35],
      },
    },
    {
      height: 32,
      bodyRadius: 9,
      topSpeed: 14,
      turnRate: 120 * DEG,
      accel: 14,
      trampleHeight: 12,
      wadesTall: false,
      wadeSpeedMult: 1,
      wadeContactDps: 0,
      waterSpeedMult: 0.85,
      eyeHeight: 27.5,
      eyeForward: 10.95,
      mouthHeight: 22,
      mouthForward: 15,
      handHeight: 16,
      // kaiju_lizard_s2.glb: head and jaw 15.6 m ahead, 20.5 to 29.7 m up; tail to 23.9 m behind.
      hit: {
        neck: [2, 24.2],
        snout: [11.2, 25],
        headRadius: 4.4,
        tail: [
          [-5.3, 12.3],
          [-13.4, 7.9],
          [-21.6, 4.4],
        ],
        tailRadii: [3.9, 2.3],
      },
    },
    {
      height: 115,
      bodyRadius: 26,
      topSpeed: 22,
      turnRate: 75 * DEG,
      accel: 14,
      trampleHeight: 70,
      wadesTall: true,
      wadeSpeedMult: 0.45,
      wadeContactDps: 900,
      waterSpeedMult: 1,
      eyeHeight: 90.7,
      eyeForward: 38.5,
      mouthHeight: 72,
      mouthForward: 51.4,
      handHeight: 58,
      // kaiju_lizard_s3.glb: head and jaw 55 m ahead, 64 to 103 m up; tail to 90.7 m behind.
      hit: {
        neck: [8, 80],
        snout: [37, 84],
        headRadius: 18,
        tail: [
          [-18.9, 43],
          [-49.1, 27.7],
          [-81.5, 15.5],
        ],
        tailRadii: [15.5, 9.5],
      },
    },
  ],

  damage: {
    normalMult: 0.12,
    braceFrontMult: 0.04,
    // Tuned (docs/BALANCE.md): a stagger or a cocoon caught in the open hurts about four times
    // as much as fire it shrugs off, enough for coordinated squads to kill, not for one volley.
    helplessMult: 0.5,
    braceNerveMult: 0.25,
    braceHalfArc: 60 * DEG,
    frontHalfAngle: 60 * DEG,
    rearAngle: 135 * DEG,
    frontMult: 1.0,
    flankMult: 1.35,
    rearMult: 1.7,
  },

  headLeadMax: 50 * DEG,
  strafeSpeedMult: 0.7,
  reverseSpeedMult: 0.6,
  trampleDps: 40,

  // Swimming (DESIGN.md section 4, "Swimming"; owner's note after the second playtest: "Gragnor
  // should be able to swim in the river, still hittable but only a few spines exposed").
  swim: {
    // The hatchling and the juvenile; the titan is too big for any water and wades as before.
    stages: [true, true, false],
    // A hatchling needs 3.6 m of water across, a juvenile 6.3 m: enough for it to lie low in the
    // Old Moat (20 m) with its flanks against the banks; the river and the bay are far wider.
    fitRadii: [0.75, 0.35, 0],
    diveTime: 1.0,
    surfaceTime: 0.6,
    settleTime: 1.5,
    // 9.4 m/s at stage 1 (wading: 4.3), 15.4 m/s at stage 2 (wading: 11.9).
    speedMult: 1.1,
    turnMult: 0.8,
    // 0.6 m of spines over a 2.6 m spread at stage 1; 4.5 m over a 9.9 m spread at stage 2.
    exposedHeight: 0.14,
    exposedRadius: 0.55,
    sightMult: 0.4,
  },

  actions: {
    swipe: {
      id: 'swipe',
      button: 'strike',
      held: false,
      timing: { windup: 0.45, active: 0.15, recover: 0.5 },
      activePhase: 'active',
      cooldown: 0,
      rageCost: 0,
      moveMult: 0.5,
      turnMult: 0.5,
      arc: 120 * DEG,
      reach: 2.5,
      unitDamage: 70,
      unitNerve: 40,
      structureDamage: [40, 300, 2000],
    },
    stomp: {
      id: 'stomp',
      button: 'stomp',
      held: false,
      timing: { windup: 0.9, active: 0.1, recover: 0.9 },
      activePhase: 'active',
      cooldown: 0,
      rageCost: 0,
      moveMult: 0,
      turnMult: 0.3,
      radius: 3.6,
      unitDamageCenter: 100,
      unitDamageEdge: 30,
      unitNerveCenter: 40,
      unitNerveEdge: 10,
      knockback: 1.5,
      structureDamage: [55, 420, 2600],
      structureEdgeFraction: 0.3,
    },
    grab: {
      id: 'grab',
      button: 'grab',
      held: false,
      timing: { windup: 0.4, active: 0, recover: 0 },
      activePhase: 'active',
      cooldown: 0,
      rageCost: 0,
      moveMult: 0.5,
      turnMult: 0.6,
      arc: 100 * DEG,
      reach: 2.5,
      vehicleFromStage: 2,
      chunkFromStage: 2,
      chunkStructureDamage: [0, 150, 1000],
    },
    throw: {
      id: 'throw',
      // Strike with something in the hand.
      button: 'strike',
      held: false,
      // 0.5 s in total: the object leaves the hand at the end of the wind-up.
      timing: { windup: 0.3, active: 0, recover: 0.2 },
      activePhase: 'active',
      cooldown: 0,
      rageCost: 0,
      moveMult: 0.5,
      turnMult: 0.6,
      speed: [25, 45, 70],
      unitDamage: 120,
      unitNerve: 40,
      impactRadius: [4, 10, 22],
      structureDamage: [60, 350, 1500],
    },
    eat: {
      id: 'eat',
      // Grab with something in the hand, or with nothing to pick up but something to eat in reach.
      button: 'grab',
      held: false,
      timing: { windup: 0, active: 2.0, recover: 0 },
      activePhase: 'eat',
      cooldown: 10,
      rageCost: 0,
      moveMult: 0,
      turnMult: 0,
      heal: 80,
      reach: 2.5,
    },
    brace: {
      id: 'brace',
      // A move picked at the second molt (owner's decision: "no longer free").
      button: 'slot',
      held: true,
      timing: { windup: 0, active: 0, recover: 0 },
      activePhase: 'brace',
      cooldown: 0,
      rageCost: 0,
      moveMult: 0,
      turnMult: 0.3,
    },
    roar: {
      id: 'roar',
      button: 'slot',
      held: false,
      timing: { windup: 0, active: 1.2, recover: 0 },
      activePhase: 'roar',
      cooldown: 18,
      rageCost: 0,
      moveMult: 0,
      turnMult: 0.5,
      radius: [40, 110, 280],
      // Polish pass: a full unit nerve capacity, so every unit the roar reaches is shaken (it
      // stops firing for a few seconds and backs off). At 60 nothing visibly happened.
      unitNerve: 100,
      resetsCharge: true,
      // Phase 1 after the first multiplayer playtest: the roar stuns, then shakes.
      stunTime: 2.5,
    },
    special: {
      id: 'special',
      special: 'beam',
      // The beam is a move picked at a molt (owner's decision: "a big early reward"), no longer in the starting kit.
      button: 'slot',
      held: false,
      timing: { windup: 0.8, active: 3.0, recover: 0.4 },
      activePhase: 'special',
      cooldown: 0,
      rageCost: 100,
      moveMult: 0,
      // Wider, slower to steer, and it fights back (docs/STATUS.md, "Polish pass: the monster's
      // combat feel").
      turnMult: 0.25,
      range: [60, 220, 600],
      width: [2.2, 7.5, 21],
      unitDps: 150,
      unitNervePerSecond: 60,
      structureDps: [60, 600, 4000],
      wobbleYaw: 4 * DEG,
      wobblePitch: 1.5 * DEG,
      driftYaw: 6 * DEG,
      kickPitch: 4 * DEG,
    },
    molt: {
      id: 'molt',
      // One press while a molt is offered.
      button: 'molt',
      held: false,
      // The cocoon duration is MATCH_RULES.cocoon; the action only starts it.
      timing: { windup: 0, active: 0, recover: 0 },
      activePhase: 'cocoon',
      cooldown: 0,
      rageCost: 0,
      moveMult: 0,
      turnMult: 0,
    },
    charge: {
      id: 'charge',
      button: 'slot',
      held: false,
      // Wind-up (rooted, still turning), up to 3 s of running, and always a stumble at the end.
      timing: { windup: 0.8, active: 3.0, recover: 1.2 },
      activePhase: 'charge',
      recoverPhase: 'stumble',
      // Counted from the end of the stumble.
      cooldown: 12,
      rageCost: 0,
      // In the stumble it can do nothing.
      moveMult: 0,
      turnMult: 0,
      windupTurnMult: 1,
      // 17 / 28 / 44 m/s, reached in half a second; it turns at a quarter of its rate.
      speedMult: 2,
      rampTime: 0.5,
      runTurnMult: 0.25,
      // Houses at stage 1, most of a district at stage 2; at stage 3 what it already walks through.
      smashHeight: [9, 30, 70],
      unitDamage: 90,
      unitNerve: 40,
      throwAside: 1.5,
    },
    tailSweep: {
      id: 'tailSweep',
      button: 'slot',
      held: false,
      timing: { windup: 0.35, active: 0.15, recover: 0.45 },
      activePhase: 'active',
      cooldown: 6,
      rageCost: 0,
      moveMult: 0.3,
      turnMult: 0.5,
      // The rear half, as far as the tail reaches.
      arc: 180 * DEG,
      reach: 3,
      unitDamage: 60,
      unitNerve: 30,
      knockback: 1.5,
      // What a swipe does to a building.
      structureDamage: [40, 300, 2000],
    },
  },

  // Molt cards (docs/ROADMAP.md, phase 1): the beam, the roar or the charge at the first molt;
  // at the second, the two not taken and one of the brace and the tail sweep.
  cards: {
    first: ['beam', 'roar', 'charge'],
    second: ['brace', 'tailSweep'],
  },
};
