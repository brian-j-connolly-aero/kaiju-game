"""The hand-written parts of docs/audio/VOICE.md. The tables come from docgen.py."""

INTRO = """\
Every spoken line in the game as a finished sound file: **{lines} lines, {speakers} voices,
{total_s:.0f} seconds of audio**, each as `.ogg` (Vorbis) and `.mp3`
({ogg_mb:.1f} MB and {mp3_mb:.1f} MB in total). The words come from the script,
`shared/src/defs/voiceLines.json` (readable copy: `docs/VOICE_SCRIPT.md`); this page is about how
they are spoken, processed and checked.

- Sound files: `client/public/assets/audio/voice/<lineId>.ogg` and `.mp3`
- Manifest: `client/public/assets/manifest.voice.json` (section `voice`, with each line's length)
- Generator: `tools/audio/voice/` (`build.sh` rebuilds only what changed)
- Numbers behind this page: `docs/audio/voice/measurements.json`, `audition.json`, `experiments.json`

The voices are made by free speech synthesizers that run on the build machine with no network.
**Natural-sounding neural voices were not available on this machine**, so every voice here is
recognizably synthetic: clear, steady and humorless, which suits the deadpan tone, but nobody
will mistake it for an actor. Section 8 explains how to swap in a better synthesizer later; it
is one function.

Nobody listened to these files while they were made (the build machine has no ears). Every
decision below was taken from measurements: a speech recognizer transcribes each clip and the
words it gets wrong are counted, and loudness, peaks, bandwidth, timing and spectrograms are
checked. The last build finished with **{failures} failed checks**. A human listening pass is
still worth doing; section 7 says what to listen for.
"""

CAST_NOTES = """\
"Pitch" is the middle (median) pitch of the voice measured on the unprocessed synthesizer output
of that character's lines; "pace" is words per second from first word to last, pauses included.
The three squad voices and Overlord share one radio channel, so they are spread out on purpose:
four different recorded speakers, the squads pitched roughly 105, 140 and 185 Hz, and Overlord the
lowest (about 92 Hz) and the slowest. Overlord and Granite are the closest pair: two low American
men, two and a half semitones apart, told apart mainly by pace (Granite is the quickest voice on
the channel, Overlord the slowest) and by Overlord's cleaner, wider radio.

Why these voices:

- **Overlord** is RHVoice `bdl`, the most intelligible voice on the machine by a wide margin, and
  the only one that stays clear on the radio almost whatever is done to it. Slowed to 85% speed
  and lowered to 72% pitch it loses nothing measurable, so the gravity is free. Command also gets
  the cleanest radio (wider band, less drive, less static): it is the base station, the squads
  are in the field.
- **Granite** is Flite `rms`, the deepest natural voice available: a different man from Overlord
  with a rougher sound, spoken 6% faster than the engine's default for a clipped delivery.
  Lowering it further with a pitch shifter was tried and rejected: two semitones down tripled
  the error rate.
- **Beacon** is RHVoice `clb`, a precise female voice. It is the slowest voice at its default
  speed, so it is sped up to keep the by-the-book reports brisk.
- **Tempest** is RHVoice `alan`, a male voice with a Scottish accent, noticeably higher than
  Granite and Overlord. The recognizer was trained on American speech and marks the accent down
  on every chain, so Tempest's lines are written around it: the accent loses "fire", "hurt" and
  "count", and the lines now avoid those words where they can (section 7). The other candidates
  were worse (Flite `awb` is the same speaker in a rougher synthesizer, Pico falls apart on the
  radio) or already in use.
- **Anchor** is RHVoice `slt`, a female voice with the widest frequency range on the machine
  (up to 12 kHz), which is what a clean broadcast voice needs, slowed a little for composure.
  Pico was the expected choice for the anchor and lost on the numbers: about two and a half
  times the word errors.
- **Chair** is Pico `en-US`, the one speaker not already on the radio or the news, so the hearing
  does not sound like Overlord or the anchor reading the verdict. It is slowed to 90%, lowered to
  90% pitch with Pico's own control, and then moved down three more semitones together with its
  resonances (a larger body, not just a lower note), which lands it at about 130 Hz: a low,
  unhurried voice of no obvious age. Of all the ways of lowering Pico that were tried this was
  the clearest (second-round table below), about level with RHVoice `alan` slowed and lowered,
  which is Tempest's speaker and so not available.

Several voices on this machine are the same recorded person inside different synthesizers
(`slt` exists in RHVoice, Flite and Festival; RHVoice `alan` and Flite `awb` are one speaker), so
there are six usable speakers, not sixteen. All six are in use, one per character.
"""

