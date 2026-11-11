# Music: what the client has to change

For the client engineer. The audio review (quality assurance pass on every sound file) found
that the music files are sound but that the game does not yet play two of them the way they were
written. The music side is done and rebuilt; this page lists what is left in `client/src`, which
the music worker does not own.

Line numbers are those of commit `2f69ae5`. Background on every cue is in `docs/audio/MUSIC.md`
(section 4 is "How the client should play it").

## At a glance

| # | Change | Where | Status |
| --- | --- | --- | --- |
| 1 | Start `intermission` late, so its hit lands when the next stage begins | `audioEngine.ts` `playMusic`, `matchAudio.ts:262` | needed (review finding) |
| 2 | Never loop a cue that has no loop points (`cocoon`) | `audioEngine.ts:469`, `:487` | needed (review finding) |
| 3 | Read the new manifest field `mark` | `client/src/assets/manifest.ts:36` | needed for 1 |
| 4 | Land the cocoon's cut on the molt blast, the same way | `matchAudio.ts:250` | recommended |
| 5 | Let the intermission's hit ring out when the stage music starts | `audioEngine.ts:416`, `:467`, `matchAudio.ts:300` | recommended |
| 6 | Load music before it is needed | `audioEngine.ts` (new method), `matchAudio.ts:77`, `:247` | recommended |

Nothing else changes for the client: ids, file lengths, loop points and stem alignment are what
they were (section "What changed in the files" at the end).

## 1. Start the intermission late, so the hit lands on time

**The problem.** `intermission` is a 20 second build whose only payoff is a single hit exactly
20.0 s into the file. Without a draft the intermission lasts 8 s (`MATCH_RULES.intermission`,
`shared/src/defs/rules.ts:26`; 20 s with a draft, `rules.ts:27`). The client starts the file
at its beginning:

```ts
// client/src/audio/matchAudio.ts:262
else if (e.phase === 'intermission') this.audio.playMusic(['intermission'], { loop: false, fade: 0.6 });
```

So players hear the quietest 8 s of the build and the hit never arrives. Measured on the file:

| An 8 s intermission | Loudness of what is heard | The hit |
| --- | --- | --- |
| today, file from 0.0 s | -22.6 LUFS (second by second: -24 -24 -23 -24 -24 -22 -22 -20) | 12 s after the stage has started, so never heard |
| as written, file from 12.0 s | -13.7 LUFS (second by second: -18 -16 -16 -15 -13 -12 -12 -12) | on the stage start |

LUFS is Loudness Units relative to Full Scale, the standard loudness measure; a higher (less
negative) number is louder.

**The rule.** The manifest entry now carries the hit time: `"mark": 20`. If the event the cue
aims at (here: the next stage begins) is `T` seconds away when the source starts, start it at

```
offset = mark - T          8 s intermission: 20 - 8 = 12.0 s      20 s intermission: 0
```

If `offset` comes out negative (the event is further away than the build is long), start the
file from 0 after waiting `-offset` seconds. If `T` is already 0 or less, do not start the cue.

**What to change.**

1. `playMusic` (`client/src/audio/audioEngine.ts:457`) takes one more option, for example
   `landIn?: number`: seconds from the call until the event. Convert it to a deadline at once,
   `landAt = performance.now() / 1000 + landIn`, and keep the deadline with `wantedMusic`
   (`audioEngine.ts:94` and `:461`). The reason: when sound is not unlocked yet, `update` starts
   the music later with the stored options (`audioEngine.ts:620`), and a relative number would
   then be stale.
2. Where the source is started (`audioEngine.ts:474` to `:493`), work out the offset at that
   moment, because the buffer may have taken a while to load. A sketch of the logic, to be fitted
   into the loop over the layers (a one-shot only ever has one layer):

   ```ts
   const when = ctx.currentTime + 0.05;                       // existing line 474
   // ...for the first layer:
   let offset = 0;
   let wait = 0;
   const mark = entries[0]?.mark;
   if (landAt !== null && mark !== undefined) {
     const remaining = landAt - performance.now() / 1000 - 0.05;   // 0.05: the lead of `when`
     if (remaining <= 0) return;                               // the moment has passed: play nothing
     offset = mark - remaining;
     if (offset < 0) { wait = -offset; offset = 0; }
   }
   src.start(when + wait, offset);                             // replaces src.start(when), line 493
   ```

   The gain ramp on line 481 starts at `when + wait` too. Keep the fade as it is: with
   `fade: 0.6` the cue swells in over about half a second, which at an offset of 12.0 s is exactly
   the half-second pickup before bar 6 of the build (bar 6 starts at 12.5 s).
3. Call site, `matchAudio.ts:262`:

   ```ts
   this.audio.playMusic(['intermission'], { loop: false, fade: 0.6, landIn: e.duration });
   ```

   `e.duration` is the length of the phase in seconds (`MatchPhaseEvent.duration`,
   `shared/src/sim/events.ts:391`). The server sets it from the same number it counts down
   (`shared/src/sim/systems/matchFlow.ts:206` and `:247`).

