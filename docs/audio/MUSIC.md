# Monster Battle 9001: the soundtrack

Choir and orchestra that swell with each stage, written as code and rendered from a General MIDI
(Musical Instrument Digital Interface) soundfont. Thirteen cues (26 files), one theme, one key,
one tempo.

- Files: `client/public/assets/audio/music/<id>.ogg` and `.mp3` (44.1 kHz stereo).
- Manifest: `client/public/assets/manifest.music.json` (the `"music"` section).
- Source: `tools/audio/music/` (rebuild everything with `tools/audio/music/build.sh`).
- Measurements and pictures: `docs/audio/music/` (`MEASUREMENTS.md`, one spectrogram per file,
  one loop-splice picture per loop and format).

## 1. The musical idea

**Key:** D minor. **Tempo:** 96 beats per minute, 4/4, for every cue. One bar is exactly 2.5 s
(110250 samples), one beat 0.625 s. Every length in the game's contract lands on whole bars:
20 s is 8 bars, 30 s is 12 bars, 80 s is 32 bars, the 10 s cocoon is 4 bars.

**The theme** ("Gragnor's theme") is an eight-bar tune on one rhythmic cell: long, short, long
(a dotted quarter, an eighth, a half note).

```
bar        1        2        3         4        5        6        7         8
tune     D  D F | E  D C | F  F Bb | A  G E  | D  D F | E  D C | G  F Eb | D
bass     D      | C      | Bb   G  | A       | D      | C      | Eb   A  | D
chords   Dm     | C      | Bb   Gm | A7      | Dm     | C      | Eb  A7b5| Dm
```

- Bars 1 and 2 (**D D F, E D C**) are the **head motif**. Every cue quotes it.
- Bars 1 to 4 sit on a descending "lament" bass and stop on the dominant.
- Bars 5 to 8 answer, and close through the flattened second: an E flat chord, then A7 with a
  flat fifth, so the last step of the tune is E flat falling to D. That is the monster's cadence.
- A **second strain** (8 bars: G minor, D minor over F, E flat, A7; G minor, B flat, E
  half-diminished, A7) turns the cell downwards and climbs back to the dominant.

How it develops through a match:

| Where | What happens to the theme |
| --- | --- |
| `lobby` | Stated in full, twice: low and plain, then tutti. This is where players learn it. |
| `briefing` | Head motif once, on English horn, over a pedal. |
| `stage1` | Fragments only: plucked, on muted trumpet, on clarinet (which breaks off). Four bars of the tune finally get out near the end of the loop, then sink back. |
| `stage2` | The first full statements of the match: horns, then violins, then choir in octaves. |
| `stage3` | Dark statement by men's voices and low brass; then the first half of the theme **at half speed as the bass line** under a slow chorale; then the apotheosis with the whole choir. |
| `cocoon` | Head motif on celesta, like a music box, under a choir cluster. |
| `intermission` | The cell climbs one step a bar over a dominant pedal; in bar 4 it is the head motif at home pitch. |
| `win_humans` | Head motif turned to D major as a trumpet fanfare. |
| `win_kaiju` | Head motif plus the flat-second close, for full choir. |
| `hearing` | First half of the theme as a passacaglia over its own lament bass. |

## 2. Cue list

Loop points are in seconds and are exact sample positions at 44.1 kHz. "Bars" is the musical
body; loops carry an extra 0.25 s before the loop start and 0.25 s after the loop end (see
section 4).