AUDITION_INTRO = """\
Each voice spoke all the lines at its default settings; the recognizer's transcript was compared
with the subtitle text. Lower is better. The recognizer's own floor on this script is about 6%
(it never gets "volley" and often swaps "a" for "the", whoever is speaking).
"""

AUDITION_REMARKS = {
    "rhvoice bdl": "Cast: Overlord",
    "rhvoice clb": "Cast: Beacon",
    "flite rms": "Cast: Granite",
    "rhvoice slt": "Cast: Anchor",
    "rhvoice alan": "Cast: Tempest",
    "pico en-US": "Cast: Chair (lowered and slowed)",
    "flite kal16": "Robotic (older technique); not needed",
    "festival slt (hts)": "Same speaker as RHVoice `slt`, less clear",
    "flite awb": "Same speaker as RHVoice `alan`, less clear",
    "flite slt": "Same speaker as RHVoice `slt`, less clear",
    "pico en-GB": "British accent the recognizer cannot follow; pleasant but unverifiable",
    "rhvoice evgeniy-eng": "Heavy accent; half the words lost",
    "espeak en-us": "Robotic; the recognizer loses nine words in ten",
    "espeak en-gb": "Robotic; as above",
    "espeak en-gb-x-rp": "Robotic; as above",
    "espeak en-gb-scotland": "Robotic; as above",
}

ESPEAK_VARIANTS = """\
eSpeak NG also ships {n} voice variants (male, female, whisper, croak and so on). All of them were
auditioned on a sample of {lines} lines. None is usable: the median variant loses {median:.0f}% of the
words. Best: {best}. Worst: {worst}. eSpeak's buzzy formant sound is very clear to people who are
used to it and nearly opaque to this recognizer, so these numbers overstate how bad it is, but no
variant came close to the voices that were cast.
"""

EXPERIMENTS_INTRO = """\
Before settling the chains, candidate voice settings were run through a first version of each
chain (radio with 7 dB of overdrive and an unducked static bed at -30 dB; hall with reverberation
at -12 dB and early reflections at -9 dB). The first-pass chains were harsher than the final ones,
so the "through the chain" numbers here are worse than the finished lines in section 4; what
matters in these tables is the order of the candidates. (The experiments were also scored before
the recognizer was made to forget each clip before the next, which moves a result by a word or
two depending on the order of the run; and the chain code has been refined since. Re-running
them reproduces the ranking, not every decimal. All the experiments in this section and the
sweeps in section 2 were run on the first version of the script, 181 lines of which 93 were
military; the script has grown since, so the line counts in the table headings are those of
that version.)
"""

CHAINS_INTRO = """\
All chains work at 44.1 kHz. Before its chain, every line is trimmed of leading and trailing
silence and its pauses between sentences are brought within the limits in the table at the end of
this section (synthesizers leave anything from 0.2 to 0.7 s). After its chain, every line is set
to **{target} LUFS** (Loudness Units relative to Full Scale: the broadcast measure of how loud
something sounds, integrated over the clip with silence gated out) and peak-limited to
{ceiling} dBTP (decibels true peak) so that lossy encoding cannot clip. That is the same loudness
as the full music mixes, so voice sits level with the music and the client should duck the music
under speech (section 3).
"""

CHAIN_TEXT = {
    "radio": """\
What a field radio does to a voice, in this order: band-pass (the corners are `band_hz`), a small
resonant peak where a handset speaker honks, a fast compressor with look-ahead (the automatic
gain control of the set), a soft clipper for light overdrive, and the band-pass again. Under it
lies a static bed (hiss with slow flutter and sparse crackle) that drops while a word is spoken
and comes back in the gaps, the way a receiver's noise does. At the start a key click and a
55 ms falling burst of static; at the end a 95 ms squelch tail that is cut off, and the key click.
Static and squelch pass through the same band-pass as the voice. Mono.
""",
    "broadcast": """\
A news studio microphone: low rumble removed, a little warmth, presence and air, gentle
compression, and a faint studio tone under everything (air-conditioning rumble, a trace of hiss
and mains hum, 44 dB below the voice) so the anchor does not speak out of dead digital silence.
Mono.
""",
    "hall": """\
A large hearing room, built as an impulse response: twelve early reflections from walls, floor
and ceiling over the first 110 ms, then a diffuse tail that takes `rt60_s` seconds to die away
(faster in the treble). The reverberation is turned down while a word is being spoken and comes
up in the pauses and after the last word, which is how film dialogue keeps its words in a big
room. The room rings for `ring_s` seconds after the last word. Stereo: the voice is in the
middle, the room is wide.
""",
}

