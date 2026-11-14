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
- Numbers behind this page: `docs/audio/voice/measurements.json`, `audition.json`,
  `experiments.json`, `encoding.json`, and `first_cast.json` for the voices these replaced

The voices are **neural voices**: speech models trained on recordings of real people, which
speak with natural rhythm, stress and sentence melody instead of the flat, even delivery of the
older synthesizers. They run on the build machine's processor with no network (Kokoro-82M, and
Piper for one voice; section 8). The model files are downloaded once, at build time, into a
folder outside the repository; nothing in the game calls out to anything: it plays the finished
files. Until this build the lines were spoken by rule-based synthesizers, which were clear but
obviously synthetic (section 11 keeps their numbers).

Nobody listened to these files while they were made (the build machine has no speakers). Every
decision below was taken from measurements: two speech recognizers transcribe each clip and the
words they get wrong are counted, a speaker-recognition model measures how distinct the radio
voices are, and loudness, peaks, bandwidth, timing and spectrograms are checked. The last build
finished with **{failures} failed checks**. A human listening pass is still worth doing; section 7
says what to listen for.
"""

CAST_NOTES = """\
"Pitch" is the middle (median) pitch of the voice measured on the unprocessed speech of that
character's lines; "pace" is words per second from first word to last, pauses included. A Kokoro
voice name starts with its accent and whether it is a man's or a woman's voice (`am_` American
man, `af_` American woman, `bm_` British man); the names are the model's own.

Why these voices:

- **Overlord** is Kokoro `am_onyx`, the deepest and darkest voice the model has (about
  {overlord_f0:.0f} Hz) and unhurried by nature; at 92% speed it is the slowest voice on the radio
  ({overlord_wps} words a second). Command keeps the cleanest radio, as before: less drive, less
  static, and now a wider band (up to 4.5 kHz) with a stronger presence peak, because this dark
  voice has little energy where a radio's band ends and the wider band was measured to cost
  pocketsphinx fewer words (the second Overlord round below). Its orders come out faster than its
  briefing (section 2).
- **Granite** is Kokoro `am_echo`, a plain, level American man, lighter than Overlord (about
  {granite_f0:.0f} Hz) and a little quicker. In the audition it was the neural voice pocketsphinx followed
  best, which suits the shortest, most clipped lines in the script. It ends some lines with a
  strong breath on the last consonant, which both recognizers sometimes hear as an extra "s"
  ("way" as "ways"; section 4).
- **Beacon** is Kokoro `af_sky`, a clear, brisk American woman (about {beacon_f0:.0f} Hz), slowed a little
  for the by-the-book reports; her orders are spoken at 1.1 times her normal speed so that "Engaging
  the weak point, as instructed." fits its window.
- **Tempest** is Piper `en_GB-alba-medium`, a neural voice trained on recordings of a Scottish
  woman ("Alba" is Gaelic for Scotland). Tempest spoke with a Scottish accent in the first cast and
  this is the only natural voice with one, so Tempest is now a woman; nothing in the script says
  otherwise. pocketsphinx, which knows only American speech, loses {tempest_wer:.0f}% of her words on
  the shipped files; the second recognizer misses {tempest_wer2:.1f}%, and section 4 lists every word
  it missed. Her voice comes from the Piper project rather than Kokoro, so it also sounds least
  like the others on the channel. If she turns out to
  be hard to follow by ear, the alternative is one line in `cast.json`: a British Kokoro voice
  (`bm_george` or `bm_fable`; the casting rounds below have their numbers).
- **Anchor** is Kokoro `af_heart`, the voice the model's authors rate highest: warm, composed and
  the most natural of all. Slowed to 85% it reads the news at the first anchor's pace, and it is
  the voice pocketsphinx follows best in the whole cast ({anchor_wer:.1f}% on the shipped files, a
  little better than the first anchor).