| id | title | kind | bars | file length | loop [start, end] | group | loudness (LUFS) |
| --- | --- | --- | ---: | ---: | --- | --- | ---: |
| `lobby` | The Long Watch (brooding march) | loop | 32 | 80.5 s | [0.25, 80.25] | | -16.1 |
| `briefing` | Situation Room (tense bed) | loop | 8 | 20.5 s | [0.25, 20.25] | | -18.0 |
| `stage1_base` | Something in the Streets | loop | 32 | 80.5 s | [0.25, 80.25] | `stage1` | -19.0 |
| `stage1_combat` | (combat stem) | loop | 32 | 80.5 s | [0.25, 80.25] | `stage1` | -19.9 |
| `stage2_base` | Steel Against Scale | loop | 32 | 80.5 s | [0.25, 80.25] | `stage2` | -17.0 |
| `stage2_combat` | (combat stem) | loop | 32 | 80.5 s | [0.25, 80.25] | `stage2` | -20.9 |
| `stage3_base` | Colossus over Port Meridian | loop | 32 | 80.5 s | [0.25, 80.25] | `stage3` | -16.6 |
| `stage3_combat` | (combat stem) | loop | 32 | 80.5 s | [0.25, 80.25] | `stage3` | -20.0 |
| `cocoon` | Chrysalis | one-shot | 4 | 12.5 s | | | -17.1 |
| `intermission` | Redeploy (build) | one-shot | 8 | 23.5 s | | | -16.0 |
| `win_humans` | Port Meridian Stands (fanfare) | one-shot | 5 | 14.5 s | | | -16.0 |
| `win_kaiju` | The City Falls Silent | one-shot | 5 | 14.9 s | | | -16.1 |
| `hearing` | For the Record (somber, bureaucratic) | loop | 12 | 30.5 s | [0.25, 30.25] | | -17.9 |

LUFS is Loudness Units relative to Full Scale (integrated loudness, EBU R128). Full mixes are
mastered to -16. The two beds that sit under speech (`briefing`, `hearing`) are 2 lower on
purpose, and `cocoon` is 1 lower because it plays under the game's heartbeat effect. Stage
stems are mastered as a pair: **base plus combat together** is -16.5 (stage 1), -15.5 (stage 2),
-15.0 (stage 3), so the music really does get a little louder with each stage, and each base
stem alone is 1.5 to 2.5 lower than its pair. The table gives the `.ogg` figures; the `.mp3`
files measure within 0.1 of them.

Total size: about 10 MB of `.ogg` and 10 MB of `.mp3` (the client loads one format).

### Manifest entries

```json
"stage2_base": { "base": "audio/music/stage2_base", "loop": [0.25, 80.25], "bpm": 96,
                 "group": "stage2", "duration": 80.5 }
```

```json
"intermission": { "base": "audio/music/intermission", "bpm": 96, "duration": 23.5, "mark": 20.0 }
```

All six fields are in the contract (`docs/ASSETS.md` section 7). `duration` is the file length
in seconds. One-shots have no `loop`, and that is how the client tells them apart: an entry
without `loop` must never be looped. `mark` is on the two one-shots that are written to land on
a game event: the moment, in seconds from the start of the file, that must coincide with it
(`intermission`: the hit at 20.0, when the next stage begins; `cocoon`: the cut at 10.0, when
the molt blast sounds). Section 4 says how to use it.

## 3. What is in each cue

Every part is written within the real range of the instrument or voice, no third or second is
held below C3, and nothing but octaves and fifths is held below F2 (the build refuses to run
otherwise; clashes that pass in under a beat are allowed).

**`lobby`, The Long Watch.** 32 bars.
Bars 1 to 4, vamp: plucked basses and cellos (D and A, a slow march), field drum, bass drum, a
held D in the cellos with the violas on the fifth above it, sighing up to B flat and back, and
the theme's rhythm as a timpani signal. Bars 5 to 12, the theme low and plain: horns, cellos
and bassoon in unison over the plucked bass, violins holding a high A. Bars 13 to 20, second
strain: violins and clarinet with violas an octave below, string harmony, bowed basses, the drum
swelling back in, trombones and a timpani roll into the return. Bars 21 to 28, the theme tutti:
trumpets, horns, men's voices (joined by the altos for the second half), tremolo violins,
pulsing violas, trombones in open fifths, tuba, timpani, cymbals. Bars 29 to 32, codetta:
clarinet and bassoon echo the head motif and the texture winds down into the vamp.

