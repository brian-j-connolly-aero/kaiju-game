# Voice: what the client has to change

For the client engineer. The audio review (an independent quality pass that measured every sound
file and read the script against the game code) found nothing wrong with the voice files, but
three things about how the game plays them. The voice side is done: the script was reworked, all
221 lines were rebuilt and measured, and the manifest is merged. This page lists what is left in
`client/src`, which the voice worker does not own.

Line numbers are those of commit `2f69ae5`; `client/src` has not changed since. Background on the
files is in `docs/audio/VOICE.md` (section 3 is "For the client"); the words are in
`docs/VOICE_SCRIPT.md`.

## At a glance

| # | Change | Where | Status |
| --- | --- | --- | --- |
| 1 | Radio squelch once per line, and only on radio lines | `audioEngine.ts:557` to `:587`, `matchAudio.ts:108` | **needed** (the review's only "must") |
| 2 | The committee chair speaks over the `hearing` music, and is never dropped | `matchAudio.ts:106` to `:130`, `end.ts:121` to `:125` | **needed** (review finding) |
| 3 | Orders for a window that is closing: load ahead, jump the queue, go stale fast | `audioEngine.ts:42`, `:519`, `:542`, `matchAudio.ts:77`, `:109` | recommended (the script half of the finding is done) |
| 4 | New and reworded lines, shorter briefing, smaller files | nothing | information |

Nothing here needs another audio build.

## 1. Radio squelch: once per line, and only on radio lines

**The problem.** Every radio line already has its squelch in the file: a key click and a 55 ms
burst of static before the first word, and a 95 ms squelch tail and a click after the last
(measured on all radio lines: the click at the start peaks 9 dB, decibels, below the loudest
speech peak; the first word starts 0.09 s into the file and the file ends 0.16 s after the last
word). The engine adds the two effects `radio_open` (0.15 s) and `radio_close` (0.24 s) around
the same file:

```ts
// client/src/audio/audioEngine.ts
557    const finish = (seconds: number): void => {
558      setTimeout(() => {
559        if (token !== this.voiceToken) return;
560        if (q.radio) this.play('radio_close', { gain: 0.5 });
561        this.nextLine();
562      }, seconds * 1000 + 150);
563    };
...
566    if (q.radio) this.play('radio_open', { gain: 0.5 });
```

So a radio line starts with two clicks on top of each other and ends with its own squelch tail,
0.15 s of nothing, and then a second, longer one. And `radio` is decided by who is listening,
not by who is speaking:

```ts
// client/src/audio/matchAudio.ts
107    const side = this.side();
108    const radio = side === 'humans';
```

so on the human side the committee chair, who speaks in a large reverberant room, is wrapped in
walkie-talkie squelch as well.

**What to change.**

1. `audioEngine.ts`, `nextLine` (`:538` to `:589`): play the two effects only where the line has
   no audio of its own, which is the two fallback paths (`:567` to `:572`: no manifest entry or
   sound not running; `:576` to `:580`: the file failed to load). With real audio, play neither.

   ```ts
   const finish = (seconds: number, squelch: boolean): void => {
     setTimeout(() => {
       if (token !== this.voiceToken) return;
       if (squelch) this.play('radio_close', { gain: 0.5 });
       this.nextLine();
     }, seconds * 1000 + 150);
   };
   const standIn = (): void => {            // subtitle with blips: the only place the squelch effects belong
     if (q.radio) this.play('radio_open', { gain: 0.5 });
     this.onSubtitle?.(q.line, estimate);
     this.blips(q.line, estimate);
     finish(estimate, q.radio);
   };
   // delete line 566
   // :567 to :572 and :576 to :580 become `standIn(); return;`
   // :587 becomes `finish(buffer.duration, false);`
   ```

2. `matchAudio.ts`, `speak` (`:106` to `:130`): decide per line. The lines with audience
   `humans` are the radio lines (Overlord, Granite, Beacon, Tempest); the anchor's are `kaiju`
   and the chair's are `all`. The voice build enforces that pairing
   (`tools/audio/voice/mbvoice/scriptcheck.py`, `CAST`), so the audience is a safe test and keeps
   working when new squad voices are added:

   ```ts
   const isRadio = (line: VoiceLine): boolean => line.audience === 'humans';
   // :119   this.audio.say(line, { priority: ..., radio: isRadio(line) });
   // :124 and :129 the same; delete line 108
   ```

3. The comment on `VoiceOptions.radio` (`audioEngine.ts:45`) should say what it now means: a
   radio line without audio gets a squelch around its blips; recorded radio lines carry their own.

`radio_open` and `radio_close` stay in `PRELOAD_SFX` (`matchAudio.ts:53`, `:54`) for the fallback.

**How to check.**

- A test that spies on `AudioEngine.play`: a line whose file loads causes no call with
  `radio_open` or `radio_close`; a line with no manifest entry and `radio: true` causes one of
  each; a line with `radio: false` causes none in either case. And for `MatchAudio.speak`: on
  the human side, a `hearing.humans.win` event queues its line with `radio: false`, a
  `volley.fired` event with `radio: true`.
- By ear, as a human player: one click before a line and one short hiss after it. Two clicks, or
  a hiss, a gap and another hiss, means the effects are still being added. On the end screen the
  chair's line has no click and no hiss at all.

## 2. The end screen: the chair speaks over the hearing music

**The problem.** At the end of a match the simulation sends two cues in the same tick
(`shared/src/sim/systems/voice.ts:119` to `:127`): the ending (`end.*`: Overlord or the anchor,
2.0 to 4.7 s) and the hearing (`hearing.*`: the chair, 6.6 to 8.6 s). `speak` queues both at once
with priority 2 (`matchAudio.ts:109`, `:119`). So today:

| Seconds after the match ends | What plays |
| --- | --- |
| 0 | `win_humans` or `win_kaiju` starts (`matchAudio.ts:273`); the ending line starts |
| 2.2 to 4.9 | the chair's line starts, over the fanfare at its loudest |
| 8.8 to 13.5 | the chair has finished |
| 14 | `hearing` starts (`end.ts:122`, `:124`): the bed written to sit under the chair, with nobody speaking |

And the chair can be lost altogether: a queued line with priority below 3 is dropped once it
has waited 7 s (`VOICE_STALE_SECONDS`, `audioEngine.ts:53`, tested on `:542`). If a line was
still playing when the match ended, the chair waits for the rest of it and for the ending line,
which can come to more than 7 s (up to 5 s plus 4.7 s).

**What to change.**

1. `matchAudio.ts`: do not queue a hearing line when its cue arrives. Keep it for the end screen.

   ```ts
   private hearing: VoiceLine | null = null;          // beside `heartbeat` (:66); set to null in end() (:83)

   // at the top of speak(), after `side` is known:
   if (e.cue.startsWith('hearing.')) {
     const id = (e as { lines?: Partial<Record<'humans' | 'kaiju', string[]>> }).lines?.[side]?.[0];
     this.hearing = (id ? lineById(id) : undefined) ?? pickVoiceLine(e.cue, side, e.variant) ?? null;
     return;
   }

   /** The committee chair's line for this match; the end screen takes it when the hearing music is on. */
   takeHearing(): VoiceLine | null {
     const line = this.hearing;
     this.hearing = null;
     return line;
   }
   ```

   `urgent` on `:109` then no longer needs `e.cue.startsWith('hearing.')`.

2. `end.ts`, `frame` (`:121` to `:125`): start the music when the fanfare has rung out, and the
   chair one bar later. `this.time` counts from the moment the screen opens, which is the moment
   the match ends (`app.ts:191`).

   ```ts
   const HEARING_MUSIC_AT = 12.5;   // s: both win cues are below -30 dBFS from 12.2 s (client-notes-music.md)
   const CHAIR_AT = 15.0;           // s: one bar of the hearing bed later (2.5 s at 96 beats per minute)

   private chairSaid = false;       // reset in enter() (:44 to :46)

   // replaces :121 to :125
   if (this.time > HEARING_MUSIC_AT && ctx.audio.music !== 'hearing') ctx.audio.playMusic(['hearing']);
   if (this.time > CHAIR_AT && !this.chairSaid) {
     this.chairSaid = true;
     const line = runtime.matchAudio.takeHearing();
     if (line) ctx.audio.say(line, { priority: 3 });       // 3: never dropped as stale; not a radio line
   }
   ```

   (dBFS is decibels relative to full scale.) Do not start `hearing` earlier under `win_humans`:
   the fanfare is in D major and the bed in D minor (`client-notes-music.md`, "Related: the end
   screen").

3. Optional: a player who arrives on the end screen without having received the voice event (a
   reconnect) gets `null` from `takeHearing()`. To give them a line anyway:
   `chooseVoiceLines(result.winner === 'kaiju' ? 'hearing.kaiju.win' : 'hearing.humans.win', 'humans', 0)[0]`
   (the hearing lines are for everyone, so the side does not matter).

4. The ending lines themselves (`end.*`) should also be queued with priority 3 instead of 2:
   they are the last word on the match and must not be dropped because the radio was busy.

**The result.**

| Seconds after the match ends | What plays |
| --- | --- |
| 0 | win cue; the ending line (2.0 to 4.7 s) |
| 12.5 | `hearing` starts: plucked bass, harpsichord and a wood-block clock |
| 15.0 | the chair's line starts, as the English horn carries the tune |
| 21.6 to 23.6 | the chair has finished; the room rings for 1.3 s inside the file; the music loops on |

**How to check.**

- A test of `MatchAudio`: after a `voice` event with cue `hearing.humans.win`, `AudioEngine.say`
  was not called and `takeHearing()` returns that line once, then `null`.
- A test of `EndScreen.frame` with a fake clock: `playMusic(['hearing'])` is called once when
  `time` passes 12.5, `say` once when it passes 15.0 with `priority: 3` and no `radio`.
- By ear: the fanfare plays out with the ending line over its first seconds; then the quiet
  clock-and-harpsichord music; then the chair, clearly, over it. The subtitle of the chair's
  line (up to 17 words) shows for the length of the file plus 0.3 s (`audioEngine.ts:586`).

## 3. Orders that announce a closing window

**What the finding was.** Three of the humans' lines outlasted the moment they announce: the
stagger lasts 5 s (`staggerDuration`, `shared/src/defs/rules.ts:73`) and the old Overlord line
for it took 5.07 s and ended on "All squads, fire"; the signature attack lands 0.8 s after its
cue and lasts 3 s, and the old line for it took 4.4 s and ended on "get clear".

**What the script now does.** Every line the humans hear for `nerve.break` (8 lines) and
`kaiju.special` (4 lines) puts the order first and takes 2.0 to 2.5 s as built; the voice build
fails if one is longer than 2.5 s. Examples: "Weak point is open. Fire." (2.3 s), "Shoot the
glowing spot. Now." (2.1 s), "Get clear. It is charging." (2.3 s).

**What is left for the client.** A short line still arrives late if it has to wait. Two waits
exist today:

- **Behind another line.** Lines play one at a time. `nerve.break` is queued with priority 2
  and plays next, but only after the line that is playing (up to 5 s). `kaiju.special` is queued
  with priority 1 (`matchAudio.ts:109`: it is not in `urgent`), so other chatter can go first.
  Either one is dropped only after 7 s (`audioEngine.ts:53`), by which time the window has shut;
  a line that starts 3 s into a 5 s stagger tells the squad to fire as the weak point closes.
- **For its file.** A voice file is fetched and decoded the first time it is spoken
  (`audioEngine.ts:574`). On a tunnelled connection that is a noticeable fraction of a second,
  once per line.

Recommended changes:

1. **Load ahead.** A method next to `preload` (`audioEngine.ts:223`):

   ```ts
   preloadVoice(ids: string[]): void {
     if (!this.ctx) return;
     for (const id of ids) {
       const entry = this.assets.manifest.voice[id];
       if (entry) void this.load(entry.base);
     }
   }
   ```

   and in `MatchAudio.begin` (`matchAudio.ts:77`), for the side the player is on:

   ```ts
   const AHEAD: readonly VoiceCueId[] = ['match.briefing', 'match.start', 'nerve.break', 'kaiju.special'];
   const side = this.side();
   this.audio.preloadVoice(VOICE_LINES.filter((l) => l.audience === side && AHEAD.includes(l.cue)).map((l) => l.id));
   ```

   That is 17 files for a human (about 0.4 MB, megabytes, to fetch) and 12 for the kaiju player.

2. **Go stale fast.** Give `VoiceOptions` (`audioEngine.ts:42`) a `staleAfter?: number` in
   seconds, store it on the queued line (default: `Infinity` for priority 3 and above, otherwise
   `VOICE_STALE_SECONDS`), and test it on `:542` in place of `next.priority < 3`:

   ```ts
   while (next && now - next.queuedAt > next.staleAfter) next = this.voiceQueue.shift();
   ```

3. **Jump the queue.** In `speak` (`matchAudio.ts:106`):

   ```ts
   const order = side === 'humans' && (e.cue === 'nerve.break' || e.cue === 'kaiju.special');
   // priority: many ? 3 : order ? 2.5 : urgent ? 2 : 1
   // staleAfter: order ? 1.5 : undefined
   ```

   1.5 s: an order of 2.5 s that starts 1.5 s late still ends inside both windows (4.0 s of the
   5 s stagger; 4.0 s against 3.8 s of the signature attack, whose order is in the first second
   of the line). Later than that, the sting and the picture have already told the player, and
   silence is better than a late order.

4. **Optional: break in.** With changes 2 and 3 an order that finds the radio busy for more than
   1.5 s is dropped. The radio is busy a good part of the time in a firefight (about 14 cues a
   minute, `docs/DESIGN.md` section 8), so a rough estimate is that one order in five would be
   lost that way. A real radio net handles this by letting urgent traffic cut in. To do the same:
   keep the playing line's source and give it its own gain node; when an order is queued while a
   line of priority 1 or lower is playing, fade that line out over 60 ms, stop it, play
   `radio_close` (gain 0.5) if it was a radio line, since its own squelch tail has just been cut
   off, and start the order. Never cut a line of priority 2 or 3.

**How to check.**

- Tests of the queue: with a line playing, an order queued now and started within 1.5 s is
  played before an older priority-2 line; an order that has waited 1.6 s when the queue comes
  round is skipped; a priority-3 line that has waited 30 s is still played.
- In a bot match as a human, log for each `nerve.break` voice event the time from the event to
  `src.start` (`audioEngine.ts:585`). It should be under 0.3 s when the radio was free and never
  over 1.5 s; before these changes it is up to 5 s plus the fetch.

## 4. What changed in the files (no client work)

- **221 lines** (181 before). The 40 new ones give every radio voice enough lines of its own:
  the game only ever uses a squad's own lines for a cue about that squad, and Overlord's for the
  fourth squad, so variety has to exist per voice (`docs/VOICE_SCRIPT.md`, "Line counts"). The
  simulation picks from whatever the script holds, so they need no wiring. New lines have the
  next free number of their cue; no existing id was renamed or removed.
- **16 lines were reworded** under their old ids: `v_match_briefing_1`, `v_match_briefing_3`,
  `v_volley_ready_2`, `v_crossfire_4`, `v_nerve_break_1` to `_4`, `v_kaiju_brace_2`,
  `v_kaiju_special_1` to `_3`, `v_collateral_human_1`, `v_unit_lost_3`, `v_squad_wiped_2`,
  `v_player_takeover_2`. Subtitles come from the script, so they follow by themselves.
- **`v_squad_wiped_2` is now Overlord's** (it was Granite's, who could only say it about
  itself). No squad voice has a line for `squad.wiped` any more.
- **The briefing is shorter.** The humans' three lines add up to 9.0 s (10.6 s before), the
  kaiju player's to 8.6 s. With the 0.15 s the engine leaves between lines (`audioEngine.ts:562`)
  they end 9.3 s and 8.9 s after the first one starts, inside the 10 s briefing
  (`MATCH_RULES.briefing`, `rules.ts:24`). Keep that gap as it is.
- **Durations** in `manifest.json` are those of the new files; anything that times subtitles or
  queues by them needs no change.
- **Smaller files.** Encoded one step lower (Vorbis quality 2, MP3 quality 6); a line is about
  25 kB (kilobytes) on average. Loudness is unchanged: every line is at -16 LUFS (loudness units
  relative to full scale), within 0.3.
- **Bus levels and ducking were not touched.** For reference: while a line plays, music is
  lowered to 0.4 and effects to 0.65 (`DUCK_MUSIC`, `DUCK_SFX`, `audioEngine.ts:54`, `:55`).
