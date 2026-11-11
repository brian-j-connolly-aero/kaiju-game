# Sound effects: what the game code still has to do

For the client engineer. The audio review found four things about the sound effects. The audio
side of each is done (files rebuilt, measured, manifest merged). This page lists what is left
in `client/src`, with file and line numbers as of commit `2f69ae5`, the numbers to use, and how
to check each one. Nothing here needs another audio build.

Levels are given in LUFS (loudness units relative to full scale, the broadcast loudness
measure; the voice lines are at -16) and in dB (decibels).

| # | Finding | Audio side (done) | Client side |
| --- | --- | --- | --- |
| 1 | `volley_ready` was the same two notes as `ui_ready` | New sound: the charging tone whips up and locks | **Needed:** nothing plays `volley_ready` or `laser_charge_loop` yet (section 1) |
| 2 | `laser_charge_loop` too quiet, `kaiju_beam_loop` too loud | Loop is 6 dB louder; beam is 3 dB quieter | Section 1 for the loop. Beam: change nothing, do **not** add a gain (section 3) |
| 3 | `kaiju_molt_blast` peaked 0.24 s after its start | Peak is now 0.04 s after its start | Keep the trigger; **needed:** load the file ahead of time (section 2) |
| 4 | The 20 Tier 2 sounds were missing | All 20 exist and are in the manifest | Roars already work; the rest wait for the Tier 2 units (section 4) |

## 1. Volley charge: play `laser_charge_loop` and `volley_ready`