- **Chair** is Kokoro `bm_lewis`, a low, calm British man (about {chair_f0:.0f} Hz) at 85% speed: the
  gravity of a parliamentary hearing, and a voice heard nowhere else in the game. Of the British
  men it is the lowest and the steadiest (`bm_george` has a rougher, breathier sound, `bm_fable`
  is livelier, a storyteller).

The four radio voices share one channel and are now two men and two women, three American and
one Scottish, spread from about {overlord_f0:.0f} Hz (Overlord) to about {tempest_f0:.0f} Hz (Tempest), with
Overlord the slowest and on a cleaner radio. The anchor and the chair are on their own chains and
are different speakers again: six voices, six people.

Licenses: Kokoro-82M is Apache 2.0, voices included. Tempest's voice is a Piper voice trained on
the "Alba" recordings published on the University of Edinburgh's DataShare (item 10283/3270)
under Creative Commons Attribution 4.0 (CC BY 4.0), which allows use in a game with credit; the
credit is this paragraph: "Alba" speech recordings (University of Edinburgh DataShare
10283/3270, CC BY 4.0); Piper voice `en_GB-alba-medium` (rhasspy/piper-voices), fine-tuned from
the Piper voice of reader 92 of NVIDIA's Hi-Fi TTS dataset (CC BY 4.0). The second recognizer
(Parakeet, CC BY 4.0) and the speaker recognizer (WeSpeaker, Apache 2.0) only measure; nothing of
them is in the game.
"""

AUDITION_INTRO = """\
The audition that chose the first cast: every voice installed then spoke all the lines at its
default settings, unprocessed, and pocketsphinx's transcript was compared with the subtitle text.
Lower is better. pocketsphinx's own floor on this script is about 6% (it never gets "volley" and
often swaps "a" for "the", whoever is speaking).
"""

VOICE_PRINTS_INTRO = """\
Overlord and the three squads share one radio channel, so a player must know at once who is
talking. That is measured, not guessed: a speaker-recognition model (WeSpeaker ResNet34, trained
to tell thousands of real people apart) turns every finished radio line, decoded from the `.ogg`
that ships, into a voice print, and the prints of each character are averaged. The table gives
how alike two characters' prints are: 1 would be the same voice, 0 or less nothing in common. On
the diagonal, in bold, each character's odd-numbered lines against its even-numbered lines: how
alike a voice is to itself through the same radio, static and squelch.
"""

VOICE_PRINTS_AFTER = """\
Every character is at least {self_min:.2f} like itself and at most {hi:.2f} like anyone else (the
closest pair is {hi_a} and {hi_b}; the furthest apart are at {lo:.2f}). {old}
"""

BEFORE_AFTER_INTRO = """\
The same 221 lines, the same chains and the same checks, before and after the switch. Word
errors are on the decoded `.ogg` files that ship. "pocketsphinx" is the build's own recognizer
(section 4); the "second recognizer" is a modern one that hears about as well as an attentive
person (section 4 says why there are two). Pace is words per second from the first word to the
last, pauses included.
"""

NEURAL_AUDITION_INTRO = """\
Every English voice of Kokoro-82M and every Piper voice with a usable license (mbvoice/models.py)
spoke the same {lines} lines (every seventh line of the script: radio, news and hearing), at
default settings and unprocessed; the six voices of the first cast spoke them too, at their cast
settings, for comparison. "Pitch movement" is how far the voice's pitch travels within a line
(from its lower tenth to its upper tenth, in semitones, middle value over the lines): flat,
robotic speech moves little, a person telling you something moves more. pocketsphinx's errors are
counted as everywhere in this page; its errors on natural voices are mostly its own (section 4).
"""

NEURAL_EXPERIMENTS_INTRO = """\
The voices short-listed by the audition, each speaking its character's own lines (or a sample of
them, as listed) through that character's finished chain, with the same seeds as the build. Both
recognizers listened to the finished clips.
"""

NEURAL_REMARKS = {
    "kokoro af_heart": "Cast: Anchor (85% speed); the model's highest-rated voice",
    "kokoro af_bella": "Runner-up for the anchor",
    "kokoro af_nicole": "Whispered, close to the microphone: too soft for news or radio",
    "kokoro af_aoede": "Muffled: almost nothing above 2.4 kHz",
    "kokoro af_kore": "Clear, quick; not needed",
    "kokoro af_sarah": "Not needed",
    "kokoro af_alloy": "Clear on the radio, but its voice print is too close to `am_echo` (Granite)",
    "kokoro af_nova": "Clear; not needed",
    "kokoro af_sky": "Cast: Beacon (90% speed)",
    "kokoro af_jessica": "Fast and bright; most errors of the American women",
    "kokoro af_river": "Not needed",
    "kokoro am_fenrir": "Fast; its voice print is close to `am_echo`",
    "kokoro am_michael": "No errors at all for the second recognizer, but pocketsphinx loses a fifth",
    "kokoro am_puck": "Most errors of the American men",
    "kokoro am_echo": "Cast: Granite (95% speed)",
    "kokoro am_eric": "Fast and high",
    "kokoro am_liam": "Its voice print is close to `am_onyx`",
    "kokoro am_onyx": "Cast: Overlord (92% speed); the deepest voice",
    "kokoro am_santa": "A Santa Claus voice: comic, ruled out",
    "kokoro am_adam": "The model's lowest-rated voice",
    "kokoro bf_emma": "British; pocketsphinx cannot follow the accent; not needed",
    "kokoro bf_isabella": "British; pocketsphinx cannot follow the accent; not needed",
    "kokoro bf_alice": "British; pocketsphinx cannot follow the accent; not needed",
    "kokoro bf_lily": "British; pocketsphinx cannot follow the accent; not needed",
    "kokoro bm_george": "Chair candidate; rougher, breathier sound",
    "kokoro bm_fable": "Chair candidate; lively, a storyteller",
    "kokoro bm_lewis": "Cast: Chair (85% speed)",
    "kokoro bm_daniel": "Not needed",
    "piper en_GB-alba-medium": "Cast: Tempest; the only Scottish voice",
    "piper en_GB-cori-high": "British; pocketsphinx loses more than half",
    "piper en_US-bryce-medium": "Clear and slow; not needed",
    "piper en_US-joe-medium": "Erratic pitch",
    "piper en_US-john-medium": "Not needed",
    "piper en_US-mike-medium": "Flat; not needed",
    "piper en_US-norman-medium": "Not needed",
    "first cast: Overlord (rhvoice bdl)": "The first Overlord (replaced)",
    "first cast: Granite (flite rms)": "The first Granite (replaced)",
    "first cast: Beacon (rhvoice clb)": "The first Beacon (replaced)",
    "first cast: Tempest (rhvoice alan)": "The first Tempest (replaced)",
    "first cast: Anchor (rhvoice slt)": "The first anchor (replaced)",
    "first cast: Chair (pico en-US)": "The first chair (replaced)",
}

NEURAL_AUDITION_AFTER = """\
What the audition showed. Most neural voices move their pitch within a line one and a half to
two times as far as the first cast (mostly 6 to 13 semitones against 4 to 6), which is the
measurable side of sounding like a person rather than a machine. At their default speed most of
them also speak faster than the first cast (most Kokoro voices 3.1 to 3.6 words a second, the
first cast 2.4 to 3.0), and pocketsphinx misses more of their words: partly the pace (slowing
a voice to 85 to 90% lowers its errors, and every voice in the cast is slowed) and partly that
natural speech runs words together the way people do. Every British and
Scottish voice is marked down by pocketsphinx, whatever its quality, as the first cast's Scottish
voice was.
"""

NEURAL_EXPERIMENT_TITLES = {
    "neural_overlord": "Overlord: all 50 of Overlord's lines through Overlord's radio",
    "neural_overlord2": "Overlord, second round: half of Overlord's lines; changes to Overlord's radio",
    "neural_squads": "Radio voices: 40 of the squads' lines (every other one) through the squads' radio",
    "neural_anchor": "Anchor: 43 news lines (every other one) through the broadcast chain",
    "neural_chair": "Chair: the 6 hearing lines and 29 news lines through the hall",
}

NEURAL_EXPERIMENTS_AFTER = """\
What the rounds decided:

- **The radio is what costs pocketsphinx words, for every natural voice.** Through the squads'
  radio the American voices lose 11 to 23% of their words to it (the Scottish one half), and
  even `am_echo`, the voice it follows best, loses 21% through Overlord's radio on Overlord's
  lines; the first Overlord, an over-articulated rule-based voice, lost 5% there. The second recognizer loses 0 to 2.4% through
  the same radio for every candidate. So the words are there; pocketsphinx cannot dig them out
  of natural speech in a radio band.
- **Overlord's wider band helps.** Opening Overlord's radio up to 4.5 kHz with a stronger presence
  peak brought pocketsphinx from 24% to 21% on the dark `am_onyx` and cost nothing.
- **Telling the squads apart decided Granite and Beacon.** The voice prints of the candidates (the
  same measure as the table above) put `af_alloy` 0.61 from `am_echo`, closer than any two voices
  of the first cast, and `af_sky` 0.26 from it; `am_onyx` is 0.26 or less from both, and Tempest's
  Scottish voice 0.32 or less from everyone.
- **Slower is clearer.** The anchor's lines at 85% speed lost 5.9% of their words to pocketsphinx
  through the broadcast chain, against 16.8% for the same voice at full speed in the audition.
"""

BEFORE_AFTER_AFTER = """\
In short: pocketsphinx gets {ps_now:.1f} words in a hundred wrong on the shipped files now, against
{ps_before:.1f} with the first voices; the second recognizer {p2_now:.1f} against {p2_before:.1f}. The first
voices were rule-based and over-articulated, close to the slow, careful speech pocketsphinx was
built for, and the script had been reworded around their misses; the neural voices speak like
people, with natural rhythm and accents, which pocketsphinx handles badly and a listener (or a
modern recognizer) takes in its stride. Where the two disagree, trust the second recognizer for what a player will understand,
and pocketsphinx for spotting lines worth a listen. The files are {ogg_now:.1f} MB of `.ogg` and
{mp3_now:.1f} MB of `.mp3` (first voices: {ogg_before:.1f} and {mp3_before:.1f} MB), at the same encoder settings.
"""

SECOND_MISSES_INTRO = """\
The lines in which the second recognizer missed a word on the decoded `.ogg` (these are the ones
worth a listen first; a miss that only pocketsphinx makes is usually pocketsphinx):
"""

SECOND_MISSES_NONE = """\
The second recognizer got every word of every line right on the decoded `.ogg` files.
"""

FIRST_VOICES_INTRO = """\
Until the switch to neural voices the lines were spoken by the rule-based and statistical
synthesizers installed on the build machine (RHVoice, Flite and Pico). They were clear, steady
and flat: no acting, the same sentence melody every time. They were measured like this, on the
files they shipped with (pocketsphinx's numbers from their last build; the second recognizer's
measured on the same files just before they were replaced, kept in
`docs/audio/voice/first_cast.json`):
"""

FIRST_VOICES_AFTER = """\
Their casting experiments (candidate settings for every character through the first-pass chains)
are kept in `docs/audio/voice/experiments.json` (groups `radio_voices`, `anchor_voices`,
`chair_voices`, `chair_voices2`) and can be rerun with `tools/audio/voice/experiments.py`; the
older synthesizers stay installed and `synthesize` still speaks with them, so any of these voices
can be put back with one line in `cast.json`.
"""

AUDITION_REMARKS = {
    "rhvoice bdl": "Was Overlord",
    "rhvoice clb": "Was Beacon",
    "flite rms": "Was Granite",
    "rhvoice slt": "Was the anchor",
    "rhvoice alan": "Was Tempest",
    "pico en-US": "Was the chair (lowered and slowed)",
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
How the chain settings were chosen. One setting changed at a time, measured on real lines with
pocketsphinx (word error rate of the finished clip; "unprocessed" is the same lines straight from
the synthesizer). These sweeps were run with the first voices (section 11), on the first version
of the script; the settings they chose carried over to the neural voices unchanged. The recognizer
is much less tolerant of noise, distortion and reverberation than a person, so these sweeps err
on the side of clarity. Differences of two or three points are within the noise of the
measurement.
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

ORDERS = """\
"Orders" are the humans' lines for a nerve break and for the signature attack, which must be over
before their window closes (section 3). A character can deliver them at a speed and with a pause
of their own (`"orders"` in `cast.json`): the neural voices are slowed down for gravity in the
briefing and the chatter, and an order at that pace would run past its window. They come out
crisper instead, the way an order under pressure does.
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
Two recognizers listen to every line. Word error rate is wrong, missing and extra words divided
by the words in the subtitle; lower is better.