**How to check.**

- Test with a fake audio context (or a spy on `AudioBufferSourceNode.start`): with
  `landIn: 8` the source starts with an offset between 12.0 and 12.1; with `landIn: 20`, between
  0 and 0.1; with `landIn: 25`, offset 0 and a start time 5 s later; with `landIn: 0`, no start.
- In a bot match without drafts, log three times: when the `matchPhase` event for the
  intermission arrives, when `src.start` is called (with its offset), and when the phase turns
  to `playing`. Then `(time of playing - time of start) + offset` must be 20.0, give or take 0.1.
- By ear: the build is loud from its first second and ends on one big hit as the squads appear
  at the new edge. Eight quiet seconds with no hit means the offset is not applied.

## 2. Never loop a one-shot

**The problem.** `playMusic` loops everything unless the caller says otherwise:

```ts
// client/src/audio/audioEngine.ts:469
const loop = options.loop !== false;
// :487
src.loop = loop;
if (loop && entry?.loop && entry.loop[1] > entry.loop[0]) { ... }
```

and the cocoon cue is started without `loop: false` (`matchAudio.ts:250`). `cocoon` has no loop
points, so if anything ever kept it playing past its 12.5 s it would loop the whole file,
silence and all.

**What to change.** Decide from the manifest, not from the caller: an entry without `loop` is a
one-shot (this is now in `docs/ASSETS.md` section 7).

```ts
src.loop = loop && entry?.loop !== undefined;     // line 487
```

One-shots are `cocoon`, `intermission`, `win_humans` and `win_kaiju`. The `loop: false` that
two call sites pass (`matchAudio.ts:262`, `:273`) then does no harm and can stay.

**How to check.** A test that plays each of the four ids and asserts `source.loop === false`,
and each of the nine loops (`lobby`, `briefing`, `stage1_base` to `stage3_combat`, `hearing`)
and asserts `true` with `loopStart === 0.25`.

## 3. The manifest field `mark`

`client/src/assets/manifest.ts:36`:

```ts
export interface MusicEntry {
  base: string;
  loop?: [number, number];
  bpm?: number;
  group?: string;
  duration?: number;
  mark?: number;        // add: seconds into a one-shot of the moment that lands on a game event
}
```

Two entries carry it: `intermission` (`mark: 20`, the hit) and `cocoon` (`mark: 10`, where the
music stops dead). The merged `manifest.json` already has both. If the field is missing, play
from 0 as before.

## 4. The cocoon: land the cut on the blast (recommended)

The cocoon music stops dead exactly 10.0 s into the file, which is where the molt blast sounds.
It is started when the cocoon starts, so it is right as long as the file starts at once. If the
file has to be fetched and decoded first, the cut comes late by however long that took. The
mechanism of change 1 fixes that for free:

```ts
// client/src/audio/matchAudio.ts:250
this.audio.playMusic(['cocoon'], { fade: 0.8, landIn: e.duration });
```

`e.duration` is `CocoonEvent.duration` (`shared/src/sim/events.ts:354`), 10 s
(`MATCH_RULES.cocoon`, `rules.ts:30`).

**The heartbeat needs no client change, and must not get one.** The music used to contain its
own drum heartbeat, which played at full level for everyone and beat at a different rate from
the game's. It has been removed from the file. The only heartbeat is now the positional loop
that `matchAudio.ts:249` already starts:

```ts
this.heartbeat = a.loop('kaiju_heartbeat_loop', { x: e.x, y: 2, z: e.z, refDistance: reach * 1.2 });
```

Keep it positional, keep playing the cocoon music for every player, and do not add a second
heartbeat anywhere. Measured: below 120 Hz the music is now at -48.6 dBFS (decibels relative to
full scale; it was -25.6), and the heartbeat's beats are at -15 dBFS in the same band, so the
effect stays clear of the music until it has dropped by about 30 dB with distance.

**How to check.** As a human player far from the cocoon: an eerie choir and a faint heartbeat
that grows as you approach. Standing next to it: a strong heartbeat. Before the fix there was a
second, louder drum under the choir that never changed with distance.

## 5. Let the hit ring when the stage music starts (recommended)

**The problem.** When the phase turns to `playing`, the stage stems are started with the default
fade (`matchAudio.ts:300`, `fade = options.fade ?? 1.2` on `audioEngine.ts:466`), and the same
number fades the intermission out (`stopMusic(fade)`, `audioEngine.ts:467` and `:416`). The gain
follows `setTargetAtTime(..., fade / 3)`, a time constant of 0.4 s. Measured on the files:

