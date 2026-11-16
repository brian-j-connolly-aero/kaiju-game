"""stage3: "Colossus Overdrive" (stage 3, the titan). 168 beats per minute, 112 bars, 160 s loop.
D minor with the flat second (E flat) of the monster's cadence; the last chorus a semitone up in
E flat minor.

The biggest of the three: double-kick drums, two distorted guitars, synth bass, the whole choir
(sustained "aah" and shouts), brass section and horns, timpani, taiko and orchestra hits, a saw
lead with a square wave an octave below. The accents of the intro and the breakdown fall
3+3+2, like the titan's orchestral music before it. One bar is 10/7 s (63000 samples).

    bars   1-8    intro: the 3+3+2 riff on D with E flat stabs, choir and brass on the accents
    bars   9-24   verse: the saw lead in running eighths over the double kick
    bars  25-32   pre-chorus: long rising notes, choir swelling, snare build
    bars  33-48   chorus: the anthem hook, brass and choir under it, 3+3+2 orchestra hits
    bars  49-56   Gragnor's theme (the game's own) for the whole choir, brass and band
    bars  57-64   the theme's second strain, women and tenors
    bars  65-72   breakdown: taiko, toms and timpani, choir "ooh", the hook echoing, a build
    bars  73-88   guitar solo; ends on B flat to lift the key
    bars  89-104  chorus a semitone up (E flat minor); B flat, then A, turns it home
    bars 105-112  outro: the intro riff again, back to bar 1
"""
from ..arcade import Harmony, Kit, arp, bass, echo, groove, hits, long_bass, pad, power, stabs, swell
from ..score import B, Cue
from ..theme import STRAIN_B, THEME

BPM = 168

INTRO = "Dm | Dm Eb | Dm | Dm Eb | Dm | Dm Eb | Bb | A"
VERSE = "Dm | Dm | Bb | Bb | Gm | Gm | A | A | Dm | Dm | Bb | Bb | Gm | Gm | Eb | A"
PRE = "Bb | C | Dm | Dm | Bb | C | Eb | A"
CHORUS = "Dm | C | Bb | A | Dm | C | Eb | A | Dm | C | Bb | A | Gm | Bb | Eb A | Dm"
THEME_H = "Dm | C | Bb Gm | A | Dm | C | Eb | Dm"
STRAIN_H = "Gm | Dm | Eb | A | Gm | Bb | Gm | A"
BREAK = "Dm | Dm | Bb | Bb | Gm | Gm | A | A"
SOLO = "Dm | Bb | C | Dm | Dm | Bb | C | A | Gm | Bb | C | Dm | Eb | C | Bb | Bb"

VERSE_MEL = (
    "D5:.5 F5:.5 A5:.5 D6:.5 C6:.5 A5:.5 F5:.5 A5:.5 | G5:.75 F5:.75 E5:.5 F5:1 D5:1 | "
    "D5:.5 F5:.5 Bb5:.5 D6:.5 C6:.5 Bb5:.5 F5:.5 Bb5:.5 | A5:.75 G5:.75 F5:.5 G5:1 D5:1 | "
    "D5:.5 G5:.5 Bb5:.5 D6:.5 C6:.5 Bb5:.5 G5:.5 Bb5:.5 | A5:.75 G5:.75 F5:.5 G5:2 | "
    "E5:.5 A5:.5 C#6:.5 E6:.5 D6:.5 C#6:.5 Bb5:.5 A5:.5 | G5:.75 F5:.75 E5:.5 C#5:2")