- **pocketsphinx**, the build's own measure since the first voices, with its stock American
  English models (nothing tuned to our script; every script word is in its dictionary). It is
  an old recognizer made for slow, careful American read speech. It is strict, which makes it
  good at finding mumbled or swallowed words, and it is easily thrown by things a person does not
  notice at all: natural rhythm, words run together ("we are" heard as "we're", which counts as
  two errors), any accent that is not American, and a callsign it does not expect. It transcribes
  each clip four times: straight from the synthesizer, as the finished master, and decoded back
  from the `.ogg` and the `.mp3` that ship.
- **The second recognizer**, NVIDIA Parakeet TDT 0.6B v2 (CC BY 4.0; `mbvoice/asr2.py`), a modern
  neural recognizer that hears about as well as an attentive person. A word it misses is worth a
  listen; a word only pocketsphinx misses usually is not. It transcribes the unprocessed speech
  and the decoded `.ogg`.

Neither is tuned to this script or these voices, and a person with the subtitle in front of
them hears better than both.
"""

ASR_READING = """\
How to read it: the "unprocessed" columns are the voice and the recognizer's own limits; the gap
to the right of them is what the chain costs. The radio chain costs the most, as it should: it
removes everything below about 300 Hz and above about 4 kHz, which people are used to from
telephones and pocketsphinx is not. Encoding to `.ogg` or `.mp3` changes little. The two
recognizers disagree most on the voices pocketsphinx was never made for (the British and Scottish
ones, and natural fast speech generally); where the second recognizer is near zero, a person will
follow the line.
"""

WEAK_INTRO = """\
The lines pocketsphinx does worst on, from the decoded `.ogg` (two or more wrong words, the
largest share of the line first), with the second recognizer's count beside them. Where the
second recognizer has no errors, the trouble is pocketsphinx, not the line. "Unprocessed" is
pocketsphinx on the same line straight from the voice.
"""

WEAK_AFTER = """\
Patterns in pocketsphinx's misses: "volley" is never recognized from any voice (here "lol you",
before "valley" or "molly"); short sentences and two-word orders give it little to hold on to;
natural speech runs words together, and "it is" heard as "it's" or "we have lost" as "we lost"
count as errors; and it cannot follow Tempest's Scottish accent ("It staggers. Give it
everything." comes back as "it appears to get a good thing") although the second recognizer
gets almost all of her lines right. The second recognizer's own misses, listed above, are few and
mostly trivial: Granite's breath after a final consonant heard as a plural ("ways", "parts",
"works"), the squelch at the end of a line heard as one more short word, "backup" for "back up",
"cancelled" for "canceled". The one that matters is Tempest's "That stood for a hundred years.",
heard as "that's doodra one hundred years" through the radio although the unprocessed line is
heard correctly: the radio blurs "stood for a". It is the first line to listen to.
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
**No respelling is in force.** Kokoro gets its pronunciations from misaki's pronouncing lexicons,
American or British to match the voice, with part-of-speech tags for words spelled alike; every
word of the script is in both lexicons, so nothing is left to guessing (the script was also
written to avoid words that can be read two ways). Piper reads with eSpeak NG's British English.
The recognizers' misses are their own: pocketsphinx prefers "valley" to "volley", "ankles" to
"angles" and "granted" to "Granite" whoever speaks and however the word is spelled.
"""

PRONOUNCE_TRIED = """\
Respellings that were tried with the first voices on the lines pocketsphinx did worst on, and
rejected (kept in `pronounce.json` under `"tried"` so nobody repeats them; the voices were
different then, so a respelling that failed then could be tried again with `respell.py`):
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
- **Nobody has heard these.** Loudness, peaks, band, timing, word recognition and how distinct the
  radio voices are were all measured; whether Overlord sounds stern rather than sleepy, or the
  anchor composed rather than chirpy, is not measurable. A listening pass should check: that the
  four radio voices are told apart at once; that Tempest's Scottish voice is easy to follow
  through the radio static; that the orders, which are spoken faster than the rest, still sound
  like the same person; that no line has an odd stress or a strange pause (each line is generated
  on its own, so a neural voice can put the weight of a sentence in a different place from one
  line to the next); that the squelch at each end is noticeable but not annoying after fifty
  lines; and that the hall on the chair reads as a big room and not as a bathroom.