SWEEPS_INTRO = """\
One setting changed at a time, measured on real lines (word error rate of the finished clip;
"unprocessed" is the same lines straight from the synthesizer). The recognizer is much less
tolerant of noise, distortion and reverberation than a person, so these sweeps err on the side of
clarity. Differences of two or three points are within the noise of the measurement.
"""

SWEEPS_AFTER = """\
What the sweeps decided:

- **Overdrive is the most expensive radio ingredient.** 12 dB of drive doubles the errors; 3 dB
  costs almost nothing and still rounds the peaks. The default is 3 dB ("light").
- **Static under the words costs a lot, static between the words costs less.** So the bed drops
  14 dB while a word is spoken and comes back in the gaps, where it is heard as radio hiss. A last
  check on all 54 squad lines put the bed in the gaps at -34 dB instead of -30 dB (16.7% against
  19.5% word errors), which is the default; Overlord's is at -38 dB.
- **A slightly wider band helps every voice.** 300 Hz to 3.8 kHz instead of 330 Hz to 3.3 kHz; it
  is still plainly a radio.
- **The compressor and the presence peak help** (removing either made things worse), so both stay.
- **Reverberation on top of the words is what hurts in the hall,** above all the early
  reflections. With the early reflections at -18 dB and the tail held 12 dB down while the chair
  speaks, the room costs a few points instead of twenty-five, and the tail after the last word is
  as long and as loud as in the first version.
"""

CLIENT = """\
What the game code has to do with these files. The exact changes that were still open after the
audio review, with file names, line numbers and numbers to use, are in
`docs/audio/client-notes-voice.md`.

- **Files and manifest.** `manifest.voice.json` has one entry per line id:
  `{{ "base": "audio/voice/<lineId>", "duration": seconds }}`. `duration` is the length of the whole
  file including squelch or reverb tail (the `.mp3` can be up to 0.05 s longer because of frame
  padding). Use it to time subtitles and to queue lines.
- **Do not add `radio_open` / `radio_close` around these files.** The radio lines already begin
  with a key click and end with a squelch tail ({lead:.2f} s before the first word and {tail:.2f} s
  after the last). Play those two effects only in the fallback, when a line has no audio and its
  subtitle is shown with blips. Otherwise every radio line gets two clicks at the start and two
  squelch tails at the end.
- **Radio is a property of the line, not of the listener.** The lines with audience `humans`
  (Overlord and the squads) are radio lines. The anchor's lines (`kaiju`) and the chair's (`all`)
  are not, whoever hears them: no squelch, no blips with a radio click.
- **One line at a time per listener.** Radio lines are mono and sit in one band; two at once turn
  to mush. Queue them, and drop a queued line that has waited too long: an order for a window
  that is closing (the humans' lines for `nerve.break` and `kaiju.special`) is stale after about
  1.5 s, ordinary chatter after about 7 s, and the briefing, the endings and the hearing never.
- **The briefing** lines play back to back in script order with 0.15 s between them. Built that
  way, the humans' briefing takes {brief_h:.1f} s and the kaiju player's {brief_k:.1f} s of the
  10 s briefing; the build fails if either side's lines add up to more than {brief_max:g} s.
- **Orders are short on purpose.** The humans' lines for `nerve.break` (the stagger lasts 5 s) and
  for `kaiju.special` (the attack lands 0.8 s after the cue and lasts 3 s) are {win_min:.1f} to
  {win_max:.1f} s long with the order first. They only help if they start at once: load those
  files before the match and let them jump the queue.
- **The hearing** belongs to the `hearing` music on the end screen, not to the win fanfare. Hold
  the chair's line until that music has started, and never drop it as stale.
- **Duck the music.** Lines are mastered to -16 LUFS, the same as the full music mixes. Lower the
  music by 6 dB (4 to 6 dB for `briefing` and `hearing`, which are already quieter) while a line
  plays, and let loud sound effects win over chatter.
- **The hearing lines are stereo** (the room is wide); everything else is mono. Play voice lines
  flat, not positioned in the 3D scene.
- **Subtitles** come from the `text` field of the script, never from this folder.
- **Who speaks.** The simulation chooses the line (`chooseVoiceLines` in
  `shared/src/defs/voice.ts`) and sends its id with the voice event; the script's `speaker` field
  has the name for the subtitle label. A cue about one squad uses only that squad's own lines.
  The fourth squad, "Anvil", has no voice of its own and gets Overlord's, which is why the script
  gives each of the four radio voices several lines of its own for those cues
  (`docs/VOICE_SCRIPT.md`, "Line counts").
"""

