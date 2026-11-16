"""stage2: "Steel Rain" (stage 2, the juvenile). 160 beats per minute, 104 bars, 156 s loop.
D minor, the last chorus a tone up in E minor.

Heavier than stage 1: two distorted guitars (left and right) on power chords and a galloping
palm-muted chug, a synth bass in octaves, the rock kit on four-on-the-floor and backbeat
grooves, the orchestra's marcato violins and timpani, choir shouts and orchestra hits, a
fifth-saw verse lead and a saw lead with the real brass section under it for the hook. One bar
is 1.5 s (66150 samples).

    bars   1-8    intro: the gallop riff, then the synth riff on top (5-8)
    bars   9-24   verse: fifth-saw lead over palm-muted guitars, brass answers
    bars  25-32   pre-chorus: rising long notes, violins in sixteenths, half-time into a snare build
    bars  33-48   chorus: the hook on saw lead with brass section, choir shouts, orchestra hits
    bars  49-56   Gragnor's theme (the game's own), whole, as a heavy riff over a galloping kick
    bars  57-64   breakdown: toms and timpani, choir "ooh", the hook's first bar echoing, a build
    bars  65-80   solos traded between saw lead and fifth saw, then both in thirds; ends on D major
    bars  81-96   chorus a tone up (E minor); it turns back through B flat and A
    bars  97-104  outro: the intro again, leading back to bar 1
"""
from ..arcade import Harmony, Kit, arp, bass, echo, groove, hits, long_bass, pad, power, stabs, swell
from ..score import B, Cue
from ..theme import THEME

BPM = 160

INTRO = "Dm | Bb C | Dm | Bb A | Dm | Bb C | Dm | Bb A"
VERSE = "Dm | Dm | F | C | Dm | Dm | Bb | A | Dm | Dm | F | C | Gm | Bb | Asus4 | A"
PRE = "Bb | C | Dm | F | Gm | Bb | A | A"
CHORUS = "Dm | C | Bb | C | Dm | C | Bb | A | Dm | C | Bb | C | Gm | Bb | A | A"
THEME_H = "Dm | C | Bb Gm | A | Dm | C | Eb | Dm"
BREAK = "Dm | Dm | Bb | Bb | Gm | Gm | A | A"
SOLO = "Dm | Bb | C | A | Dm | Bb | C | A | Gm | Dm | Gm | Dm | Bb | Bb | C | D"
CHORUS2 = "Em | D | C | D | Em | D | C | B | Em | D | C | D | Am | C | Bb | A"

SYNTH_RIFF = ("A5:.5 A5:.25 A5:.25 G5:.5 A5:.5 C6:.5 A5:.5 G5:.5 F5:.5 | G5:.5 F5:.5 D5:1 E5:.5 F5:.5 G5:1 | "
              "A5:.5 A5:.25 A5:.25 G5:.5 A5:.5 D6:.5 C6:.5 A5:.5 F5:.5 | G5:.5 F5:.5 D5:1 C#5:.5 D5:.5 E5:1")
VERSE_MEL = (
    "D5:.5 D5:.5 F5:.5 D5:.5 A5:1 G5:.5 F5:.5 | E5:.5 F5:.5 D5:1 r:2 | "
    "C5:.5 C5:.5 F5:.5 C5:.5 A5:1 G5:.5 F5:.5 | G5:1 E5:.5 C5:.5 r:2 | "
    "D5:.5 D5:.5 F5:.5 D5:.5 A5:1 Bb5:.5 A5:.5 | G5:.5 F5:.5 E5:.5 F5:.5 D5:2 | "
    "F5:.5 F5:.5 Bb5:.5 F5:.5 D6:1 C6:.5 Bb5:.5 | A5:1 E5:1 C#5:1 r:1 | "
    "D5:.5 D5:.5 F5:.5 D5:.5 A5:1 G5:.5 F5:.5 | E5:.5 F5:.5 D5:1 r:2 | "
    "C5:.5 C5:.5 F5:.5 C5:.5 A5:1 G5:.5 F5:.5 | G5:1 E5:.5 C5:.5 r:2 | "
    "Bb5:.5 A5:.5 G5:.5 F5:.5 G5:1 D5:1 | F5:.5 E5:.5 D5:.5 C5:.5 D5:1 Bb4:1 | "
    "D5:1 E5:.5 D5:.5 E5:2 | C#5:1 E5:1 A5:2")