- **pocketsphinx is the wrong judge for these voices.** It was the build's measure when the voices
  were rule-based, and it gets {all_wer:.1f} words in a hundred wrong now, about twice as many as
  then, while the second recognizer gets {all_wer2:.1f} wrong, no more than before (section 1). Its
  errors still point at the lines worth a listen, but its totals no longer say how clear the
  voices are. If the voices are ever judged by one number again, it should be the second
  recognizer's.
- **Tempest is the voice a listener may find hardest.** pocketsphinx loses {tempest_wer:.0f}% of her words
  (it knows only American speech); the second recognizer {tempest_wer2:.1f}%. Her lines were already
  written around the words a Scottish accent loses on the radio ("fire", "hurt", "count", section
  10). If players find her hard to follow, a British Kokoro voice is one line in `cast.json`.
- **Faint steady tones.** Some Kokoro voices, the anchor's among them, carry faint steady tones
  high up (around 9 to 11 kHz), seen as thin horizontal lines in the spectrogram sheets: about 6
  dB above the hiss around them and far below the voice. The radio removes them; on the anchor
  they would be heard, if at all, as a faint whistle in the quietest moments.
- **An order is only as fast as the client plays it.** The humans' lines for a nerve break and
  for the signature attack are short, but a line still arrives late if it waits behind another
  line or for its file to load. What the game code should do about that is in
  `docs/audio/client-notes-voice.md`.