ASR_INTRO = """\
The recognizer is pocketsphinx with its stock American English models (nothing tuned to our
script; every script word is in its dictionary). Each clip is transcribed four times: straight
from the synthesizer, as the finished master, and decoded back from the `.ogg` and the `.mp3`
that ship. Word error rate is wrong, missing and extra words divided by the words in the
subtitle. A person hears far better than this recognizer, so the numbers are a floor, useful for
comparing voices and settings and for finding lines that need attention.
"""

ASR_READING = """\
How to read it: the "unprocessed" column is the synthesizer and the recognizer's own limits; the
gap to the right of it is what the chain costs. The broadcast chain costs almost nothing. The
radio chain costs the most, as it should: it removes everything below 300 Hz and above about
4 kHz, which people are used to from telephones and the recognizer is not. Encoding to `.ogg` or `.mp3`
changes little.
"""

WEAK_INTRO = """\
The lines the recognizer does worst on, from the decoded `.ogg` (two or more wrong words, the
largest share of the line first). These are the ones to listen to first and the first candidates
for a rewrite. "Unprocessed" is the same line straight from the synthesizer.
"""

WEAK_AFTER = """\
Patterns in the misses, none of them a pronunciation fault: "volley" is never recognized from
any voice (it comes back as "valley", "bali" or "molly"); callsigns at the start of a line
("Granite", "Beacon") are rare words the recognizer does not expect; very short sentences give
it little to hold on to; "weak" comes back as "week" and "its" as "it's", which sound the same
and are counted as errors all the same; and Tempest's accent turns "fire" into "find", "hurt"
into "out" and "count" into "kind". A listener with the subtitle in front of them will have no
trouble with any of these, but the short radio lines of Granite and Tempest are the ones most
likely to be lost under game noise.
"""

PRONOUNCE_INTRO = """\
`tools/audio/voice/pronounce.json` holds what is fed to the synthesizer where the plain text
comes out wrong. The subtitle text is never changed. A respelling can be per word (`"words"`: for
every voice, or for one engine, or for one engine and voice, for example `"rhvoice:alan"`) or a
whole replacement line (`"lines"`). `tools/audio/voice/respell.py <lineId> "candidate" ..` speaks
candidates with the line's own voice and chain and prints what the recognizer hears, without
writing anything. A respelling is accepted only when it lowers the errors of the finished clip.
"""

PRONOUNCE_NONE = """\
**No respelling is in force.** Every word of the script is in the synthesizers' pronouncing
dictionaries (the script was written to avoid words that can be read two ways), so the engines
say the words correctly and the recognizer's misses are its own: it prefers "valley" to "volley",
"ankles" to "angles" and "granted" to "Granite" whoever speaks and however the word is spelled.
"""

PRONOUNCE_TRIED = """\
Respellings that were tried on the lines the recognizer does worst on, and rejected (kept in
`pronounce.json` under `"tried"` so nobody repeats them):
"""

MEASURE_INTRO = """\
Measured on the encoded files after decoding them again with `ffmpeg` (`.ogg` at Vorbis quality
{ogg_q}, `.mp3` at variable bit rate quality {mp3_q}; 44.1 kHz). Target loudness {target} LUFS.
"""