| Setting | Stage stems on their first downbeat | The hit's ring one second later |
| --- | --- | --- |
| today: 1.2 s for both | 6.7 dB under full level | -39.7 dBFS (cut off) |
| recommended: 0.3 s in, 2.5 s out | 0.7 dB under full level | -28.6 dBFS (rings out) |

The first downbeat of a stage file comes 0.25 s after the file starts (the lead-in), plus the
0.05 s scheduling lead: 0.30 s after the hit, which is one eighth note at this tempo (0.3125 s).
So the hit, then the stage's first chord an eighth later, both on D.

**What to change.**

1. `playMusic` takes a separate time for the music that is leaving, for example
   `fadeOut?: number`, and line 467 becomes `this.stopMusic(options.fadeOut ?? fade)`.
2. `matchAudio.ts:298` to `:301`:

   ```ts
   if (match.phase === 'playing' && !cocooned && this.musicStage !== match.stage) {
     const afterIntermission = this.audio.music === 'intermission';
     this.musicStage = match.stage;
     this.audio.playMusic([`stage${match.stage}_base`, `stage${match.stage}_combat`],
       afterIntermission ? { fade: 0.3, fadeOut: 2.5 } : {});
   }
   ```

**Headroom.** The overlap of the ringing hit and the first bar of the stage was added up from
the encoded files: the true peak is -2.9 dBTP (decibels true peak) with the base stem alone and
-1.7 dBTP with the combat stem at full level as well. That is under the peak of a single cue, so
no limiter is needed for it.

**How to check.** By ear: the hit decays naturally under the first bar of the new stage, and
the stage's first chord speaks at full strength. In a test: after the switch the old layer's
gain is scheduled with a time constant of about 0.83 s and the new one with 0.1 s.

## 6. Load music before it is needed (recommended)

`playMusic` fetches and decodes a file the first time it is asked for (`load`,
`audioEngine.ts:198`). An 80 s stem takes a noticeable fraction of a second to decode, so the
first bar of a stage, the cocoon and the intermission all start late the first time. Changes 1
and 4 hide that for the two one-shots; the stage stems still come in late.

**What to change.** A method next to `preload` (`audioEngine.ts:223`):

```ts
preloadMusic(ids: string[]): void {
  if (!this.ctx) return;
  for (const id of ids) {
    const entry = this.assets.manifest.music[id];
    if (entry) void this.load(entry.base);
  }
}
```

Call it:

- in `MatchAudio.begin` (`matchAudio.ts:77`): `['stage1_base', 'stage1_combat', 'cocoon', 'intermission']`
- on the `cocoon` event (`matchAudio.ts:247`), for the stage that follows (18 s of warning):
  `['intermission', 'stage<n+1>_base', 'stage<n+1>_combat']`
- the two win cues are small (under 6 MB decoded each): add `win_humans` and `win_kaiju` to the
  list in `begin`, so the fanfare starts with the last blow and not after it.

**Memory, since it comes up here.** A decoded 80.5 s stereo stem is about 31 MB (megabytes) at
48 kHz, and `buffers` and `ready` (`audioEngine.ts:86` and `:87`) never let go of anything. All
thirteen cues decoded come to about 260 MB. When a new stage starts, the stems of the stage
before it can be dropped from both maps (they are never played again in that match).

## Related: the end screen

The end-screen finding (when the committee chair speaks, when `hearing` starts) belongs to the
voice notes. Two facts about the music for whoever does it:

- `win_humans` is below -30 dBFS from 12.2 s and `win_kaiju` from 12.1 s (files are 14.5 and
  14.9 s long; the rest is ring-out). `hearing` can start from 12.5 s; the 14 s on
  `client/src/app/screens/end.ts:122` and `:123` is safe but later than it needs to be.
- Do not start `hearing` under `win_humans` earlier than that: the fanfare is in D major and
  the hearing bed is in D minor, and the two thirds clash (F sharp against F). Under
  `win_kaiju`, which is in D minor, an earlier crossfade is harmless.

## What changed in the files (no client work)

- `cocoon`: no heartbeat drums any more; mastered at -17 LUFS (was -16), so the choir, strings
  and celesta are as loud as before (within 0.1 dB). Still 12.5 s, music stops at 10.0 s.
- `stage2_base`, `stage3_base`: more weight at the bottom (stage 3: organ pedal with a real
  16-foot tone, basses in octaves; stage 2: basses in octaves and plucked an octave below).
- `stage2_combat`, `stage3_combat`: the four quiet bars per loop now keep a reduced drum pulse,
  so fading the combat stem in is audible anywhere in the loop.
- All stage stems: still 80.5 s, loop points `[0.25, 80.25]`, base and combat aligned to the
  sample, and safe to add at full level (true peak of the sums: -1.1 dBTP or lower).
- Bus levels were not touched. For reference they are `music: 0.55`, `master: 0.9`
  (`audioEngine.ts:84`), and music ducks to 0.4 under speech (`DUCK_MUSIC`, `audioEngine.ts:54`).