- **The chair's reverberation is a compromise.** It is held down under the words so they stay
  clear, and blooms in the pauses and at the end. For a person with subtitles on the end screen it
  should be comfortable.
- **One-word lines** are short of cues for any listener in a noisy match. If playtests show they
  get lost, the script is the place to fix it.
- **The build depends on files from Hugging Face** the first time it runs on a machine (section
  8). They are pinned to exact revisions and checked by hash; if one disappears from Hugging Face,
  the build stops with the name of the missing file, and a copy from any machine that has built
  the voices (in `/opt/mbtools/models`) will do.
"""

SWAP = """\
Everything that touches a speech engine is in one function:
`synthesize(text, voice)` in `tools/audio/voice/mbvoice/synth.py`. It takes the text to speak and
a voice description from `cast.json` and returns mono samples and their sample rate. It has one
branch per engine:

- **`kokoro`**: Kokoro-82M (Apache 2.0), a neural voice model of 82 million parameters, run on the
  processor with ONNX Runtime through the `kokoro-onnx` package. Its pronunciations come from
  misaki, the converter it was trained with (a pronouncing lexicon, spaCy's small English model
  for words spelled alike, eSpeak NG for anything else). `voice` is a Kokoro voice name (`am_` and
  `af_` are American men and women, `bm_` and `bf_` British) or a blend of several,
  `"am_onyx:7+am_fenrir:3"`; `rate` is its speed; `accent` (`us` or `gb`) overrides the
  pronunciation the voice name implies.