PRE_MEL = "F5:2 D5:2 | E5:2 G5:2 | F5:2 A5:2 | C6:4 | Bb5:2 G5:2 | D6:2 F5:2 | E5:2 C#6:2 | E6:4"
HOOK = (
    "A5:1 A5:.5 G5:.5 A5:1 D6:1 | C6:1.5 Bb5:.5 A5:1 G5:1 | F5:1 F5:.5 E5:.5 F5:1 Bb5:1 | A5:1.5 G5:.5 E5:2 | "
    "A5:1 A5:.5 G5:.5 A5:1 D6:1 | E6:1.5 D6:.5 C6:1 G5:1 | F5:1 G5:.5 A5:.5 Bb5:1 D6:1 | C#6:1.5 A5:.5 E5:2 | "
    "A5:1 A5:.5 G5:.5 A5:1 D6:1 | C6:1.5 Bb5:.5 A5:1 G5:1 | F5:1 F5:.5 E5:.5 F5:1 Bb5:1 | A5:1.5 Bb5:.5 C6:2")
HOOK_END = "D6:1.5 C6:.5 Bb5:1 A5:1 | Bb5:1.5 A5:.5 G5:1 F5:1 | E5:1.5 F5:.5 G5:1 A5:1 | A5:2 C#6:1 E6:1"
HOOK2_END = "E6:1.5 D6:.5 C6:1 B5:1 | C6:1.5 B5:.5 A5:1 G5:1 | F5:1.5 G5:.5 A5:1 Bb5:1 | A5:2 C#6:1 E6:1"
HOOK_HEAD = "A5:1 A5:.5 G5:.5 A5:1 D6:1"
SOLO_A = ("D5:.25 F5:.25 A5:.25 D6:.25 C6:.5 A5:.5 Bb5:.5 A5:.5 G5:.5 F5:.5 | "
          "F5:.25 G5:.25 A5:.25 Bb5:.25 D6:1 F6:1 D6:1 | E6:.5 D6:.5 C6:.5 G5:.5 E5:.5 G5:.5 C6:1 | "
          "C#6:.5 E6:.5 C#6:.5 A5:.5 E5:.5 A5:.5 C#6:1")
SOLO_B = ("A5:.5 G5:.5 F5:.5 E5:.5 D5:1 A4:1 | Bb4:.5 C5:.5 D5:.5 F5:.5 Bb5:2 | "
          "C6:.5 Bb5:.5 A5:.5 G5:.5 E5:1 C5:1 | E5:.5 F5:.5 G5:.5 A5:.5 C#6:2")
SOLO_C = ("G5:.25 A5:.25 Bb5:.25 D6:.25 G6:1 F6:.5 D6:.5 Bb5:1 | A5:.25 Bb5:.25 A5:.25 F5:.25 D5:.5 F5:.5 A5:1 D6:1 | "
          "Bb5:.5 D6:.5 G6:.5 D6:.5 Bb5:.5 G5:.5 D5:1 | F5:.5 A5:.5 D6:.5 A5:.5 F5:.5 D5:.5 A4:1")
SOLO_D_HI = "D6:.5 C6:.5 Bb5:.5 C6:.5 D6:1 F6:1 | D6:4 | E6:.5 D6:.5 C6:.5 D6:.5 E6:1 G6:1 | F#6:2 A5:.5 D6:.5 F#6:.5 A6:.5"
SOLO_D_LO = "Bb5:.5 A5:.5 G5:.5 A5:.5 Bb5:1 D6:1 | Bb5:4 | C6:.5 Bb5:.5 A5:.5 Bb5:.5 C6:1 E6:1 | D6:2 F#5:.5 A5:.5 D6:.5 F#6:.5"

GALLOP = "X.mmX.mmX.mmX.mm"
CHUG = "X.m.m.m.x.m.m.m."
HELD = "X-------x-----x-"
BASS_OCT = "R.o.r.o.R.o.r.o."
BASS_16 = "RrrrOrrrRrrrOrrr"
BASS_GALLOP = "R.rrR.rrR.rrO.rr"


