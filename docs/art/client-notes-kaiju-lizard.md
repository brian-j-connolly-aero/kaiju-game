# Gragnor (Lizard kaiju): what the game code must change to match the art

For the client engineer who applies the art director's review of the kaiju lizard family
(`kaiju_lizard_s1`, `_s2`, `_s3`, `kaiju_cocoon`, `kaiju_egg`, `portrait_lizard`). The art side
of every note is done and checked; the notes below are the parts that only code can finish.
Nothing in `client/src` or `shared/src` was touched by the art work.

All numbers were measured on the shipped `.glb` files and on `manifest.kaiju.json` (how: section
14). Axes are the game's: x to the model's left, y up, z forward; meters; angles in degrees
unless a line says radians. "h" means the stage's body height (4.5, 32, 115 m). Line numbers
are those of commit `2f69ae5`.

## 1. Summary

| # | Change | Where | Needed for |
| --- | --- | --- | --- |
| 1 | Read `poses` from the manifest | `client/src/assets/manifest.ts`, `kaijuView.ts` | everything below |
| 2 | First person: lock the head to the aim, let both arms ride on the head | `sceneRig.ts`, `kaijuView.ts` | "the player does not see their claws" (must); "the snout covers the view when the head pitches" (should) |
| 3 | Animator: blend to the pose targets instead of the fixed arm angles | `kaijuAnimator.ts` | claws in view (must); arms through the head, seen from outside (must) |
| 4 | Stagger: use the `stagger` target (reel back), keep the weak point from vanishing in its throb | `kaijuAnimator.ts`, `kaijuView.ts` | "the weak point is invisible when it matters" (must) |
| 5 | Held object: keep it out of the camera in first person | `kaijuView.ts` | new, found while checking 2 |
| 6 | Aim, beam and throw origins: take them from the model | `shared/src/defs/kaiju/lizard.ts`, `shared/src/sim/beam.ts`, `kaijuEffects.ts` | "anchors disagree with the simulation" (should). Shared code: the coordinator decides |
| 7 | Stand-in weak point colour | `client/src/assets/procedural/models.ts` | colour language (should) |
| 8 | Near plane | none needed | "camera inside the near plane" (must): solved in the art |
| 9 | Optional polish: pulse the embers and the cocoon light | `kaijuView.ts` | nice to have |

Changes 1 to 4 belong together: without 2, change 3 puts the claws in the right place only
while the player looks dead level (25 degrees down and they are at the top of the screen).

## 2. Read the pose targets (change 1)

Every lizard stage in `client/public/assets/manifest.json` (merged from `manifest.kaiju.json`)
now has

```json
"poses": { "<name>": { "<node>": [x, y, z], ... }, ... }
```

Angles are degrees relative to the rest pose, to be set exactly as `SceneRig.setRotation(name,
x, y, z)` does it (three.js Euler order XYZ; `client/src/render/sceneRig.ts` line 52), after
converting to radians. Names: `fp_claws`, `grab`, `hold`, `eat`, `brace`, `throw_windup`,
`throw_release`, `swipe_hit`, `stagger`. The contract is in `docs/ASSETS.md` section 7; the
values are copied in section 12 below.

- `client/src/assets/manifest.ts` line 3, `ModelEntry`: add
  `poses?: Record<string, Record<string, [number, number, number]>>`.
- `KaijuView.ensureRig` (`client/src/render/kaijuView.ts` line 87) knows the model id
  (`kaiju_<kind>_s<stage>`): look up `assets.manifest.models[key]?.poses` there, convert to
  radians once, and hand the table to `computeKaijuPose` with the other inputs (line 178).
- The box stand-in has no `poses`. Use the fallback table in section 13 for it (it is today's
  numbers), so the stand-in keeps moving as it does now.

## 3. First person: one rigid assembly (change 2)

What the player should see of their own body is the snout at the bottom of the frame and the
claws beside it, always in the same place, like the weapon in any first-person game. The rig
cannot give that as it is driven today: the camera sits on `cam_fp` and looks along the aim
(`kaijuController.ts` lines 90 to 105), but the head follows only 80 percent of the look pitch
and adds its own pitch in every action (`kaijuAnimator.ts` lines 135 to 136, 154 to 156, 238 to
240, 254 to 256), and the arms hang on the torso. Measured with the pose targets on the torso:
looking 25 degrees down moves the claws from the lower third to the top of the frame, 50
degrees down they are gone, and a head that leads the body by 50 degrees drags an arm across
the middle.

The fix that was built and checked: for the local player's kaiju, while the camera is in the
head (`!controller.thirdPerson`, not the cinematic camera, phase not `dead` or `cocoon`):