VERSE_END = "Eb5:.5 G5:.5 Bb5:.5 Eb6:.5 D6:.5 Bb5:.5 G5:.5 Bb5:.5 | A5:1 E5:.5 C#5:.5 A4:2"
PRE_MEL = "F5:2 D6:2 | E6:2 C6:2 | D6:2 A5:2 | F5:4 | F5:2 D6:2 | E6:2 G6:2 | G6:2 Bb6:2 | A6:4"
HOOK = (
    "D6:1.5 A5:.5 D6:1 E6:1 | F6:1.5 E6:.5 C6:1 G5:1 | D6:1.5 C6:.5 Bb5:1 F5:1 | E6:2 C#6:1 A5:1 | "
    "D6:1.5 A5:.5 D6:1 E6:1 | F6:1.5 G6:.5 E6:1 C6:1 | G6:1.5 F6:.5 Eb6:1 Bb5:1 | A5:2 C#6:1 E6:1 | "
    "F6:1.5 E6:.5 D6:1 A5:1 | G6:1.5 F6:.5 E6:1 C6:1 | F6:1.5 E6:.5 D6:1 Bb5:1 | C#6:2 E6:2 | "
    "D6:1.5 C6:.5 Bb5:1 G5:1 | F6:1.5 Eb6:.5 D6:1 Bb5:1")
HOOK_END = "G6:1 Eb6:1 E6:1 C#6:1 | D6:4"
HOOK2_END = "F6:1.5 Eb6:.5 D6:1 Bb5:1 | A5:2 C#6:1 E6:1"
HOOK_HEAD = "D6:1.5 A5:.5 D6:1 E6:1"
SOLO_MEL = (
    "F5:.25 A5:.25 D6:.25 A5:.25 F5:.25 D5:.25 A4:.25 D5:.25 F5:1 A5:1 | "
    "F5:.25 Bb5:.25 D6:.25 Bb5:.25 F5:.25 D5:.25 Bb4:.25 D5:.25 F5:1 Bb5:1 | "
    "C6:.25 E6:.25 C6:.25 G5:.25 E5:.25 G5:.25 C6:.25 G5:.25 E6:1 C6:1 | "
    "D6:.5 C6:.5 A5:.5 F5:.5 D6:2 | "
    "F5:.25 E5:.25 D5:.25 E5:.25 F5:.25 G5:.25 A5:.25 C6:.25 D6:2 | "
    "D6:.25 C6:.25 Bb5:.25 A5:.25 Bb5:.25 C6:.25 D6:.25 F5:.25 Bb5:2 | "
    "C6:.25 Bb5:.25 A5:.25 G5:.25 A5:.25 Bb5:.25 C6:.25 E6:.25 G5:2 | "
    "A5:.5 Bb5:.5 C#6:.5 E6:.5 C#6:1 A5:1 | "
    "G5:.25 Bb5:.25 D6:.25 Bb5:.25 G5:.25 D5:.25 G5:.25 Bb5:.25 D6:2 | "
    "F5:.25 Bb5:.25 D6:.25 Bb5:.25 F5:.25 D5:.25 F5:.25 Bb5:.25 D6:2 | "
    "E5:.25 G5:.25 C6:.25 G5:.25 E5:.25 C5:.25 E5:.25 G5:.25 C6:2 | "
    "D5:.25 F5:.25 A5:.25 F5:.25 D5:.25 A4:.25 D5:.25 F5:.25 A5:2 | "
    "Eb6:1.5 D6:.5 Bb5:1 G5:1 | E6:1.5 D6:.5 C6:1 G5:1 | "
    "D6:.5 C6:.5 Bb5:.5 A5:.5 Bb5:.5 C6:.5 D6:.5 E6:.5 | "
    "F5:.25 Bb5:.25 D6:.25 F5:.25 Bb5:.25 D6:.25 F5:.25 Bb5:.25 D6:2")

RIFF_332 = "XmmXmmXmXmmXmmXm"
HOOK_HITS = "X.....X.X...X..."
ACCENTS = "X..X..X.X..X..X."
HELD = "X-------x-----x-"
CHUG8 = "x.m.m.m.x.m.m.m."
BASS_16 = "RrrrRrrrRrrrRrrO"
BASS_332 = "R.rR.rR.R.rR.rO."