def build() -> Cue:
    cue = Cue("stage2", 104, loop=True, bpm=BPM, title="Steel Rain (stage 2, the juvenile)",
              sections=[(1, "intro"), (9, "verse"), (25, "pre-chorus"), (33, "chorus"), (49, "theme"),
                        (57, "breakdown"), (65, "solos"), (81, "chorus, E minor"), (97, "outro")],
              target_lufs=-16.5)
    s = cue.stem("stage2")
    spb = cue.sec_per_beat
    kit = Kit(s, gains={"kick": 1.5, "snare": 4.0, "hats": -4.0, "toms": 1.0, "cym": -2.0})
    bs = s.add("synth bass", "synth_bass2", gain=4.0, role="bass")
    gl = s.add("guitar left", "dist_guitar", gain=-4.0, role="ostinato")
    gr = s.add("guitar right", "dist_guitar_r", gain=-4.0, tune=-7.0, role="ostinato")
    vln = s.add("violins sixteenths", "violins1_marc", gain=-4.0, role="ostinato")
    strings = s.add("synth strings", "synth_strings", gain=-9.0, role="pad")
    sbrass = s.add("synth brass", "synth_brass2", gain=-3.0, role="pad")
    brass = s.add("brass section", "brass_section", gain=1.0, role="melody")
    lead = s.add("fifth-saw lead", "fifth_saw", gain=5.0, role="melody")
    saw = s.add("saw lead", "saw_lead", gain=2.0, role="melody")
    echo_p = s.add("echo", "saw_lead", gain=-3.0, pan=0.45, rev=0.35, role="melody")
    women = s.add("choir shouts, women", "women_hit", gain=-2.0, role="choir")
    men = s.add("choir shouts, men", "men_hit", gain=-2.0, role="choir")
    ooh = s.add("choir ooh", "women_ooh", gain=0.0, role="choir")
    timp = s.add("timpani", "timpani", gain=-1.0, role="perc")
    hit = s.add("orchestra hits", "orch_hit", gain=0.0, role="perc")
    fx = s.add("swells", "reverse_cymbal", gain=-4.0, role="perc")

    def guitars(harm: Harmony, rhythm: str, vel: int) -> None:
        power(gl, harm, rhythm, vel)
        power(gr, harm, rhythm, vel - 4)

    # ---- intro and outro ------------------------------------------------------------------------
    for bar in (1, 97):
        h = Harmony(bar, INTRO)
        groove(kit, bar, 4, "drive", fill="snare16", every=4)
        groove(kit, bar + 4, 4, "drive2", fill="toms8", every=4, crash=True)
        bass(bs, h, BASS_GALLOP, 96, lo="C1")
        guitars(h, GALLOP, 100)
        hits(hit, Harmony(bar, "Dm"), "X...............", 112)
        hits(timp, Harmony(bar, INTRO.split(" | ", 4)[4]), "X..X..X.........", 104, lo="D2")
        lead.line(bar + 4, SYNTH_RIFF, 102, gate=0.85)
        arp(vln, Harmony(bar + 4, INTRO.split(" | ", 4)[4]), 84, lo="A4", n=3, shape="pattern:0102")
    swell(fx, B(97), spb, vel=80)

    # ---- verse ----------------------------------------------------------------------------------
    hv = Harmony(9, VERSE)
    groove(kit, 9, 8, "drive2", fill="flam")
    groove(kit, 17, 8, "drive", fill="toms8")
    bass(bs, hv, BASS_OCT, 94, lo="C1")
    guitars(hv, CHUG, 92)
    lead.line(9, VERSE_MEL, 100, gate=0.86)
    for bar in (10, 12, 18, 20):
        stabs(sbrass, Harmony(bar, hv.at(B(bar))), "........X.X.X...", 104, lo="A3", hi="F5")
    pad(strings, Harmony(17, "Dm | Dm | F | C | Gm | Bb | Asus4 | A"), 80, lo="A3", hi="E5")

    # ---- pre-chorus -----------------------------------------------------------------------------
    hp = Harmony(25, PRE)
    groove(kit, 25, 4, "half", fill=None)
    groove(kit, 29, 2, "rock", fill=None)
    kit.bar(31, kick="X.X.X.X.X.X.X.X.", snare="X.x.X.x.X.x.X.x.", hats="x.x.x.x.x.x.x.x.")
    kit.roll(B(32), 4, 72, 122)
    kit.bar(32, kick="X...X...X...X...")
    swell(fx, B(33), spb)
    bass(bs, hp, "R-------R.r.R.r.", 92, lo="C1")
    guitars(hp, HELD, 90)
    saw.line(25, PRE_MEL, 98, gate=0.96, cresc=(90, 112))
    arp(vln, hp, 84, lo="A4", n=3, shape="pattern:0102")
    pad(strings, hp, 84, lo="A3", hi="E5")
    timp.roll(B(31), 8, "A2", 60, 112, step=0.125, dur=0.2)

    # ---- chorus ---------------------------------------------------------------------------------
    def chorus(bar: int, harm: Harmony, tr: int, ending: str) -> None:
        """16 bars: the hook's first 12 bars (transposed by tr) and a written ending."""
        groove(kit, bar, 8, "rock2", fill="toms4", crash_every=4)
        groove(kit, bar + 8, 8, "rock2", fill="toms8", crash_every=4)
        bass(bs, harm, BASS_16, 92, lo="C1")
        guitars(harm, HELD, 100)
        arp(vln, harm, 86, lo="A4", n=3, shape="pattern:0102")
        pad(strings, harm, 84, lo="A3", hi="E5")
        for part, v, octave in ((saw, 112, 0), (brass, 104, -12)):
            part.line(bar, HOOK, v, gate=0.94, tr=tr + octave)
            part.line(bar + 12, ending, v, gate=0.94, tr=octave)
        for b in range(bar, bar + 16, 2):
            stabs(women, Harmony(b, harm.at(B(b))), "X.....x.........", 104, lo="A3", hi="F5")
            stabs(men, Harmony(b, harm.at(B(b))), "X.....x.........", 104, lo="D3", hi="E4")
        for b in (bar, bar + 4, bar + 8, bar + 12):
            hits(hit, Harmony(b, harm.at(B(b))), "X.......", 112)
            hits(timp, Harmony(b, harm.at(B(b))), "X.....x.", 108, lo="D2")

    chorus(33, Harmony(33, CHORUS), 0, HOOK_END)

    # ---- Gragnor's theme, heavy -----------------------------------------------------------------
    ht = Harmony(49, THEME_H)
    for i in range(8):
        kit.bar(49 + i, kick="X.xxX.xxX.xxX.xx", snare="....X.......X...", hats="x.x.x.x.x.x.x.x.",
                cym="C......." if i % 2 == 0 else "")
    kit.bar(56, toms="........11223456")
    bass(bs, ht, BASS_GALLOP, 96, lo="C1")
    guitars(ht, GALLOP, 104)
    saw.line(49, THEME, 110, gate=0.95, tr=12)
    brass.line(49, THEME, 108, gate=0.95)
    lead.line(49, THEME, 92, gate=0.95, tr=12)
    hits(hit, ht, "X...............", 108)
    hits(timp, ht, "X.......X.......", 104, lo="D2")
    pad(strings, ht, 82, lo="A3", hi="E5")

    # ---- breakdown ------------------------------------------------------------------------------
    hb = Harmony(57, BREAK)
    for i in range(6):
        kit.bar(57 + i, kick="X.......X.......", hats="o...o...o...o...",
                toms="5..5..6.5..5.6.." if i % 2 == 0 else "5..5..6.5...1.2.", scale=0.9)
    hits(timp, Harmony(57, "Dm | Dm | Bb | Bb | Gm | Gm"), "X.....X.....X...", 92, lo="D2")
    kit.bar(57, cym="C")
    kit.bar(63, kick="X...X...X...X...", snare="x.x.x.x.x.x.x.x.")
    kit.roll(B(64), 4, 74, 122)
    kit.bar(64, kick="X...X...X...X...")
    swell(fx, B(65), spb)
    long_bass(bs, hb, 92, lo="C1")
    pad(ooh, hb, 90, lo="A3", hi="E5")
    pad(strings, hb, 80, lo="A3", hi="E5")
    for bar in (57, 59, 61):
        saw.line(bar, HOOK_HEAD, 92, gate=0.9)
    echo(saw, echo_p, delay=0.75, scale=0.55, start=B(57), end=B(63), repeats=3)
    arp(vln, Harmony(61, "Gm | Gm | A | A"), 80, lo="A4", n=3, shape="pattern:0102")

    # ---- solos ----------------------------------------------------------------------------------
    hs = Harmony(65, SOLO)
    groove(kit, 65, 8, "break", fill="toms8")
    groove(kit, 73, 8, "rock", fill="toms8")
    bass(bs, hs, BASS_OCT, 94, lo="C1")
    guitars(Harmony(65, "Dm | Bb | C | A | Dm | Bb | C | A"), CHUG, 90)
    guitars(Harmony(73, "Gm | Dm | Gm | Dm | Bb | Bb | C | D"), HELD, 94)
    saw.line(65, SOLO_A, 108, gate=0.9)
    lead.line(69, SOLO_B, 104, gate=0.9)
    saw.line(73, SOLO_C, 108, gate=0.9)
    saw.line(77, SOLO_D_HI, 108, gate=0.92)
    lead.line(77, SOLO_D_LO, 100, gate=0.92)
    stabs(sbrass, hs, "X.....X.....X...", 92, lo="A3", hi="F5")

    # ---- chorus in E minor ----------------------------------------------------------------------
    chorus(81, Harmony(81, CHORUS2), 2, HOOK2_END)
    return cue