CHECKS_PASSED = """\
Every check passed on every file: both formats exist and decode at 44.1 kHz with the expected
channel count; length matches the manifest; loudness within 0.8 LU of the target; true peak below
-0.5 dBTP; clean start and end (no clicks from cut waveforms); radio lines band-limited and their
squelch clicks at least 3 dB below the speech peaks; no line longer than 8 s (13 s for the
hearing) or slower than 1.1 s per word; the humans' orders for a nerve break and for the
signature attack no longer than {window:g} s; each side's briefing lines no longer than
{brief_max:g} s together; nothing in the folder that is not in the script. Before anything is
built the script itself is checked against its writing rules (`mbvoice/scriptcheck.py`).
"""

WEAK_POINTS = """\
- **The voices are synthetic.** Flat intonation, no acting, and the same sentence melody every
  time. Overlord cannot sound grim, only slow and low. This is the main limit and only a better
  synthesizer or actors will lift it (section 8).
- **Nobody has heard these.** Loudness, peaks, band, timing and word recognition are measured;
  whether Granite sounds like a veteran is not measurable. A listening pass should check: that
  the three squads are told apart at once; that the squelch at each end is noticeable but not
  annoying after fifty lines; that the hall on the chair reads as a big room and not as a
  bathroom; that the lowered Pico voice for the chair sounds grave and not ill.
- **Tempest's accent costs words.** The recognizer scored Tempest's first set of lines at about
  20% word errors, more than twice Overlord. The lines were then rewritten around the words the
  accent loses ("fire", "hurt", "count", "flank"), which brought the same voice and the same
  radio to {tempest_wer:g}% on the shipped files (section 4). The other way out was measured too
  and not taken: RHVoice `bdl` at a higher pitch scores 6.1% on Tempest's lines against 9.1% for
  `alan` (finished masters, three draws of the radio noise each), but `bdl` is Overlord's
  speaker, and a third squad that sounds like nobody else is worth more than three words in a
  hundred to a recognizer. If Tempest is hard to follow by ear, that change is one line in
  `cast.json`.
- **An order is only as fast as the client plays it.** The humans' lines for a nerve break and
  for the signature attack are short now, but a line still arrives late if it waits behind
  another line or for its file to load. What the game code should do about that is in
  `docs/audio/client-notes-voice.md`.
- **The chair's reverberation is a compromise.** It is held down under the words so they stay
  clear, and blooms in the pauses and at the end. In a recognizer's ears it still costs words;
  for a person with subtitles on the end screen it should be comfortable.
- **Two voices are band-limited at the source.** RHVoice `clb` and `alan` and Pico stop at about
  7.5 kHz. On the radio that does not matter (everything above about 4 kHz is removed anyway);
  the chair sounds a little duller than the anchor.
- **Granite's synthesizer (Flite) has a slightly rougher, buzzier sound** than the RHVoice
  voices. Under the radio chain most of that is masked, and it suits the character, but it is
  the lowest-fidelity voice in the cast.
- **One-word lines** are short of cues for any listener in a noisy match. If playtests show they
  get lost, the script is the place to fix it.
"""

SWAP = """\
Everything that touches a speech engine is in one function:
`synthesize(text, voice)` in `tools/audio/voice/mbvoice/synth.py`. It takes the text to speak and
a voice description from `cast.json` and returns mono samples and their sample rate. To use a
better synthesizer (a neural voice, a cloud service used at build time, or recordings of
actors):

1. Add a branch for a new `engine` name in `synthesize` that returns the samples for the text
   (for recordings: load `recordings/<lineId>.wav`).
2. Point the speakers in `cast.json` at it (`"voice": {{ "engine": "<new>", "voice": "<name>" }}`).
3. Run `tools/audio/voice/build.sh`. Trimming, pauses, the radio, broadcast and hall chains,
   loudness, encoding, the manifest, the recognizer check and this page all follow unchanged.

With natural voices the radio chain can afford to be rougher again: raise `drive_db` and
`static_db` for the squads in `cast.json` and watch the error table.
""".replace("{{", "{").replace("}}", "}")

ENCODING = """\
### Encoder settings

The build encodes at Vorbis quality {ogg_q} and MP3 variable-bit-rate quality {mp3_q}.
`tools/audio/voice/encode_test.py` encoded every finished master ({lines} lines) at four
settings of each encoder and measured the results. "Signal to noise" compares the decoded file
with its master sample by sample (higher is closer); the two recognizer columns are word error
rates on the decoded files, for all lines and for the radio lines alone; "highest true peak" is
the loudest decoded peak of any line (the masters are limited to {ceiling} dBTP and the checks
allow {peak_limit} dBTP).
"""