**Now.** Neither id is used anywhere in `client/src`. The only place audio looks at charging
is `client/src/audio/matchAudio.ts` line 309 (`frame.units.some((u) => u.alive && u.laser)`,
for the music's combat stem). So a player hears nothing while the squad charges and nothing
when it is ready.

**What the two sounds are.**

- `laser_charge_loop`: a thin electric tone at 880 Hz, loop points 0.25 to 1.25 s, now at
  -21 LUFS (it was -27). It is made to be sped up with the charge: playback rate 1.0 at charge
  0, rate 1.5 at charge 1 (1320 Hz).
- `volley_ready`: 0.46 s. Starts at 1320 Hz, exactly where the loop is at full charge, slides
  up to 1760 Hz in 0.09 s and locks there with a tick and a ringing fifth. Peak level -5.9 dB.

**Engine change** (`client/src/audio/audioEngine.ts`). A loop cannot change speed yet:
`PlayOptions.rate` (line 25) is ignored by `loop()` (lines 351 to 412) and `LoopHandle` (lines
30 to 34) has no way to set it.

1. Add to `LoopHandle`: `setRate(rate: number): void;`
2. In `loop()`, keep `let rate = options.rate ?? 1;` beside `wanted` (line 358), set
   `source.playbackRate.value = rate;` after `source.loop = true;` (line 368), and add to the
   returned handle:
   `setRate: (r) => { rate = r; if (source && ctx) source.playbackRate.setTargetAtTime(r, ctx.currentTime, 0.05); }`.
   `loopStart` and `loopEnd` are positions in the file, so they stay right at any speed.

**Game change** (`client/src/audio/matchAudio.ts`). One loop for the local player's own squad,
however many of its sub-units are charging (three loops of one tone would add up to a level
above the voice). Fields beside `beam` and `heartbeat` (lines 65 and 66):

```ts
private charge: LoopHandle | null = null;
private chargedCount = 0;
private lastReady = -1;
```

In `update()` (lines 293 to 314), after the combat heat:

```ts
const squadId = this.session?.role.squadId ?? -1;
const mine = squadId >= 0 ? frame.units.filter((u) => u.alive && u.laser && u.squad === squadId) : [];
if (mine.length === 0) {
  this.charge?.stop(0.15);
  this.charge = null;
  this.chargedCount = 0;
} else {
  const top = Math.max(...mine.map((u) => u.charge));
  const full = mine.filter((u) => u.charge >= 0.999).length;
  if (!this.charge && this.audio.unlocked) this.charge = this.audio.loop('laser_charge_loop', { gain: 0.5 });
  this.charge?.setRate(1 + 0.5 * top);
  // Louder with every laser that joins; a quiet hum once all are full and the player waits.
  this.charge?.setGain(full === mine.length ? 0.3 : 0.5 + 0.17 * Math.min(3, mine.length));
  if (full > this.chargedCount && this.time - this.lastReady > 0.3) {
    this.lastReady = this.time;
    this.audio.play('volley_ready', { gain: 0.9 });
  }
  this.chargedCount = full;
}
```

Also stop the loop in `end()` (lines 83 to 96) the way `beam` is stopped, reset
`chargedCount`, and add `'volley_ready'` and `'laser_charge_loop'` to `PRELOAD_SFX` (lines 39
to 57).

**Why these numbers.**

- Rate `1 + 0.5 * charge`: the tone climbs a fifth over the charge (`chargeTime: 6` seconds,
  `shared/src/defs/rules.ts` line 97) and arrives on the pitch `volley_ready` starts from.
  `charge` is the snapshot field (`SnapUnit.charge`, 0 to 1 in steps of 1/255,
  `shared/src/net/snapshot.ts` line 201); full arrives as exactly 1.
- Gain 0.67 / 0.84 / 1.0 for one, two or three lasers puts the tone at about -24.5 / -22.5 /
  -21 LUFS: clearly audible, 5 dB under a voice line.
- Gain 0.3 once every laser is full (about -31.5 LUFS). A squad can hold a full charge for a
  long time; a steady 1320 Hz tone at full level would be tiring within seconds.
- One `volley_ready` per 0.3 s at most. Three sub-units given the order together fill on the
  same frame; three copies started on one frame add up to three times the level and clip.
- Both are flat (no position): they are the player's own squad reporting in, like `shaken`
  (line 229) and `takeover` (line 233).

**Optional, for a playtest to decide.** The kaiju sees the yellow lasers; it could also hear
them. If wanted: one positional loop per charging unit of any squad the listener is not in,
the four nearest only, `{ x, y: 1.5, z, refDistance: 8, gain: 0.7 }`, same rate rule, and a
positional `volley_ready` at gain 0.6 when one fills.

**Check.**

- Put the choice in a small pure function (for example `chargeTone(units, squadId)` returning
  `{ rate, gain, full } | null`) and test it: no charging unit gives `null`; one unit at charge
  0.5 gives rate 1.25 and gain 0.67; three units at charge 1 give rate 1.5, gain 0.3, full 3.
- By ear, as a human player: choose "hold fire and charge". The tone starts at once, rises
  smoothly for 6 seconds, then one bright ping and the tone drops to a hum. Firing the volley
  stops it within a quarter of a second. A roar in range (it resets the charge) makes the tone
  drop back to its low pitch and start again, and there is a new ping when it refills.
- In the lobby, marking ready (`client/src/app/screens/lobby.ts` line 58, `ui_ready`) must now
  sound nothing like the ping in the match: two plain notes against a slide and a ring.

## 2. Molt blast: keep the trigger, load the file early

**Audio.** `kaiju_molt_blast` used to open with 0.22 s of air being sucked in, so its peak came
0.24 s after the frame that triggered it. The lead-in is now 0.03 s and the peak is at 0.04 s
(measured on both formats). The file is 4.04 s long.

**Client.** `matchAudio.ts` line 255 plays it on the `moltBlast` event. That is right: leave
it there and do not start it early.

One thing can still make it late. `play()` (`audioEngine.ts` lines 315 to 348) starts a sound
whose file is not decoded yet when the file arrives, and gives up if that takes more than
0.25 s (line 332). `kaiju_molt_blast` is not in `PRELOAD_SFX`, so the first blast of a match is
late by however long the download and decode take, or silent. The cocoon gives 10 seconds of
warning. In the `cocoon` case (lines 247 to 251) add:

```ts
this.audio.preload(['kaiju_molt_blast']);
```

**Check.** With the browser's network panel throttled to a slow connection, play to the first
molt: `kaiju_molt_blast.ogg` (or `.mp3`) is requested when the cocoon starts, not when it
ends, and the blast is heard on the frame the cocoon bursts, as the cocoon music stops.

## 3. Beam loop: nothing to add

**Audio.** `kaiju_beam_loop` is now -18.2 LUFS (it was -15.2, level with the loudest moment of
a large explosion and above the voice for its whole 3 seconds). The change is in the file. The
manifest still says `gain: 1`, and `audioEngine.ts` multiplies by it (lines 333 and 374), so
**do not add the 0.7 the review suggested as an alternative**: that would lower it twice.

**Optional.** The loop file starts with a 0.17 s fade-in, and `loop()` adds its own (time
constant 0.2 s, line 374) and starts from the beginning of the file (line 375), so the beam
creeps in over about half a second after `kaiju_beam_charge` has ended on its peak. To enter at
full level: start at the loop start, `source.start(0, entry.loop[0])` (0.25 s), and use a time
constant of 0.03 s when the caller asks for it (for example a `sharp: true` option passed from
`matchAudio.ts` line 151). Ambiences should keep the slow start.

**Check.** Fire the beam as the kaiju with a voice line playing: the news line stays easy to
follow over the beam.

## 4. Tier 2 sounds: ready to be wired

All 20 ids from `docs/ASSETS.md` section 6 exist in both formats and are in `manifest.json`.
Lengths, loop points and "loudest at" times are in the table at the end of `docs/audio/SFX.md`.

**Roars work today.** `matchAudio.ts` line 161 already asks for
`kaiju_roar_${kind}_s${stage}`, and the kinds in `shared/src/defs/ids.ts` line 44 (`lizard`,
`crab`, `burrower`, `moth`) match the file names. All four roars have the same lengths and the
same loudness at each stage, so nothing else changes. Only the preload is wrong for a kaiju
that is not the Lizard: `PRELOAD_SFX` names `kaiju_roar_lizard_s1` (line 43). Preload
`kaiju_roar_${kind}_s${stage}` for the kaiju in the match when it starts and at each new stage.

**The rest wait for their units.** Suggested wiring, to be adjusted at a playtest. "Lead" is
how long before its moment a sound has to start.

| Id | When | How |
| --- | --- | --- |
| `burrow_loop` | While the Burrower is underground | Loop. For the kaiju player: at its own position. For humans: at the centre of the seismograph ring they are shown, not at the true position (the ring is deliberately inexact; the sound must not be more exact than the ring). `refDistance` 0.8 times the stage reach (`REACH`, line 27) |
| `gust` | The Moth's wing gust | Positional at the kaiju. Lead 0.25 s: the wall of air is 0.26 s in |
| `drone_loop` | Each drone, reporter drones included (nearest 4) | Loop, `refDistance` 8, rate 1.0 hovering to 1.3 at top speed (needs `setRate` from section 1) |
| `heli_loop` | Each helicopter (nearest 3) | Loop, `refDistance` 30, rate 0.95 to 1.1 with speed |
| `jet_flyby` | A strafing run | One play per run, at the target. Lead 1.2 s (the two jets cross at 1.15 and 1.42 s), `refDistance` 150 |
| `freeze_ray` | Each ray gun shot | Positional, `refDistance` 12. No more than one start per 0.15 s |
| `dish_beam_loop` | While a dish truck's beam is on | Loop at the truck, `refDistance` 25 |
| `generator_overload` | A generator is about to explode | Lead 2.2 s, then `explosion_l` on the explosion. If the simulation gives no warning, leave it out and play only the explosion |
| `bell` | A bell truck rings | Positional, `refDistance` 30. Three variants, picked at random as usual: they are tuned to one chord |
| `chant_loop` | Each Coalition unit charging a chanted volley | Loop, `refDistance` 12, gain 0.8. It is 5 s long, eight beats of the stage music (0.625 s each): start it on a beat if the music clock is at hand |
| `relic_open` | The Ark opens | Lead 1.9 s before the cone fires. Stereo: play it flat for everyone, or positional with `refDistance` three times the stage reach |

**Not covered.** The contract lists no sounds for the three new specials (claw clamp,
sinkhole, scale dust) or for hurt, stagger and death of the new kaiju. Until someone orders
them, the Lizard's body sounds serve for all four, and line 148 (`kaiju_beam_charge` on every
`special`) needs a check for the kind once another kaiju can use its special.

## 5. Seen while reading, not part of the review

- `kaiju_hurt` is one size of animal and is meant to be played at rate 1.2, 1.0 and 0.8 for
  stages 1, 2 and 3 (`docs/audio/SFX.md`, "Playback rate"). Line 169 plays it at rate 1 for
  every stage. `play()` already takes `rate`: add `rate: [1.2, 1.0, 0.8][s.stage - 1]`.