def band(s):
    """The parts every arcade track of the titan uses (stage 3 and the final minute)."""
    p = {}
    p["kit"] = Kit(s, gains={"kick": 0.5, "snare": 4.0, "hats": -4.0, "toms": 1.0, "cym": -1.0})
    p["bass"] = s.add("synth bass", "synth_bass", gain=1.0, role="bass")
    p["gl"] = s.add("guitar left", "dist_guitar", gain=-4.0, role="ostinato")
    p["gr"] = s.add("guitar right", "dist_guitar_r", gain=-4.0, tune=-7.0, role="ostinato")
    p["vln"] = s.add("violins sixteenths", "violins1_marc", gain=-5.0, role="ostinato")
    p["saw"] = s.add("saw lead", "saw_lead", gain=2.0, role="melody")
    p["sq"] = s.add("square lead, octave below", "square_lead", gain=-4.0, pan=-0.2, role="melody")
    p["brass"] = s.add("brass section", "brass_section", gain=1.0, role="melody")
    p["horns"] = s.add("horns", "horns", gain=-2.0, role="pad")
    p["sop"] = s.add("sopranos", "sopranos", gain=-1.0, role="choir")
    p["alt"] = s.add("altos", "altos", gain=-2.0, role="choir")
    p["ten"] = s.add("tenors", "tenors", gain=-1.0, role="choir")
    p["women"] = s.add("choir shouts, women", "women_hit", gain=-2.0, role="choir")
    p["men"] = s.add("choir shouts, men", "men_hit", gain=-2.0, role="choir")
    p["timp"] = s.add("timpani", "timpani", gain=0.0, role="perc")
    p["taiko"] = s.add("taiko", "taiko", gain=-1.0, role="perc")
    p["hit"] = s.add("orchestra hits", "orch_hit", gain=0.0, role="perc")
    p["fx"] = s.add("swells", "reverse_cymbal", gain=-4.0, role="perc")
    return p


def guitars(p, harm: Harmony, rhythm: str, vel: int) -> None:
    power(p["gl"], harm, rhythm, vel)
    power(p["gr"], harm, rhythm, vel - 4)


def shouts(p, harm: Harmony, rhythm: str, vel: int) -> None:
    stabs(p["women"], harm, rhythm, vel, lo="A3", hi="F5")
    stabs(p["men"], harm, rhythm, vel, lo="D3", hi="E4")


def hook_band(p, bar: int, harm: Harmony, tr: int, ending: str, *, scale: float = 1.0) -> None:
    """The chorus as the band, choir and orchestra play it: the hook's first 14 bars transposed
    by `tr`, then a written 2-bar ending (not transposed)."""
    kit = p["kit"]
    groove(kit, bar, 8, "double", fill="toms4", crash_every=2, scale=scale)
    groove(kit, bar + 8, 8, "double", fill="toms8", crash_every=2, scale=scale)
    bass(p["bass"], harm, BASS_16, 92, lo="C1")
    guitars(p, harm, HELD, 102)
    arp(p["vln"], harm, 86, lo="A4", n=3, shape="pattern:0102")
    for part, v, octave in ((p["saw"], 114, 0), (p["sq"], 104, -12), (p["brass"], 106, -12)):
        part.line(bar, HOOK, v, gate=0.94, tr=tr + octave)
        part.line(bar + 14, ending, v, gate=0.94, tr=octave)
    pad(p["horns"], harm, 92, lo="F3", hi="D5")
    pad(p["alt"], harm, 88, lo="A3", hi="D5", n=2)
    for b in range(bar, bar + 16, 4):
        # on the hook's own rhythm (long, short, long, long)
        hits(p["hit"], Harmony(b, harm.at(B(b))), HOOK_HITS, 112)
        hits(p["timp"], Harmony(b, harm.at(B(b))), HOOK_HITS, 108, lo="D2")
        shouts(p, Harmony(b + 2, harm.at(B(b + 2))), "X.....x.........", 106)