ENCODING_AFTER = """\
What decided the settings. The smallest files are not free once the whole script is measured:

- **Vorbis 0 overshoots.** With so few bits its coding noise pushes decoded peaks past the limit
  of the checks, so a build at that setting fails.
- **The radio lines pay first.** They are band-limited and overdriven on purpose, and coding
  noise comes on top: the recognizer's errors on the radio voices creep up as the bit rate goes
  down, while the anchor's clean lines hardly change.
- **One step down is free.** From the first build's settings (Vorbis 3, MP3 5) to the present
  ones the recognizer's numbers move by less than their own scatter and the files shrink by
  about a tenth.

Voice files are fetched one at a time when a line is first spoken, {kb_per_line:.0f} kB each on
average, so the total matters more to the size of the repository than to a player.
"""

REVIEW = """\
An independent review measured every sound file and read the script against the way the game
picks lines. Nothing was broken; these are the changes it led to. (The findings about game code
are in `docs/audio/client-notes-voice.md`.)

- **Orders fit their window.** The stagger lasts 5 s and the signature attack is over in under
  4 s, but three of the humans' lines for them took 4.4 to 5.1 s and ended on the order. All such
  lines now put the order first and take {win_min:.1f} to {win_max:.1f} s; the build fails above
  {window:g} s.
- **A squad no longer reports its own destruction.** The game gives a cue about a squad to that
  squad's own voice, so Granite's line for a squad wiped out could only play when Granite had
  just been wiped out. Those lines are Overlord's now, and the script check keeps it that way.
- **Nothing is "new" twice.** Two lines called the signature attack new; it comes round every
  minute or so. They were replaced by lines that stay true.
- **Variety per voice, not per cue.** Because a squad only ever uses its own lines (and the
  fourth squad Overlord's), each of the four radio voices now has three lines of its own for the
  two volley cues and two for the crossfire, the nerve break, a lost unit, contact and a stray
  shot; the cues that come round every minute have a third line per side. {new_lines} lines were
  added, {lines} in all.
- **The lines the recognizer lost were reworded,** using `tryline.py` to hear candidates through
  each voice's own radio first. Tempest went from 21.3% to {tempest_wer:g}% word errors and
  Granite from 20.9% to {granite_wer:g}% on the decoded `.ogg` files.
- **The briefing fits its ten seconds.** The humans' three lines took 10.6 s before the gaps
  between them; they take {brief_h:.1f} s now, and the build fails above {brief_max:g} s.
- **"One of ours" means one thing.** It was used both for a lost unit and for a stray shot; the
  stray-shot line now says "That shot was ours."
- **Smaller files,** one encoder step down (section 6).
- **The hearing lines may run to twenty words;** `docs/ASSETS.md` now says so.
"""

REBUILD = """\
```
tools/audio/voice/build.sh                 # check the script, build what changed, verify, regenerate this page
tools/audio/voice/build.sh --force         # rebuild every line
tools/audio/voice/build.sh 'v_clock_*'     # only matching line ids
tools/audio/voice/build.sh --verify-only   # re-measure the files that are there
tools/audio/voice/audition.py raw          # re-run the audition (then: audition.py espeak, audition.py summary)
tools/audio/voice/experiments.py <group>   # re-run casting and chain experiments (then: experiments.py summary)
tools/audio/voice/tryline.py Granite "Candidate wording." "Another."   # hear a wording before it goes in
tools/audio/voice/encode_test.py run       # re-measure the encoder settings (then: encode_test.py summary)
npm run assets:manifest                    # merge manifest.voice.json into manifest.json
```

The build starts by checking the script against its writing rules (`mbvoice/scriptcheck.py`;
the rules are listed in `docs/VOICE_SCRIPT.md`) and builds nothing if one is broken. It ends by
writing this page and `docs/VOICE_SCRIPT.md`, the readable copy of the script.

A line is rebuilt when its spoken text (script text or respelling), its speaker's voice or chain
settings in `cast.json`, or the processing code changed; `tools/audio/voice/build_state.json`
remembers what each file was built from. The build is seeded per line, so rebuilding gives the
same audio. A full build takes a few minutes on two cores. Intermediate WAV files go to
`/tmp/mb-scratch/voice/`, never into the repository. Outputs are in `{out}`.
"""