**`briefing`, Situation Room.** 8 bars over a D pedal, written to stay out of the way of speech:
held basses and cellos, tremolo violas (the same B flat to A sigh), a held violin line and a
very high one, a timpani pulse on beats 1 and 3, soft field drum, and the head motif once on
English horn in bars 5 and 6. In bar 7 the harmony darkens to E flat over the pedal.

**`stage1`, Something in the Streets (the hatchling).** Sparse and nervous. 32 bars.
- *Base:* a stop-and-start cello figure on D with a flat-second twitch (E flat), sparse plucked
  bass, plucked fragments of the head motif passed between violins and violas, tremolo violas,
  a clarinet that tries the tune in bars 9 to 12 and breaks off, a hint of choir (women, "ooh")
  in bars 13 to 16 and 25 to 28, a distant muted trumpet and a bassoon with the head motif in
  bars 17 to 22, and in bars 25 to 28 the first four bars of the theme in cellos and violas. A
  soft snare tic every second bar is the only percussion in the base stem.
- *Combat:* nervous snare (irregular accents, rolls into each eight-bar phrase), rim clicks,
  bass drum, timpani, short stopped stabs from horns and trombones placed where the cello figure
  plays its root, a two-note muted-trumpet alarm, small choir shouts at phrase starts, short
  cymbal crashes with a swell into them.

**`stage2`, Steel Against Scale (the juvenile).** Full and driving. 32 bars.
- *Base:* basses and "galloping" cellos and violas (an eighth and two sixteenths on every beat).
  The bowed basses play in octaves wherever the lower octave is on the instrument (down to C1),
  and half of the section plucks each root an octave below (in unison for F, G, A and B flat, which
  have no lower octave on the instrument); that is where stage 2 gets its weight. Bars 1 to 8 the
  theme in the horns; bars 9 to 16 the theme in violins, flute and oboe while the horns take the
  tenor line and **the choir enters** (women, "ooh"); bars 17 to 24 the second strain sung by
  sopranos and altos with the violins, tenors, basses and horns in harmony, building; bars 25 to
  32 the theme with the choir in octaves, horns, violins and woodwind, trombones and tuba
  underneath.