def build() -> Cue:
    cue = Cue("stage3", 112, loop=True, bpm=BPM, title="Colossus Overdrive (stage 3, the titan)",
              sections=[(1, "intro"), (9, "verse"), (25, "pre-chorus"), (33, "chorus"), (49, "theme"),
                        (57, "second strain"), (65, "breakdown"), (73, "solo"), (89, "chorus, E flat minor"),
                        (105, "outro")], target_lufs=-16.0)
    s = cue.stem("stage3")
    spb = cue.sec_per_beat
    p = band(s)
    kit = p["kit"]
    solo = s.add("guitar solo", "od_guitar", gain=1.0, role="melody")
    echo_p = s.add("echo", "saw_lead", gain=-3.0, pan=0.45, rev=0.35, role="melody")
    ooh = s.add("choir ooh", "women_ooh", gain=0.0, role="choir")

    # ---- intro and outro: the 3+3+2 riff ----------------------------------------------------------
    for bar in (1, 105):
        h = Harmony(bar, INTRO)
        for i in range(8):
            kit.bar(bar + i, kick="XxxxXxxxXxxxXxxx" if i >= 4 else "X..X..X.X..X..X.",
                    snare="....X.......X..." if i >= 4 else "......X.......X.",
                    hats="x.x.x.x.x.x.x.x.", cym="C......." if i % 4 == 0 else "")
        kit.bar(bar + 7, toms="............1234")
        bass(p["bass"], h, BASS_332, 96, lo="C1")
        guitars(p, h, RIFF_332, 104)
        hits(p["hit"], h, ACCENTS, 104)
        hits(p["timp"], h, "X..X..X.........", 104, lo="D2")
        shouts(p, Harmony(bar + 4, "Dm | Dm Eb | Bb | A"), ACCENTS, 100)
        stabs(p["brass"], Harmony(bar + 4, "Dm | Dm Eb | Bb | A"), ACCENTS, 100, lo="F4", hi="F5")
    swell(p["fx"], B(105), spb, vel=80)

    # ---- verse ------------------------------------------------------------------------------------
    hv = Harmony(9, VERSE)
    groove(kit, 9, 8, "rock", fill="toms4")
    groove(kit, 17, 8, "double", fill="toms8")
    bass(p["bass"], hv, BASS_16, 90, lo="C1")
    guitars(p, hv, CHUG8, 94)
    for part, v, octave in ((p["saw"], 104, 0), (p["sq"], 98, -12)):
        part.line(9, VERSE_MEL, v, gate=0.86, tr=octave)
        part.line(17, VERSE_MEL.rsplit(" | ", 2)[0], v, gate=0.86, tr=octave)
        part.line(23, VERSE_END, v, gate=0.86, tr=octave)
    pad(p["horns"], Harmony(17, "Dm | Dm | Bb | Bb | Gm | Gm | Eb | A"), 84, lo="F3", hi="D5")
    for b in (9, 13, 17, 21):
        hits(p["taiko"], Harmony(b, "Dm"), "X.....X.........", 100, lo="D3")

    # ---- pre-chorus -------------------------------------------------------------------------------
    hp = Harmony(25, PRE)
    groove(kit, 25, 4, "half", fill=None)
    groove(kit, 29, 2, "rock", fill=None)
    kit.bar(31, kick="XxXxXxXxXxXxXxXx", snare="X.x.X.x.X.x.X.x.", hats="x.x.x.x.x.x.x.x.")
    kit.roll(B(32), 4, 74, 124)
    kit.bar(32, kick="X...X...X...X...")
    swell(p["fx"], B(33), spb)
    bass(p["bass"], hp, "R-------R.r.R.r.", 92, lo="C1")
    guitars(p, hp, HELD, 92)
    p["saw"].line(25, PRE_MEL, 100, gate=0.96, cresc=(90, 116))
    pad(p["sop"], hp, 84, lo="D4", hi="A5", n=2)
    pad(p["ten"], hp, 84, lo="C3", hi="F4", n=2)
    arp(p["vln"], hp, 84, lo="A4", n=3, shape="pattern:0102")
    p["timp"].roll(B(31), 4, "Bb2", 60, 90, step=0.125, dur=0.2)
    p["timp"].roll(B(32), 4, "A2", 92, 118, step=0.125, dur=0.2)

    # ---- chorus -----------------------------------------------------------------------------------
    hook_band(p, 33, Harmony(33, CHORUS), 0, HOOK_END)
    pad(p["sop"], Harmony(33, CHORUS), 86, lo="D4", hi="A5", n=2)

    # ---- Gragnor's theme, then its second strain --------------------------------------------------
    ht = Harmony(49, THEME_H)
    hs = Harmony(57, STRAIN_H)
    groove(kit, 49, 8, "gallop", fill="toms8", crash_every=2)
    groove(kit, 57, 8, "rock", fill="toms8", crash_every=4)
    for h in (ht, hs):
        bass(p["bass"], h, BASS_332, 94, lo="C1")
    guitars(p, ht, "XmmXmmXmXmmXmmXm", 104)
    guitars(p, hs, HELD, 96)
    p["sop"].line(49, THEME, 100, gate=0.95)
    p["alt"].line(49, THEME, 96, gate=0.95)
    p["ten"].line(49, THEME, 98, gate=0.95, tr=-12)
    p["brass"].line(49, THEME, 108, gate=0.95)
    p["saw"].line(49, THEME, 106, gate=0.95, tr=12)
    hits(p["hit"], ht, "X...............", 110)
    hits(p["timp"], ht, "X.......X.......", 106, lo="D2")
    p["sop"].line(57, STRAIN_B, 98, gate=0.95)
    p["ten"].line(57, STRAIN_B, 94, gate=0.95, tr=-12)
    p["saw"].line(57, STRAIN_B, 100, gate=0.95, tr=12)
    p["horns"].line(57, STRAIN_B, 96, gate=0.95, tr=-12)
    arp(p["vln"], hs, 84, lo="A4", n=3, shape="pattern:0102")
    hits(p["timp"], hs, "X...............", 100, lo="D2")

    # ---- breakdown --------------------------------------------------------------------------------
    hb = Harmony(65, BREAK)
    for i in range(6):
        kit.bar(65 + i, kick="X.......X.......", toms="5..5..6.5..5.6.." if i % 2 == 0 else "5..5..6.5...1.2.",
                hats="o...o...o...o...", scale=0.9)
    hits(p["taiko"], Harmony(65, "Dm | Dm | Bb | Bb | Gm | Gm"), ACCENTS, 100, lo="D3")
    hits(p["timp"], Harmony(65, "Dm | Dm | Bb | Bb | Gm | Gm"), "X..X..X.........", 92, lo="D2")
    kit.bar(65, cym="C")
    kit.bar(71, kick="X.X.X.X.X.X.X.X.", snare="x.x.x.x.x.x.x.x.")
    kit.roll(B(72), 4, 76, 124)
    kit.bar(72, kick="X...X...X...X...")
    swell(p["fx"], B(73), spb)
    long_bass(p["bass"], hb, 92, lo="C1")
    pad(ooh, hb, 92, lo="A3", hi="E5")
    pad(p["horns"], hb, 82, lo="F3", hi="D5")
    for bar in (65, 67, 69):
        p["saw"].line(bar, HOOK_HEAD, 92, gate=0.9)
    echo(p["saw"], echo_p, delay=0.75, scale=0.55, start=B(65), end=B(71), repeats=3)
    arp(p["vln"], Harmony(69, "Gm | Gm | A | A"), 80, lo="A4", n=3, shape="pattern:0102")

    # ---- guitar solo ------------------------------------------------------------------------------
    hsolo = Harmony(73, SOLO)
    groove(kit, 73, 8, "rock", fill="toms8", crash_every=4)
    groove(kit, 81, 8, "double", fill="toms8", crash_every=4)
    bass(p["bass"], hsolo, BASS_332, 92, lo="C1")
    guitars(p, hsolo, CHUG8, 90)
    solo.line(73, SOLO_MEL, 106, gate=0.9)
    stabs(p["brass"], hsolo, ACCENTS, 88, lo="F4", hi="F5")
    pad(p["horns"], Harmony(81, "Gm | Bb | C | Dm | Eb | C | Bb | Bb"), 84, lo="F3", hi="D5")

    # ---- chorus in E flat minor ---------------------------------------------------------------------
    h2 = Harmony(89, CHORUS).shifted(1)
    h2.spans = [sp for sp in h2.spans if sp[0] < B(103)] + Harmony(103, "Bb | A").spans
    hook_band(p, 89, h2, 1, HOOK2_END)
    pad(p["sop"], h2, 88, lo="D4", hi="A5", n=2)
    return cue