1. **Lock `head` to the aim.** After all rotations of the frame are set (after the loop at
   `kaijuView.ts` line 195 to 201), make the head's world orientation equal to the camera's:

   ```ts
   this.group.updateMatrixWorld(true);
   neck.getWorldQuaternion(q).invert();                    // the head's parent
   aim.setFromEuler(euler.set(-k.aimPitch, k.aimYaw, 0, 'YXZ'));   // yaw 0 faces +Z, positive pitch looks up
   head.quaternion.copy(q).multiply(aim);                  // rest rotation of every rig node is identity
   ```

   Do not ease it: it must follow the camera exactly, every frame, and it must be done before
   the anchors are read (lines 227 to 230), because `cam_fp` hangs on the head. The animator's
   own head angles (look, roar, stomp, beam, the `head` entry of a target) are simply
   overridden in this view; other players still see them.
2. **Let `arm_L` and `arm_R` ride on `head` instead of `torso`.** Re-parent the two nodes,
   keeping where they sit in the rest pose, and keep setting their rotations as before.
   `SceneRig` needs one new method, for example

   ```ts
   /** Hangs a node under another parent, where it sits in the rest pose. */
   ride(name: string, parentName: string): void   // position = restInModel(name) - restInModel(parentName); parent.add(node)
   ```

   where `restInModel` is the sum of the rest positions up the model's own parent chain
   (rest rotations are identity, so no rotation is involved). Switch back to `torso` when the
   player toggles to third person, dies or cocoons. Expected local position of the arms under
   `head` (last row of the table below): stage 3 `arm_L` (27.55, 1.69, -11.81) m.
3. Tell `KaijuView.update` that this kaiju is the first-person one. Today it cannot know: add
   a flag to the render view next to `hideLocalLead` (`client/src/app/matchRuntime.ts` line
   255) and pass it down.

The camera code does not change: position from `cam_fp`, orientation from `aimCamera`. Snout,
claws and camera are then one rigid assembly. The body underneath still does everything the
animator asks (lunge, twist, lean back in a roar), which the player feels as camera movement.

Checked through the game's lens (vertical field of view 72 degrees, 16:9, near plane 0.02 h)
at all three stages: the picture of snout and claws is identical for look pitch +30 to -50
degrees and head lead -50 to +50 degrees; at the peak of a roar, at the end of the beam and
stomp wind-ups the snout stays where it is at rest (today it fills the frame); no back face
shows in any pose.

Model facts for this section (rest pose, meters):

| | Stage 1 | Stage 2 | Stage 3 |
| --- | --- | --- | --- |
| `head` pivot: height / forward of the body axis | 3.36 / 0.29 | 24.47 / 5.59 | 80.68 / 20.80 |
| `cam_fp`: height / forward | 4.20 / 1.73 | 27.54 / 10.95 | 90.69 / 38.47 |
| `cam_fp` from the `head` pivot: up / forward | 0.84 / 1.44 | 3.07 / 5.36 | 10.01 / 17.67 |
| `mouth`: height / forward | 2.90 / 2.50 | 21.98 / 15.04 | 72.03 / 51.44 |
| `mouth` from the `head` pivot: up / forward | -0.46 / 2.21 | -2.49 / 9.45 | -8.65 / 30.64 |
| `arm_L` from the `head` pivot (x, y, z); `arm_R` has x negated | (1.28, -0.23, 0.31) | (7.56, 0.16, -3.12) | (27.55, 1.69, -11.81) |

One thing to look at while you are there: when a wall is close, `kaijuController.ts` lines 99
to 103 pull the camera back toward the body axis, away from `cam_fp`, by up to 38 m at stage
3. The camera is then inside the skull. Back-face culling hides the head from in there, but
the claws are seen from behind. Hiding the local rig's `arm_L`, `arm_R` (and `jaw`) while
`clear < 1` is the cheap way out.

## 4. Animator: blend to the targets (change 3)

Rule: each arm has a **base pose** and the actions blend **targets** over it.

- Base of the right arm: `hold` when something is in the hand (any phase); else `fp_claws` in
  the first-person assembly; else the rest pose (all zero).
- Base of the left arm: `fp_claws` in the first-person assembly, else the rest pose.
- `act(target, w)`: for the body nodes a target names (`torso`, `neck`, `head`, `jaw`, legs)
  add `angle * w` to what the animator already has (walk, breathing, look). For the arm nodes
  it names (`arm_*`, `forearm_*`, `hand_*`) accumulate `angle * w` and add `w` to that arm's
  taken weight. When all actions are in, each arm node is
  `accumulated + base * max(0, 1 - taken)`.
- A target names the right arm only (the left stays on its base), or both arms.