- *Combat:* snare on the gallop with fills and rolls, bass drum, taiko, timpani on the roots with
  triplet run-ups, crash cymbals with swells at each section, two trumpet parts and trombones
  answering every bar of the theme on beats 3 and 4 ("da-da-DUM", the theme's own cell) plus
  short tutti chords at phrase starts, and choir shouts on the strong bars. In bars 17 to 20,
  where the base stem holds back, the drums hold back too but do not stop: snare, bass drum, a
  soft taiko, timpani on beats 1 and 3 and two trombone stabs a bar.

**`stage3`, Colossus over Port Meridian (the titan).** Enormous. 32 bars. Same tempo, but the
accents fall 3+3+2, so it lurches like something very heavy walking.
- *Base:* bars 1 to 8 the theme, dark: tenors, basses, trombones and horns in unison, women
  holding the harmony, strings in unbroken sixteenths, cellos and basses hammering the roots,
  tuba, organ pedal, tubular bells and a church bell. The organ pedal runs under the whole loop
  with its 16-foot tone (33 to 58 Hz) and the basses double it in octaves: the titan has the
  heaviest bottom of the three stages. Bars 9 to 16 the second strain: sopranos,
  altos, violins and flute, men and horns in harmony. Bars 17 to 24 the first half of the theme
  at half speed as the bass (men's voices, trombones, tuba, basses, organ pedal) under a slow
  rising chorale for the women, horns and tremolo violins, bells every two bars. Bars 25 to 32
  the apotheosis: the whole choir in octaves, trumpets, horns, violins, flute and piccolo, low
  brass in open fifths, a bell on every bar, closing on the flat-second cadence.
- *Combat:* timpani, bass drum, taiko and snare on the 3+3+2 accents, crash cymbals, trombone
  punches on the same accents, trumpet calls (a triplet pickup and a long note) answering the
  tune, choir shouts on beats 1 and 2-and. In bars 9 to 12, where the strain starts quietly, the
  3+3+2 carries on at reduced strength (drums, timpani and soft trombone punches, no trumpets
  or choir), so the stem still says "fight" if it is faded in there.

**`cocoon`, Chrysalis.** One-shot, 4 bars: **exactly 10.0 s of music, then silence and ring-out**.
A choir cluster that slides slowly upward (women on A and B flat, men on D and A, sopranos
adding D and E flat), glassy tremolo violins, the head motif on celesta, and a cymbal swell
into the cut at 10.0 s, which is where the game plays the molt blast.

There is **no heartbeat in the music**, on purpose. The heartbeat players hear during the cocoon
is the game's positional sound effect (`kaiju_heartbeat_loop`): it fades with distance, and
following it is how the humans find the cocoon. Music is not positional. An earlier version of
this cue had its own drum heartbeat, which played at full level for everybody, beat at a
different rate (the music is on a 0.625 s beat, the effect beats every 0.84 s) and buried the
clue. The cue now has no drums, nothing that pulses and nothing below about 120 Hz, which is
where the effect lives.

**`intermission`, Redeploy.** One-shot, 8 bars: **a 20.0 s build, a single hit at exactly
20.0 s, then 3.5 s of ring-out**. Everything stands on the dominant (A in the basses, an
eight-bar timpani roll). The theme's cell climbs one step a bar; cellos and bassoon start, violas
and horns join in bar 3, violins, trombones and a snare roll in bar 5, trumpets and choir in
bar 7. The hit is the D that the next stage starts on.

**`win_humans`, Port Meridian Stands.** One-shot. The head motif in D major on two trumpet
parts, horns and violins; triplet tonguing over B flat and C; a held D major chord with choir,
timpani and snare rolls, cymbals, tubular bells and glockenspiel.

**`win_kaiju`, The City Falls Silent.** One-shot. Head motif for men's voices and trombones,
then the flat-second close with the full choir, horns, tremolo low strings, organ pedal, timpani,
and a tolling church bell.

**`hearing`, For the Record.** 12 bars: the lament bass three times round, plucked, with a dry
harpsichord and a wood-block clock (tock on 1 and 3, tick on 2 and 4). English horn has the tune
first; then bassoon an octave lower with a walking clarinet counter-line; then violas and cellos
in octaves with the English horn above. It stops on the dominant, so the loop restarts cleanly.

## 4. How the client should play it

### Loops

Decode with Web Audio (`decodeAudioData`) and play with an `AudioBufferSourceNode`:

```ts
src.buffer = buffer;
src.loop = true;
src.loopStart = entry.loop[0];   // 0.25
src.loopEnd = entry.loop[1];     // 0.25 + bars * 2.5
src.start(when, 0);              // start from the top of the file, not from loopStart
```

Every loop file is laid out like this:

```
[ lead-in 0.25 s ][ loop body: whole bars ][ pad 0.25 s ]
  ^ 0              ^ loopStart              ^ loopEnd
```

The lead-in is the last quarter second of the loop, faded in; the pad is the first quarter
second of the loop. So the audio is the same on both sides of both loop points, and the jump
from `loopEnd` to `loopStart` is seamless even if a decoder shifts the audio by a few
milliseconds (MP3 decoders differ in how they trim encoder delay). The hall reverb at the end of
the loop is already folded into its beginning, so the loop never sounds "cut". Do not loop the
whole file (`<audio loop>`): that would replay the lead-in and the pad.

### Base and combat stems

For each stage, `stageN_base` and `stageN_combat` have the same length, the same loop points and
the same bar lines.

1. Create both sources with the loop settings above and **start them with the same `when`**.
   Never restart one without the other; they are only aligned if they started together.
2. Give each its own gain node. Base stays at 1. Combat starts at 0.
3. When the fight is on (shots flying, a volley charging, the kaiju attacking units), ramp the
   combat gain to 1 over about 0.6 s (one beat). When it has been quiet for 6 to 8 s, ramp it
   back to 0 over about 4 s. A linear ramp is fine.
4. Both stems at full gain are safe: they were limited **together**, so base alone, combat
   alone, and any mix of the two stay under -1 dBTP (decibels true peak; measured on the encoded
   files, see `MEASUREMENTS.md`). No extra limiter is needed for the music bus.

The combat stem carries the drums, the brass answers and the choir shouts; on its own it sounds
like a percussion track. The base stem on its own is complete music (it has the tune).

### Moving between cues

Tempo and key are shared, so plain crossfades of 1 to 2 s work everywhere. Three places are
written to line up with the game clock:

- **Cocoon (10 s).** Fade the stage stems out over about 1 s and start `cocoon` when the cocoon
  starts. The music stops dead at 10.0 s (`mark`), where the molt blast sound plays. The
  heartbeat is the positional effect and nothing else; the music has none.
- **Intermission.** The hit is at 20.0 s into the file (`mark`). The rule for both cues: if
  the event is `T` seconds away when the file starts, start it at offset `mark - T`. A 20 s
  intermission plays the file from the beginning; the 8 s one (no draft) starts at 12.0, which
  is a half-second pickup, the last three bars of the build and the hit. Work `T` out at the
  moment the source really starts, so that a slow load does not make the hit late. A short
  fade-in is fine (anything up to 0.6 s). Played from the top, an 8 s intermission would be the
  quietest part of the build (-22.6 LUFS) with no hit; from 12.0 it is -13.7 LUFS and ends on
  the hit.
- **Into the next stage.** Start the stage's stems when the hit lands; the hit and the stage's
  first chord are both D. Bring the stems in quickly (0.3 s) and let the intermission ring for
  about 2.5 s instead of cutting it: the ring-out is below -30 dBFS (decibels relative to full
  scale) 1.5 s after the hit. The two together peak at -2.9 dBTP with the base stem (-2.1 in the
  `.mp3`), and at -1.2 dBTP (-0.8 in the `.mp3`, stage 1) if the combat stem is already at full
  level, so they are safe to overlap at the music bus level.
- **Match end.** Cut the stage stems (0.3 s fade) and play `win_humans` or `win_kaiju`. Start the
  `hearing` loop when the hearing screen opens.

One-shots (`cocoon`, `intermission`, `win_humans`, `win_kaiju`) have no `loop` in the manifest
and must never be looped. What the game code still has to change for all of this is listed in
`docs/audio/client-notes-music.md`.

`lobby`, `briefing` and `hearing` are ordinary loops. `briefing` and `hearing` are meant to run
under the voiced lines; they are already 2 LU quieter than the rest and can be ducked a further
4 to 6 dB while someone is speaking.

## 5. How it is made

```
tools/audio/music/
  build.sh              one command: score review, render, master, encode, verify
  build.py              command-line entry (build.sh calls it)
  mbmusic/
    score.py            note notation, parts, MIDI export (96 beats per minute grid)
    orchestra.py        the instruments: soundfont program, real range, seat, mix defaults
    theme.py            the theme, its harmony and voice leading
    patterns.py         accompaniment patterns that follow the harmony
    cues/*.py           one file per cue (stage files hold both stems)
    tuning.py           intonation measurement; tuning_table.json is its committed result
    synth.py            fluidsynth render of each part, with per-note intonation correction
    dsp.py              hall reverb, filters, loop folding, limiter, loudness
    mixdown.py          mix, master, file layout, encode, manifest
    review.py           composer's review of the written score
    analyze.py          verification, spectrograms, MEASUREMENTS.md
```

`build.sh` with no arguments rebuilds everything (about seven minutes from an empty cache, one
to two when only a few parts changed, because rendered parts are cached by content);
`build.sh lobby stage2` rebuilds only those cues; `build.sh --review` prints the score review;
`--no-verify` skips the measurements. `build.py --verify-only` re-measures the files already
built, and `build.py --measure-tuning` re-measures the soundfont's intonation (only needed if
the soundfont changes). Intermediate MIDI and WAV files go to `/tmp/mb-scratch/music` (set
`MB_SCRATCH` to move it), never into the repository. A rebuild from an empty cache produces
byte-identical `.ogg` and `.mp3` files (checked by hash).

1. **Score.** Each cue is Python that writes notes into named parts
   (`part.line(5, "D4:1.5 D4:.5 F4:2 | E4:1.5 D4:.5 C4:2", 92)`: bar 5, pitches with lengths in
   beats, bar-line checks, velocity). The theme, its bass and its three inner voices live in
   `theme.py`; the inner voices move by step and against the bass, so the harmony never doubles
   the bass in parallel.
2. **Score review** (`build.sh --review`, also run before every build, which stops on a finding):
   every note inside the instrument's real range; no thirds or seconds sounding below C3 and
   nothing but octaves and fifths below F2, checked across all parts and both stems of a cue;
   one-shots not running past their end. It also prints who plays in which bar and how loud,
   and lists every minor second held between two parts for a beat or more, so that each one is
   a decision (the only ones left are the cocoon's deliberate clusters).
3. **Render.** Each part is rendered on its own with fluidsynth and `FluidR3_GM.sf2`, no synth
   effects. Two things are done to the samples:
   - *Intonation.* The soundfont is not in tune with itself: measured against equal temperament
     the choir is 20 to 48 cents flat in the men's register, the timpani 38 cents sharp from G2
     up, the plucked strings jump 40 cents between neighbouring keys. `tuning.py` measures every
     key of every patch once; the synth then retunes each note (within a cent). Without this the
     unison and octave statements of the theme are sour.
   - *Marcato.* The string, horn and choir samples swell in slowly, which smears fast figures.
     The "marcato" and "shout" instruments start each sample a few thousand samples in, with a
     short clean fade, so gallops, sixteenths and choir shouts speak on time.
4. **Mix.** Per part: level, high-pass under the instrument, a little high-shelf lift for the
   dull sampled strings, voices and brass, a seat in the stereo picture (violins left, low
   strings and low brass right of centre, basses near the middle), and a send to one shared hall.
   Bass parts can also take a low shelf (`sub`, corner at 80 Hz), because the samples are thin at
   the very bottom: measured note by note, the bowed basses have no fundamental below A1 (55 Hz;
   the octave above it sounds instead) and the organ's fundamental is 5 to 9 dB under its own
   octave. The stage 3 organ pedal gets 21 dB of shelf, which stands in for the 16-foot stop the
   sample lacks; the basses of stages 2 and 3 get 4 dB. The hall is a synthetic impulse response
   (decay 2.6 s at 500 Hz, 1.5 s at 8 kHz, 22 ms pre-delay) kept out of the bass.
5. **Loop folding.** A loop is rendered once with its whole ring-out; everything that rings past
   the last bar is added back onto the start. Because everything up to here is linear, the result
   is exactly the music playing forever, and the loop start equals what follows the loop end
   sample for sample (verified: the difference in the master is zero).
6. **Master.** One gain per cue to reach the loudness target, then a look-ahead limiter with a
   ceiling of -1.5 dB. For a stage, one gain curve is computed from base, combat and their sum
   together and applied to both, which is what makes every fade position safe. The limiter barely
   works: at most 1.5 dB of reduction, on under 5% of the samples, in any cue (stage 2: 1.2 dB on
   0.5%; stage 3: 0.1 dB; the cocoon: none).
7. **Encode.** ffmpeg, Vorbis quality 4 and MP3 variable bit rate quality 5 (both about
   115 kbit/s for this material), with bit-exact flags so a rebuild gives identical files.

## 6. Verification

Nobody listened to this: it was verified by measurement and by looking at pictures. The numbers
are in `docs/audio/music/MEASUREMENTS.md` (regenerated by every build) and `measurements.json`.

- **Decodes, right length.** All 26 files decode; every decoded length matches the score to the
  sample (0.00 ms error), and decoded audio lines up with the master at offset 0 in both formats.
- **Not silent, not clipped.** True peak of every file is between -5.4 and -1.3 dBTP, and the
  loudest 0.4 s of every file is above -19 dBFS.
- **Loudness.** Full mixes -16.0 to -16.1 LUFS; beds -18.0 and -17.9; cocoon -17.1; stage pairs
  -16.5, -15.6, -15.0 (base alone -19.0, -17.0, -16.6).
- **Stems sum without clipping.** Base plus combat, decoded and added at full level: true peak
  -1.1 to -1.5 dBTP in both formats.
- **Loops are continuous.** In the master the loop is exactly periodic. In the encoded files the
  200 ms around the loop end repeat the 200 ms around the loop start as closely as the codec
  allows (within about 3 dB of the codec's own error), the sample step across the splice is
  ordinary (0.01 to 1.5 times the 99th percentile of the steps around it; a click would be many
  times that), and the jump adds no onset energy (within 0.5 dB of playing straight through).
  Pictures: `docs/audio/music/<id>_seam_ogg.png` and `_seam_mp3.png` show the last 2 s before the
  loop end followed by the first 2 s after the loop start, with a 20 ms waveform across the
  splice.
- **Structure.** `docs/audio/music/<id>.png` (and `stageN_sum.png` for the pairs) are
  spectrograms with the sections marked; the bar-by-bar loudness table in `MEASUREMENTS.md` shows
  each build (for example the lobby goes -21, -18, -18 rising to -14, -13 for the tutti, back to
  -21).
- **Beat grid.** The strongest onsets of every loop sit within 16 ms (median) of the
  sixteenth-note grid counted from the loop start; most of that is instrument attack time.
- **Stereo and mono.** Left and right are within 1.5 dB of each other in every file; summing to
  mono loses 1 to 2.5 dB of loudness (no cancellation).
- **Intonation.** After correction, spot checks of choir, strings, timpani, plucked strings,
  horns and woodwind are within 1 cent of equal temperament (they were up to 48 cents out).
- **Repeatable.** Two builds from an empty cache gave byte-identical files. After the review
  changes below, a rebuild of all thirteen cues left the sixteen files of the eight untouched
  stems bit for bit as they were.

### After the sound review

An independent review measured every file and asked for four changes. Each was made in the
score and proved on the rebuilt files (all figures from the `.ogg`; the `.mp3` agrees within
0.1 dB).

- **Weight at the bottom grows with the stage.** Before, the biggest stage was the lightest
  down there. Level in two low bands over the whole file, in dBFS (the reviewer's yardstick:
  mono sum, fourth-order band-pass):

  | | 30 to 60 Hz before | now | 60 to 120 Hz before | now |
  | --- | ---: | ---: | ---: | ---: |
  | `stage1_base` | -32.6 | -32.6 | -28.7 | -28.7 |
  | `stage2_base` | -43.6 | -31.1 | -32.1 | -27.5 |
  | `stage3_base` | -44.6 | -29.9 | -32.4 | -25.8 |
  | stage 1 pair | -30.9 | -30.9 | -26.5 | -26.5 |
  | stage 2 pair | -37.1 | -30.4 | -27.9 | -26.0 |
  | stage 3 pair | -35.8 | -29.1 | -26.4 | -23.8 |

  The review's target for `stage3_base` was -32 or higher and -27 or higher. Stage 1 gets its
  figure from eight bars of loud plucked bass and is nearly empty down there the rest of the
  time (a typical bar is at -44 in the 30 to 60 Hz band); stages 2 and 3 are now steady (a
  typical bar at -31 and -30, quietest bar -36 and -32). In the pictures the bottom of
  `stage3_base.png` is one continuous dark band where it used to be blank.
- **The cocoon has no heartbeat of its own.** Below 120 Hz the music is at -48.6 dBFS (it was
  -25.6, with eleven drum pulses at -21 to -15); the 30 to 60 Hz band is at -85 (was -30) and
  the 60 to 120 Hz band at -64 (was -27). The game's heartbeat effect beats at -15 dBFS in that
  range, so the music leaves it alone. The rest of the cue is as loud as it was, within 0.1 dB
  (the cue as a whole is 1 LU lower because the drums are gone), and it still swells into the
  cut: second by second -28, -23, -20, -20, -19, -19, -18, -17, -15, -12, then the cut.
- **The combat stems never drop out.** Bar by bar the combat stems now read -25 to -26 in bars
  17 to 20 of stage 2 (they were -28 to -31) and -24 to -25 in bars 9 to 12 of stage 3 (they
  were -27 to -30), against -18 to -24 everywhere else.
- **The intermission in 8 seconds.** Nothing in the file changed; the manifest now says where
  the hit is (`mark`). Cut from the file as the game should play it: from 0.0 s an 8 s
  intermission is -22.6 LUFS with no hit; from 12.0 s it is -13.7 LUFS, rising second by second
  from -18 to -12, and the hit lands as the stage begins. Followed by the first bar of the next
  stage with the fades recommended in section 4, the overlap peaks at -2.9 dBTP with the base
  stem (-2.1 in the `.mp3`); with the combat stem at full level as well, at -1.2 dBTP (-0.8 in
  the `.mp3`, stage 1; stages 2 and 3 at -1.3 to -2.0).

## 7. Known weaknesses

- It is a 2008 General MIDI soundfont. The strings and choir are recognisably sampled, the
  choir can only sing "aah" and "ooh", there are no true legato transitions, and drum rolls are
  written out as single strokes, which can sound mechanical when exposed (the lobby vamp, the
  intermission).
- Balance was set from loudness tables per part and section and from spectra, not by ear. A
  listening pass by a person may want a few decibels here and there; the gains are one number
  per part in `cues/*.py`.
- The orchestra is dark above 5 kHz (the samples have little there); the percussion carries the
  top end, so the base stems sound mellower than the combat stems.
- A loop's first pass already contains the reverb tail of "the previous pass" at its very start,
  and the file begins with a quarter-second fade-in before the first downbeat. Both are by
  design (they are what makes the loop seamless) but they are audible on the first play if you
  listen for them.
- The bottom octave of stages 2 and 3 (33 to 58 Hz: the organ pedal's 16-foot tone, the plucked
  basses) needs speakers or headphones that go that low. On small speakers the weight comes from
  the octave above (65 to 120 Hz: basses in octaves, tuba, the organ's own octave), which was
  raised too, but a laptop will not show the difference between the stages the way a
  subwoofer does.
- The organ's 16-foot tone is an equaliser shelf on a sample whose fundamental is weak, not a
  recording of big pipes. It measures right and looks right in the spectrogram; whether it
  sounds like an organ or like a hum under the orchestra is for a listener to say. It is one
  number (`sub`) on one part in `cues/stage3.py`.
- The bass is now a larger share of the stage 2 and stage 3 base stems, so at the same loudness
  everything else in them sits a little lower than before: 0.4 dB in stage 2, 0.7 dB in stage 3
  (measured above 500 Hz, where nothing was changed).