- **`piper`**: Piper voices (a small network per recorded speaker, from the Piper project's
  collection `rhasspy/piper-voices`, trained by many contributors; each voice's card gives its
  recordings and license); `voice` is the voice's file name, `speaker` picks one speaker of a
  multi-speaker voice, `rate`, `noise_scale` and `noise_w` as in Piper.
- **`rhvoice`, `flite`, `pico`, `festival`, `espeak`**: the synthesizers of the first cast
  (section 11), still installed.

The neural model files are not in the repository. `tools/audio/voice/mbvoice/models.py` lists
every one with its source, the exact revision and its SHA-256 hash, and the license it comes
with; the first build on a machine downloads what it needs from Hugging Face into
`/opt/mbtools/models` (or `$MB_MODELS`) and checks each hash: about 350 MB for Kokoro and 690 MB
for the two measuring models (the second recognizer and the speaker recognizer). After that the
build needs no network. The game never loads any of it: it plays the finished files. Kokoro and
Piper give the same samples for the same text every time, so a rebuild gives the same audio.

The speech model runs on at most two processor threads in all (`MB_TTS_THREADS`, default 2), so
it leaves the rest of a shared machine alone: the build's two worker processes get one each.

To use another synthesizer (a newer model, a cloud service used at build time, or recordings of
actors):

1. Add a branch for a new `engine` name in `synthesize` that returns the samples for the text
   (for recordings: load `recordings/<lineId>.wav`). Model files go into `models.py`.
2. Point the speakers in `cast.json` at it (`"voice": {{ "engine": "<new>", "voice": "<name>" }}`).
3. Run `tools/audio/voice/build.sh`. Trimming, pauses, the radio, broadcast and hall chains,
   loudness, encoding, the manifest, the recognizer checks and this page all follow unchanged.

To try another Kokoro voice or blend, put it in `cast.json` and run
`tools/audio/voice/tryline.py <Character> "a line" ..` first. To add a Piper voice, read its
`MODEL_CARD` on Hugging Face for the license of its recordings and its base model, then add it to
`PIPER_VOICES` in `models.py` with its hashes.
""".replace("{{", "{").replace("}}", "}")

ENCODING = """\
### Encoder settings

The build encodes at Vorbis quality {ogg_q} and MP3 variable-bit-rate quality {mp3_q}.
`tools/audio/voice/encode_test.py` encoded every finished master ({lines} lines) at four
settings of each encoder and measured the results against the masters:

- the two recognizer columns are word error rates on the decoded files, for all lines and for
  the radio lines alone;
- "signal to noise" compares the decoded file with its master sample by sample (higher is
  closer; the two encoders work differently, so compare within one encoder);
- "spectrum lost" is the share of the master's audible spectrum (every moment and pitch within
  70 dB of the loudest, 300 Hz to 12 kHz) that comes back more than 20 dB quieter, in other
  words left empty by the encoder; the second such column is for the anchor's lines alone, the
  only voice that fills the band up to 12 kHz;
- "highest true peak" is the loudest decoded peak of any line (the masters are limited to
  {ceiling} dBTP and the checks allow {peak_limit} dBTP).
"""

ENCODING_AFTER = """\
What decided the settings (measured again on the neural voices' masters; the settings themselves
are those of the first build). The audio review once suggested the lowest settings in this table
to save space. Measured on every line, with two more measures than word errors, they are not
free:

- **Lower Vorbis settings overshoot.** With fewer bits the coding noise pushes the loudest
  decoded peak up: {ogg2_peak:.2f} dBTP at quality 2, {ogg1_peak:.2f} at 1 and {ogg0_peak:+.2f} at 0,
  against {ogg_peak:.2f} dBTP at the setting in use and a limit of {peak_limit} dBTP in the checks
  (above 0 dBTP a peak clips). The setting in use is the lowest that passes.