The whole of `computeKaijuPose` from line 140 on then reads (`w`, `a`, `back`, `swell`, `on`,
`r`, `chew` exactly as today; built-in targets are the animator's present numbers, in radians):

```ts
const SWIPE_WINDUP = { arm_R: [-2.3, -0.5, -0.5], forearm_R: [-0.3, 0, 0] };
const STOMP_WINDUP = { arm_L: [-1.3, 0, 0.5], arm_R: [-1.3, 0, -0.5] };
const STOMP_SLAM   = { arm_L: [0.3, 0, 0], arm_R: [0.3, 0, 0] };
const ROAR_ARMS    = { arm_L: [0.2, 0, 0.85], arm_R: [0.2, 0, -0.85], forearm_L: [-0.5, 0, 0], forearm_R: [-0.5, 0, 0] };
const BEAM_BREATH  = { arm_L: [0.3, 0, 0], arm_R: [0.3, 0, 0] };
const BEAM_ON      = { arm_L: [0.25, 0, 0.3], arm_R: [0.25, 0, -0.3] };
const DEAD_ARMS    = { arm_L: [0.6, 0, 0.5], arm_R: [0.6, 0, -0.5] };

if (phase === 'stagger') {            // lines 150-164: the slump goes
  pose.stiffness = 8;
  pose.hipsLift -= 0.05 * input.height;
  act(P.stagger, 1);
  add('torso', 0, 0, Math.sin(time * 2.6) * 0.12);      // the sway stays
  add('head', 0, Math.sin(time * 2.1) * 0.25);
  pose.jawOpen = 0.3;
} else if (phase === 'dead') {        // unchanged in effect
  pose.stiffness = 5;
  add('torso', 0.7); add('head', 0.6); add('jaw', 0.5);
  act(DEAD_ARMS, 1);
} else if (phase === 'brace' || action === 'brace') {
  pose.hipsLift -= 0.07 * input.height;
  act(P.brace, 1);                    // replaces lines 175-181 (torso, neck, head, arms, forearms)
  add('leg_L', -0.25); add('leg_R', -0.25); add('shin_L', 0.45); add('shin_R', 0.45);
  for (let i = 1; i <= 5; i++) add(`tail_${i}`, -0.06);
} else if (action === 'swipe') {
  // w, a, back as today (lines 189-191)
  add('torso', -0.1 * back, -0.6 * back);               // the wind-up twist stays
  add('hips', 0, -0.15 * back + 0.2 * a);
  if (!assembly) add('arm_L', 0.3 * back);
  act(SWIPE_WINDUP, back);                              // arm high overhead: the tell, unchanged
  act(P.swipe_hit, a);                                  // replaces the 'a' terms of lines 192-197
} else if (action === 'stomp') {
  // w, a as today; hipsLift, torso, leg_R, shin_R, head, tail lines unchanged
  act(STOMP_WINDUP, w);
  act(STOMP_SLAM, a);
} else if (action === 'grab') {
  act(P.grab, w);                                       // replaces lines 213-216
} else if (action === 'throw') {
  act(P.throw_windup, w);                               // replaces lines 221-223
  act(P.throw_release, a);
} else if (phase === 'eat' || action === 'eat') {
  act(P.eat, 1);                                        // replaces lines 226-232
  add('head', chew * 0.08);
  add('jaw', chew * 0.25);
  pose.jawOpen = 0.4;
} else if (phase === 'roar' || action === 'roar') {
  // torso, neck, head, jaw, tail lines unchanged
  act(ROAR_ARMS, swell);
} else if (action === 'special') {
  // torso, neck, head, jaw, hipsLift lines unchanged
  act(BEAM_BREATH, w);
  act(BEAM_ON, on);
}
// then: the arms from base and accumulated targets (the rule above), and the walk's arm swing
// on top: arm_L.x += swing; if (!input.holding) arm_R.x -= swing;
```

Three more lines change:

- Lines 125 to 126 (arm swing of the walk): `swing = s * (assembly ? 0.03 : 0.3) * m`. The
  claws are far from the shoulder and close to the lens: 0.105 rad already swings a claw by 14
  percent of the frame height, out of the lower third; 0.03 rad is a calm bob of 4 percent.
- Lines 141 to 144 (held object) go: `hold` is the base pose of the right arm now.
- `assembly` is `input.firstPerson && phase !== 'dead' && phase !== 'cocoon'`.

Why the swipe keeps its own wind-up but gets a target for the hit: the wind-up (arm straight
up) reads well from outside and clears the head; in first person the claw leaves the frame
upward, which is the right cue. The follow-through of today (`arm_R` -1.25, 0.9 rad) cuts into
the head at all three stages (150, 34 and 40 intersecting triangle pairs at stages 1, 2, 3).
`swipe_hit` ends the rake in front of the nose, below the crosshair, clear of the head. On the
way from overhead to there the claw sweeps through the crosshair, as a swipe should.

Why not keep today's numbers for the rest: with them, seen from outside, `eat` puts both hands
on top of the skull and `brace` puts the forearms over the brow; in first person no hand is in
the frame in grab, eat or brace.

## 5. Stagger and the weak point (change 4)

- The slump of today (`torso` +0.45, `neck` +0.3, `head` +0.45 rad) droops the head in front of
  the chest: from a soldier's eye in front (8, 45, 150 m at stages 1, 2, 3) not one pixel of
  the weak point shows. The `stagger` target reels back instead (`torso` -17, `neck` -11,
  `head` -20, `jaw` 20, arms dropped wide; the same angles at every stage). With it the chest
  crystal shows from the front and from 60 degrees to the side at every game distance checked.
- The art added two shards of the same light at the shoulder blades (same `weak_point` node),
  for flankers, rear attackers and drones. They slide out of the hide as the node's scale
  grows: nothing shows at scale 0.83, a stub at 0.95, a dorsal-spine-sized shard at 1.45.
  Today's throb (`kaijuView.ts` line 221: `1.2 + sin(time * 9) * 0.25`, so 0.95 to 1.45)
  therefore hides the back light at the bottom of every beat. Use `1.3 + sin(time * 9) * 0.2`
  (1.1 to 1.5): the back light then pulses without ever going out. The chest crystal only
  gets 8 percent bigger on average.
- First person: keep the head locked to the aim during a stagger too (the assembly rule of
  section 3 covers it: only `dead` and `cocoon` are excluded). With the head free and the
  camera level, the snout (pitched 48 degrees up) fills most of the frame for the whole
  stagger. With the lock the claws drop out of view and the camera is thrown back by a tenth
  of the body height (0.5 m, 3.5 m, 11.2 m at stages 1, 2, 3; its height changes by less than
  0.03 h), which reads as being knocked back. A camera roll of
  `sin(time * 2.6) * 0.06` rad on top would sell it further; optional.
- The weak point is violet-white now (`#c9a6ff`, bright facets `#f3e9ff`, shaded `#8f5cf2`),
  never cyan: cyan is the humans' colour (`docs/ASSETS.md` section 2). If the heads-up display
  marks the weak point, use the same violet.

## 6. Held objects in first person (change 5)

`KaijuView.updateHeld` (`kaijuView.ts` lines 105 to 124) hangs the held model on the `hold`
anchor by its middle, at full size. In the first-person assembly, with the `hold` target, that
anchor sits here (frame coordinates as in section 11; depth along the view axis):

| | Stage 1 | Stage 2 | Stage 3 |
| --- | --- | --- | --- |
| `hold` anchor in the frame (x, y) | +0.54, -0.87 | +0.47, -0.43 | +0.46, -0.40 |
| depth from the camera | 1.22 m | 8.91 m | 33.47 m |
| distance from the view axis | 1.15 m | 6.08 m | 22.0 m |

Anything bigger than the distance from the view axis covers the crosshair, and anything bigger
than the depth reaches the camera and is cut open by the near plane. A sedan (bounding radius
about 2.3 m) in the hatchling's hand does both; the stage-2 building chunk (`held_chunk` at
9 m x 0.9, bounding radius about 0.83 of that) comes to 6.7 m and covers the crosshair.

Suggested rule, first-person view only: scale the held model so that its bounding radius is at
most 0.16 h (0.72 m, 5.1 m, 18.4 m), `scale = min(1, 0.16 * height / radius)`; that keeps it
inside 0.85 of the distance from the view axis and 0.6 of the depth at every stage. Other
players and the third-person camera keep the true size. The thrown projectile is a separate
object and keeps its size.

## 7. Aim, beam and throw origins (change 6; shared code)

The simulation aims from points that are not where the model has them
(`shared/src/defs/kaiju/lizard.ts` lines 26 to 28, 41 to 43, 56 to 58):

| | Stage 1 | Stage 2 | Stage 3 |
| --- | --- | --- | --- |
| `eyeHeight` in the definition | 3.8 | 28 | 100 |
| model `cam_fp`: height / forward of the body axis | 4.20 / 1.73 | 27.54 / 10.95 | 90.69 / 38.47 |
| `mouthHeight` in the definition | 3.3 | 24 | 88 |
| model `mouth`: height / forward | 2.90 / 2.50 | 21.98 / 15.04 | 72.03 / 51.44 |
| `handHeight` in the definition, and 0.6 body radii forward (`kaijuEffects.ts` lines 38, 348 to 350) | 2.2 / 1.44 | 16 / 5.4 | 58 / 15.6 |
| model `hold` anchor at `throw_release`, seen from outside: height / forward | 2.65 / 3.07 | 17.04 / 20.97 | 52.62 / 74.93 |