- **The recognizer cannot tell them apart.** With these voices pocketsphinx's errors stay between
  {wer_lo:.1f} and {wer_hi:.1f}% at every setting of both encoders, so word errors decide nothing here.
- **MP3 switches parts of the spectrum off.** Between the loud sounds a low-rate MP3 leaves
  whole bands empty, which is heard as a watery edge on the anchor's clean voice; the recognizer
  does not notice. On the anchor's lines MP3 loses {mp35_anchor:.1f}% of the audible spectrum at 5,
  {mp36_anchor:.1f}% at 6 and {mp37_anchor:.1f}% at 7; Vorbis loses {ogg_anchor:.1f}% at the setting in use.
- **So the settings stay.** One step down for MP3 (5 to 6) would save {mp3_saving:.0f}% of the `.mp3`
  files and leave {mp3_lost_ratio:.1f} times as much of the anchor's spectrum empty; Vorbis cannot go
  down without failing the peak check.

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
  each voice's own radio first: the six the review named and five more from further down the
  list. Tempest went from 21.3% to {tempest_wer:.1f}% word errors and Granite from 20.9% to
  {granite_wer:.1f}% on the decoded `.ogg` files; the whole script from 10.9% to {all_wer:.1f}%.
- **The briefing fits its ten seconds.** The humans' three lines took 10.6 s before the gaps
  between them; they take {brief_h:.1f} s now, and the build fails above {brief_max:g} s.
- **"One of ours" means one thing.** It was used both for a lost unit and for a stray shot; the
  stray-shot line now says "That shot was ours."
- **Encoder settings were measured and kept.** The review suggested lower ones to save space;
  on the whole script every step down costs words on the radio voices, and the lowest fail a
  peak check or hollow out the anchor's voice (section 6).
- **The hearing lines may run to twenty words;** `docs/ASSETS.md` now says so.
"""

REBUILD = """\
```
tools/setup-asset-tools.sh                 # once per machine: the synthesizers, ONNX Runtime and the rest
tools/audio/voice/build.sh                 # check the script, build what changed, verify, regenerate this page
tools/audio/voice/build.sh --force         # rebuild every line
tools/audio/voice/build.sh 'v_clock_*'     # only matching line ids
tools/audio/voice/build.sh --verify-only   # re-measure the files that are there
tools/audio/voice/audition.py neural       # re-run the neural audition (then: audition.py summary)
tools/audio/voice/experiments.py <group>   # re-run casting and chain experiments (then: experiments.py summary)
tools/audio/voice/tryline.py Granite "Candidate wording." "Another."   # hear a wording before it goes in
tools/audio/voice/encode_test.py run       # re-measure the encoder settings (then: encode_test.py summary)
npm run assets:manifest                    # merge manifest.voice.json into manifest.json
```

The first run on a new machine downloads the model files (section 8), about 1 GB, from Hugging
Face; later runs need no network.

The build starts by checking the script against its writing rules (`mbvoice/scriptcheck.py`;
the rules are listed in `docs/VOICE_SCRIPT.md`) and builds nothing if one is broken. It ends by
writing this page and `docs/VOICE_SCRIPT.md`, the readable copy of the script.

A line is rebuilt when its spoken text (script text or respelling), its speaker's voice, order
speed or chain settings in `cast.json`, the model files it is spoken with (`models.py`), or the
processing code changed; `tools/audio/voice/build_state.json`
remembers what each file was built from. The build is seeded per line, so rebuilding gives the
same audio. A full build takes about a quarter of an hour on two cores (ten minutes to speak and
encode every line, the rest to measure them); after that only what changed is rebuilt and
measured. Intermediate WAV files go to `/tmp/mb-scratch/voice/`, never into the repository.
Outputs are in `{out}`.
"""