Effects today: the throw's aim ray starts at (`k.x`, `eyeHeight`, `k.z`)
(`shared/src/sim/kaijuEffects.ts` line 354) while the player's crosshair ray starts at the
camera, 38 m further forward and 9 m lower at stage 3. Looking 40 degrees down, the two rays
land 1.1 m, 5.5 m and 11 m apart on the ground at stages 1, 2, 3 with the head locked to the
aim (2.2 m, 10 m and 27 m with the camera at its rest position). The beam starts at (`k.x`, `mouthHeight`, `k.z`)
(`shared/src/sim/beam.ts` lines 69 to 70) and is drawn from the model's mouth to the
simulation's end point (`kaijuView.ts` lines 242 to 247), so it is drawn at a different slope
than it burns. A thrown object appears 59 m behind the hand at stage 3.

With the head locked to the aim (section 3) the camera and the mouth turn about the head
pivot, so the exact origins are, for an aim (yaw, pitch) and a body heading `k.yaw`:

```
pivot  = (k.x + sin(k.yaw) * pivotForward,  pivotHeight,  k.z + cos(k.yaw) * pivotForward)
origin = pivot + up * (offUp * cos(pitch) + offForward * sin(pitch))
               + aimDirHorizontal * (offForward * cos(pitch) - offUp * sin(pitch))
```

with `aimDirHorizontal = (sin(yaw), 0, cos(yaw))` and, per stage:

| | Stage 1 | Stage 2 | Stage 3 |
| --- | --- | --- | --- |
| `pivotHeight` / `pivotForward` (the `head` node) | 3.36 / 0.29 | 24.47 / 5.59 | 80.68 / 20.80 |
| eye: `offUp` / `offForward` | 0.84 / 1.44 | 3.07 / 5.36 | 10.01 / 17.67 |
| mouth: `offUp` / `offForward` | -0.46 / 2.21 | -2.49 / 9.45 | -8.65 / 30.64 |

(The pivot itself moves with the neck and the body: by up to about 0.06 h while looking
around, more during a lunge or a roar. The formula is exact for the standing rest pose.) The
cheap version, if the pivot
formula is too much: set `eyeHeight` to 4.2 / 27.5 / 90.7, `mouthHeight` to 2.9 / 22.0 / 72.0,
and start both rays `1.73 / 10.95 / 38.5` m (eye) and `2.5 / 15.0 / 51.4` m (mouth) forward
along the aim heading. For the throw, either give `handHeight` and the forward distance the
model's values (last row above), or keep the simulation as it is and let the client draw the
projectile from the `hold` anchor for its first 0.15 s.

These are balance-relevant numbers in shared code (reach of the beam on the ground, what a
level beam hits): the coordinator or the simulation owner decides. The art needs no change
either way.

## 8. Stand-in weak point colour (change 7)

`client/src/assets/procedural/models.ts` line 62: `const WEAK = 0x7dfcff;` becomes
`0xc9a6ff`, so the box stand-in speaks the same colour language as the model.

## 9. Near plane, and what needs no change

- **Near plane: keep `max(0.08, 0.02 * height)`** (`kaijuController.ts` line 93). The art now
  clears it: the nearest point of the head inside the frame is 0.21 m, 1.29 m and 4.15 m from
  the camera plane at stages 1, 2, 3 (0.048 h, 0.040 h, 0.036 h) against a near plane of 0.09,
  0.64 and 2.30 m, and with the head locked to the aim that distance never changes. The
  nearest any hand comes in a pose target is 0.097 h; on the way between any two targets it
  never comes closer than 0.073 h. Checked without the head lock as well (today's animator):
  no hole at the peak of a roar or at the end of the beam and stomp wind-ups.
- The crosshair is free: the highest part of the snout on the center line is 24 to 25 degrees
  below it at every stage, and no pose target brings an arm closer to it than 0.16 in the
  frame coordinates of section 11.
- Body radius: unchanged (2.4 / 9 / 26 m). The titan was narrowed instead: feet 26.4 m and
  trunk 26.9 m to the side (was 37 and 31), arms 47.8 m (was 51 to 62). The juvenile's arms
  were pulled in as well: 10.9 to 14.5 m from the body axis (was 12.4 to 15.4).
- The node `root` is at the origin now; the node tree and every anchor name are unchanged.
- `kaiju_cocoon`, `kaiju_egg` and `portrait_lizard.png` are drop-in replacements.

## 10. Optional polish (change 9)

- **Embers.** The titan has ember facets in the `glow` material at the roots of its dorsal
  spines (in the `spines` node, 42 triangles) and of its tail spikes (in `tail_1` to `tail_5`,
  48 triangles). Its eyes (in `head`) are the only other `glow` part outside `weak_point`. Giving those meshes their own
  copy of the glow material and scaling its colour, 0.6 at rest to 1.6 at full rage or beam
  charge, makes the titan heat up visibly at night.
- **Cocoon.** The light inside is the node `cocoon_glow` (violet, as the weak point: a cocooned
  kaiju takes damage as if staggered). The game squashes and stretches the whole pod
  (`kaijuView.ts` line 155); pulsing the brightness of `cocoon_glow` with the heartbeat sound
  would tie the two together.

## 11. How to check

Frame coordinates used here are normalized device coordinates: x and y from -1 to 1 across the
16:9 frame, x positive to the right, y positive up. In three.js:
`hold.getWorldPosition(v).project(camera)` gives them for the `hold` anchor (an empty node
under `hand_R`).

1. **Rest.** Local kaiju standing, aim level, straight ahead, first person: the camera is at
   the `cam_fp` row of the table in section 3 (relative to the kaiju's position and heading).
2. **Each target.** Drive the rig to a target at full weight (action phases: grab at the end of
   its wind-up; holding and idle; eating; bracing; throw at the end of its wind-up and at the
   start of its recovery; swipe at the end of its active phase) and project `hold`. Expected
   x, y (tolerance 0.03) and depth along the view axis:

   | Target | Stage 1: x, y, depth m | Stage 2: x, y, depth m | Stage 3: x, y, depth m |
   | --- | --- | --- | --- |
   | `fp_claws` | +0.58, -0.78, 1.33 | +0.57, -0.74, 8.93 | +0.57, -0.73, 33.89 |
   | `grab` | +0.52, -0.96, 1.03 | +0.35, -0.70, 8.46 | +0.36, -0.70, 30.09 |
   | `hold` | +0.54, -0.87, 1.22 | +0.47, -0.43, 8.91 | +0.46, -0.40, 33.47 |
   | `eat` | +0.50, -0.95, 1.12 | +0.48, -0.98, 7.43 | +0.55, -0.93, 26.85 |
   | `brace` | +0.52, -0.98, 1.07 | +0.42, -0.85, 8.24 | +0.40, -0.84, 30.85 |
   | `throw_windup` | +0.62, -0.76, 1.40 | +0.58, -0.45, 8.59 | +0.55, -0.43, 32.48 |
   | `throw_release` | +0.50, -0.94, 0.98 | +0.35, -0.73, 8.46 | +0.39, -0.71, 31.72 |
   | `swipe_hit` | +0.53, -1.13, 0.87 | +0.28, -0.95, 6.62 | +0.29, -1.03, 23.03 |

3. **It must not depend on where the player looks.** Repeat any row with the aim pitched 50
   degrees down and with the head leading the body by 50 degrees: same x and y within 0.01.
4. **Pictures.** The eight FIRST PERSON cells of `docs/art/previews/kaiju_lizard_s1.png`,
   `_s2.png`, `_s3.png` are rendered through the game's lens from the same targets (one-armed
   targets with the left claw in the carry): a screenshot of the game in each state should
   match its cell. `docs/art/concept/kaiju_lizard_s*_fp.png` is the carry, lit.
5. **From outside** (another client, or the third-person toggle): in eat the claws close in
   front of the open mouth, not on the skull; in brace they cross in front of the face, not
   over the brow; the swipe ends in front of the nose; no arm passes through the head in any
   action. The STAGGER cells of the same sheets show the stagger with the weak point on.
6. **Stagger.** From a human unit in front of a staggered kaiju at 8 / 45 / 150 m (stages 1,
   2, 3) the violet crystal on the chest is in plain view; from behind, two violet shards
   pulse at the shoulder blades and never go out.

For reference, where the middle of the right hand lands in the frame, how close its nearest
point comes to the camera, and how far the arms stay from the crosshair (frame units), per
target:

| Target | Stage 1 | Stage 2 | Stage 3 |
| --- | --- | --- | --- |
| `fp_claws` | (+0.61, -0.54), 0.63 m, 0.36 | (+0.58, -0.53), 5.01 m, 0.35 | (+0.59, -0.52), 17.93 m, 0.32 |
| `grab` | (+0.54, -0.58), 0.51 m, 0.24 | (+0.31, -0.47), 4.73 m, 0.30 | (+0.31, -0.45), 15.63 m, 0.24 |
| `hold` | (+0.57, -0.57), 0.63 m, 0.32 | (+0.54, -0.55), 5.05 m, 0.39 | (+0.53, -0.54), 17.50 m, 0.37 |
| `eat` | (+0.56, -0.67), 0.62 m, 0.27 | (+0.50, -0.74), 4.85 m, 0.35 | (+0.57, -0.65), 16.95 m, 0.28 |
| `brace` | (+0.56, -0.67), 0.60 m, 0.29 | (+0.41, -0.62), 5.00 m, 0.31 | (+0.42, -0.61), 17.47 m, 0.24 |
| `throw_windup` | (+0.67, -0.53), 0.65 m, 0.37 | (+0.74, -0.56), 4.57 m, 0.64 | (+0.72, -0.53), 15.60 m, 0.57 |
| `throw_release` | (+0.54, -0.60), 0.52 m, 0.19 | (+0.32, -0.48), 4.79 m, 0.27 | (+0.33, -0.47), 16.62 m, 0.29 |
| `swipe_hit` | (+0.49, -0.65), 0.44 m, 0.26 | (+0.25, -0.63), 4.51 m, 0.20 | (+0.24, -0.64), 14.73 m, 0.16 |

## 12. The pose targets (copy of `manifest.kaiju.json`; the manifest wins)

Degrees. "mirror": the left arm has the same x and the opposite y and z. "base": the target
does not name the left arm.

Stage 1 (`kaiju_lizard_s1`):

| Target | Body | `arm_R` | `forearm_R` | `hand_R` | Left arm |
| --- | --- | --- | --- | --- | --- |
| `fp_claws` | none | (-123, -14, 19) | (83, -32, 13) | (-8, -15, 10) | mirror |
| `grab` | `torso` (18, 10, 0) | (-117, 30, 24) | (61, -14, 7) | (16, -14, 70) | base |
| `hold` | none | (-123, -10, 19) | (85, -31, 18) | (4, -6, 22) | base |
| `eat` | `torso` (10, 0, 0), `head` (8, 0, 0), `jaw` (22, 0, 0) | (-119, -6, 21) | (83, -32, 22) | (17, -9, 40) | mirror |
| `brace` | `torso` (16, 0, 0), `neck` (4, 0, 0), `head` (4, 0, 0) | (-120, -6, 18) | (84, -28, 24) | (20, -9, 39) | mirror |
| `throw_windup` | `torso` (-12, -28, 0) | (-121, -12, 17) | (84, -30, 16) | (-24, -11, 4) | base |
| `throw_release` | `torso` (16, 22, 0) | (-123, -5, 15) | (85, -19, 29) | (14, -6, 34) | base |
| `swipe_hit` | `torso` (14, 43, 0), `head` (0, 11, 0) | (-117, 54, 29) | (52, -29, 28) | (32, -11, 70) | base |
| `stagger` | `torso` (-17, 0, 0), `neck` (-11, 0, 0), `head` (-20, 0, 0), `jaw` (20, 0, 0), `leg_L` (-8, 0, 0), `leg_R` (10, 0, 0) | (12, 0, -32) | (-10, 0, 0) | not named | `arm_L` (12, 0, 32), `forearm_L` (-10, 0, 0) |

Stage 2 (`kaiju_lizard_s2`):

| Target | Body | `arm_R` | `forearm_R` | `hand_R` | Left arm |
| --- | --- | --- | --- | --- | --- |
| `fp_claws` | none | (-97, -15, 11) | (53, -23, -3) | (-22, -17, 18) | mirror |
| `grab` | `torso` (18, 10, 0) | (-103, -17, 13) | (65, -17, 8) | (-26, 24, 7) | base |
| `hold` | none | (-102, -54, 8) | (57, -45, 15) | (21, -65, 50) | base |
| `eat` | `torso` (10, 0, 0), `head` (8, 0, 0), `jaw` (22, 0, 0) | (-100, -15, 10) | (66, -29, 7) | (9, -5, 44) | mirror |
| `brace` | `torso` (16, 0, 0), `neck` (4, 0, 0), `head` (4, 0, 0) | (-97, -19, 15) | (54, -21, -1) | (-3, -19, 13) | mirror |
| `throw_windup` | `torso` (-12, -28, 0) | (-105, -46, -1) | (83, -33, 39) | (-67, -39, 30) | base |
| `throw_release` | `torso` (16, 22, 0) | (-102, -22, 13) | (64, -16, 2) | (-26, 17, 11) | base |
| `swipe_hit` | `torso` (14, 43, 0), `head` (0, 11, 0) | (-104, -16, 12) | (68, -15, 12) | (11, -1, 26) | base |
| `stagger` | `torso` (-17, 0, 0), `neck` (-11, 0, 0), `head` (-20, 0, 0), `jaw` (20, 0, 0), `leg_L` (-8, 0, 0), `leg_R` (10, 0, 0) | (12, 0, -32) | (-10, 0, 0) | not named | `arm_L` (12, 0, 32), `forearm_L` (-10, 0, 0) |

Stage 3 (`kaiju_lizard_s3`):

| Target | Body | `arm_R` | `forearm_R` | `hand_R` | Left arm |
| --- | --- | --- | --- | --- | --- |
| `fp_claws` | none | (-97, -16, 18) | (55, -33, -7) | (-23, -14, 20) | mirror |
| `grab` | `torso` (18, 10, 0) | (-104, -13, 12) | (74, -19, 27) | (-20, 26, -3) | base |
| `hold` | none | (-105, -48, 1) | (77, -35, 35) | (7, -67, 50) | base |
| `eat` | `torso` (10, 0, 0), `head` (8, 0, 0), `jaw` (22, 0, 0) | (-100, -15, 10) | (66, -29, 7) | (9, 5, 44) | mirror |
| `brace` | `torso` (16, 0, 0), `neck` (4, 0, 0), `head` (4, 0, 0) | (-103, -19, 13) | (75, -28, 20) | (-17, -15, 1) | mirror |
| `throw_windup` | `torso` (-12, -28, 0) | (-107, -32, 3) | (99, -32, 54) | (-64, -42, 28) | base |
| `throw_release` | `torso` (16, 22, 0) | (-105, -17, 13) | (76, -25, 20) | (-27, 37, 3) | base |
| `swipe_hit` | `torso` (14, 43, 0), `head` (0, 11, 0) | (-104, -15, 11) | (76, -15, 26) | (8, 2, 14) | base |
| `stagger` | `torso` (-17, 0, 0), `neck` (-11, 0, 0), `head` (-20, 0, 0), `jaw` (20, 0, 0), `leg_L` (-8, 0, 0), `leg_R` (10, 0, 0) | (12, 0, -32) | (-10, 0, 0) | not named | `arm_L` (12, 0, 32), `forearm_L` (-10, 0, 0) |

## 13. Fallback targets for the stand-in rig (radians: today's numbers)

```ts
const FALLBACK_POSES = {
  fp_claws: {},
  hold: { arm_R: [-0.9, 0.15, 0], forearm_R: [-0.6, 0, 0] },
  grab: { torso: [0.3, 0.2, 0], arm_R: [-1.55, 0.2, 0], forearm_R: [-0.45, 0, 0], hand_R: [-0.5, 0, 0] },
  eat: { torso: [0.2, 0, 0], head: [0.3, 0, 0], jaw: [0.3, 0, 0], arm_L: [-1.55, -0.45, 0], arm_R: [-1.55, 0.45, 0],
         forearm_L: [-1.1, 0, 0], forearm_R: [-1.1, 0, 0] },
  brace: { torso: [0.38, 0, 0], neck: [0.2, 0, 0], head: [0.3, 0, 0], arm_L: [-1.25, -0.7, 0], arm_R: [-1.25, 0.7, 0],
           forearm_L: [-0.9, 0, 0], forearm_R: [-0.9, 0, 0] },
  throw_windup: { torso: [-0.25, -0.3, 0], arm_R: [-2.8, 0, -0.2], forearm_R: [-0.8, 0, 0] },
  throw_release: { torso: [0.3, 0.3, 0], arm_R: [-1.1, 0, 0], forearm_R: [-0.1, 0, 0] },
  swipe_hit: { torso: [0.25, 0.75, 0], head: [0, 0.2, 0], arm_R: [-1.25, 0.9, 0], forearm_R: [-0.15, 0, 0], hand_R: [-0.4, 0, 0] },
  // the stagger target is the same at every stage: use it for the stand-in too
  stagger: { torso: [-0.297, 0, 0], neck: [-0.192, 0, 0], head: [-0.349, 0, 0], jaw: [0.349, 0, 0],
             arm_L: [0.209, 0, 0.559], arm_R: [0.209, 0, -0.559], forearm_L: [-0.175, 0, 0], forearm_R: [-0.175, 0, 0],
             leg_L: [-0.140, 0, 0], leg_R: [0.175, 0, 0] },
};
```

## 14. Where the numbers come from

- `tools/art/kaiju/poses.py` loads an exported `.glb`, poses it with the same Euler order the
  game uses and projects it through the game's first-person lens. `check()` runs on every art
  build (`tools/art/kaiju_lizard.py`) and fails the build when a target leaves the lower third
  of the frame, comes within 0.14 of the crosshair or touches the head, in the first-person
  assembly or seen from outside.
- The animator as written in section 4, the head lock and the riding arms were replicated in
  a scratch harness on top of the art director's copy of the game's cameras, and every action
  was rendered through it at every stage, with look pitch and head lead applied. Those
  renders are not in the repository; the contact sheets named in section 11 are the durable
  record.
- Distances and anchor positions were read from the `.glb` files with `tools/art/lib/glb.py`.
