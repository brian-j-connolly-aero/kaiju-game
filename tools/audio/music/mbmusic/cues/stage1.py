"""stage1: "Hatchling on Main Street" (stage 1, the hatchling). 150 beats per minute, 96 bars,
153.6 s loop. D minor, the last chorus a tone up in E minor.

Late-1990s arcade cabinet style, the lightest of the three stages: a funky slap bass, a rock kit,
a bright square-wave lead, synth brass stabs, a polysynth arpeggio and orchestra hits on the
hook. One bar is 1.6 s (70560 samples).

    bars  1-8   intro: the groove (1-4), then the riff on the square lead (5-8)
    bars  9-24  verse: the square lead, answered by brass stabs
    bars 25-32  pre-chorus: long rising notes on the saw lead, half-time drums, a snare build
    bars 33-48  chorus: the hook (dotted 3+3+2 rhythm) on saw lead, doubled below, orchestra hits
    bars 49-56  breakdown: the game's own theme (Gragnor's head motif) with a tape echo, then a build
    bars 57-72  solo: overdrive guitar, sixteenth runs and sweeps; ends on D major to lift the key
    bars 73-88  chorus a tone up (E minor), everything in; turns back through C and A
    bars 89-96  outro: the riff twice, a tom fill into bar 1
"""
from ..arcade import Harmony, Kit, arp, bass, echo, groove, hits, long_bass, pad, stabs, swell
from ..score import B, Cue

BPM = 150

INTRO = "Dm | Dm | Bb | C | Dm | Dm | Bb | C A"
VERSE = "Dm | C | Bb | A | Dm | C | Bb | C | Dm | C | Bb | A | Gm | Bb | C | A"
PRE = "Gm | Gm | Bb | Bb | Eb | Eb | A | A"
CHORUS = "Dm | Bb | F | C | Dm | Bb | Gm | A | Dm | Bb | F | C | Dm | Bb | Gm | A"
BREAK = "Dm | C | Bb | A | Dm | C | Gm | A"
SOLO = "Dm | C | Bb | C | Dm | C | Bb | A | Dm | F | G | Bb | Gm | Bb | C | D"
CHORUS2 = "Em | C | G | D | Em | C | Am | B | Em | C | G | D | Em | C | C | A"

RIFF = ("D5:.75 D5:.25 F5:.5 D5:.5 A5:.75 G5:.25 F5:.5 E5:.5 | D5:.5 C5:.5 D5:.5 F5:.5 E5:.75 C5:.25 A4:1 | "
        "Bb4:.75 Bb4:.25 D5:.5 Bb4:.5 F5:.75 Eb5:.25 D5:.5 C5:.5 | C5:.5 E5:.5 G5:.5 E5:.5 C#5:.5 E5:.5 A5:1")
VERSE_MEL = (
    "A4:.5 A4:.5 D5:.75 A4:.25 C5:.5 D5:1.5 | C5:.5 Bb4:.5 A4:.5 G4:.5 E4:2 | "
    "F4:.5 Bb4:.5 D5:.75 Bb4:.25 C5:.5 D5:1.5 | E5:.5 D5:.5 C#5:.5 A4:.5 E4:2 | "
    "A4:.5 A4:.5 D5:.75 A4:.25 C5:.5 D5:.5 F5:1 | E5:.75 D5:.25 C5:.5 D5:.5 E5:2 | "
    "F5:.5 E5:.5 D5:.5 Bb4:.5 C5:.75 D5:.25 Bb4:1 | C5:.5 G4:.5 C5:.5 E5:.5 G5:2 | "
    "F5:.75 E5:.25 D5:.5 A4:.5 D5:.5 E5:.5 F5:1 | G5:.75 F5:.25 E5:.5 C5:.5 E5:2 | "
    "D5:.75 C5:.25 Bb4:.5 F4:.5 Bb4:.5 C5:.5 D5:1 | E5:.75 D5:.25 C#5:.5 A4:.5 E5:2 | "
    "G5:.5 F5:.5 D5:.5 Bb4:.5 D5:.5 G5:.5 F5:.5 D5:.5 | F5:.5 D5:.5 Bb4:.5 F4:.5 Bb4:.5 D5:.5 F5:.5 Bb5:.5 | "
    "G5:.5 E5:.5 C5:.5 G4:.5 C5:.5 E5:.5 G5:.5 C6:.5 | A5:2 E5:.5 C#5:.5 A4:1")
PRE_MEL = ("D5:3 C5:.5 D5:.5 | Bb4:2 G4:2 | F5:3 Eb5:.5 F5:.5 | D5:2 Bb4:2 | G5:3 F5:.5 G5:.5 | Bb5:2 G5:2 | "
           "A5:4 | A5:1 G5:.5 A5:.5 C#6:1 E6:1")
# the hook, one bar per cell: the dotted 3+3+2 rhythm, then a long note
H_A = "D5:.75 E5:.75 F5:.5 A5:1.5 F5:.5"          # over D minor
H_B1 = "G5:.75 F5:.75 D5:.5 F5:2"                  # B flat
H_C = "C5:.75 D5:.75 F5:.5 A5:1.5 C6:.5"           # F
H_D1 = "Bb5:.75 A5:.75 G5:.5 E5:2"                 # C
H_B2 = "G5:.75 F5:.75 D5:.5 Bb5:1.5 A5:.5"         # B flat
H_E = "G5:.75 A5:.75 Bb5:.5 D6:1.5 C6:.5"          # G minor
H_F = "Bb5:.75 A5:.75 G5:.5 A5:2"                  # A (the flat ninth: the monster's cadence)
H_F_END = "A5:1.5 G5:.5 F5:.5 E5:.5 C#5:.5 A4:.5"  # A, falling into the breakdown
HOOK_1 = " | ".join([H_A, H_B1, H_C, H_D1])
HOOK_2 = " | ".join([H_A, H_B2, H_E, H_F])
THEME = ("D5:1.5 D5:.5 F5:2 | E5:1.5 D5:.5 C5:2 | F5:1.5 F5:.5 Bb5:2 | A5:1.5 G5:.5 E5:2 | "
         "D5:1.5 D5:.5 F5:2 | E5:1.5 D5:.5 C5:2 | G5:1.5 F5:.5 D5:2 | E5:2 C#5:2")
SOLO_MEL = (
    "D5:.25 E5:.25 F5:.25 A5:.25 D6:1 C6:.25 A5:.25 F5:.25 E5:.25 D5:1 | "
    "E5:.25 G5:.25 C6:.25 E6:.25 D6:.5 C6:.5 G5:1 E5:1 | "
    "F5:.25 G5:.25 A5:.25 Bb5:.25 D6:.5 Bb5:.5 F5:.5 D5:.5 F5:1 | "
    "G5:.5 A5:.5 Bb5:.5 C6:.5 E6:2 | "
    "D6:.75 C6:.25 A5:.5 F5:.5 D5:.5 F5:.5 A5:1 | "
    "G5:.25 A5:.25 G5:.25 E5:.25 C5:.5 E5:.5 G5:2 | "
    "F5:.25 G5:.25 F5:.25 D5:.25 Bb4:.5 D5:.5 F5:.5 G5:.5 A5:1 | "
    "Bb5:.5 A5:.5 G5:.5 F5:.5 E5:.5 D5:.5 C#5:1 | "
    "D5:.25 F5:.25 A5:.25 D6:.25 A5:.25 F5:.25 D5:.25 A4:.25 D5:2 | "
    "C5:.25 F5:.25 A5:.25 C6:.25 A5:.25 F5:.25 C5:.25 A4:.25 C5:2 | "
    "D5:.25 G5:.25 B5:.25 D6:.25 B5:.25 G5:.25 D5:.25 B4:.25 D5:2 | "
    "D5:.25 F5:.25 Bb5:.25 D6:.25 Bb5:.25 F5:.25 D5:.25 Bb4:.25 D5:2 | "
    "G5:.5 Bb5:.5 D6:.5 Bb5:.5 G5:.5 D5:.5 Bb4:1 | "
    "F5:.5 Bb5:.5 D6:.5 Bb5:.5 F5:.5 D5:.5 Bb4:1 | "
    "E5:.25 F5:.25 G5:.25 A5:.25 Bb5:.25 C6:.25 D6:.25 E6:.25 C6:2 | "
    "D6:2 A5:.5 F#5:.5 D5:.5 E5:.5")
CHORUS2_TURN = "E6:.75 D6:.75 C6:.5 G5:1.5 E5:.5 | C#6:.75 B5:.75 A5:.5 E5:.5 C#5:.5 A4:1"

SLAP_GROOVE = "R..rO.rgR.r.O.rg"
SLAP_BUSY = "R.rRO.rRR.rRO.rO"
SLAP_EIGHTHS = "R.r.R.r.O.r.R.r."
SLAP_SOLO = "R..rO..rR.rO.r.F"
SUB = "R-------R-------"


def build() -> Cue:
    cue = Cue("stage1", 96, loop=True, bpm=BPM, title="Hatchling on Main Street (stage 1, the hatchling)",
              sections=[(1, "intro"), (9, "verse"), (25, "pre-chorus"), (33, "chorus"),
                        (49, "breakdown"), (57, "solo"), (73, "chorus, E minor"), (89, "outro")], target_lufs=-17.0)
    s = cue.stem("stage1")
    spb = cue.sec_per_beat
    kit = Kit(s, gains={"kick": 1.0, "snare": 4.0, "hats": -4.0, "toms": 0.0, "cym": -2.0})
    slap = s.add("slap bass", "slap_bass", gain=2.0, role="bass")
    sub = s.add("sub bass", "synth_bass", gain=-5.0, role="bass")
    arps = s.add("arpeggio", "polysynth", gain=-8.0, role="ostinato")
    strings = s.add("synth strings", "synth_strings", gain=-8.0, role="pad")
    brass = s.add("synth brass", "synth_brass", gain=-2.0, role="pad")
    lead = s.add("square lead", "square_lead", gain=4.0, role="melody")
    saw = s.add("saw lead", "saw_lead", gain=2.0, role="melody")
    saw_lo = s.add("saw lead, octave below", "square_lead", gain=-5.0, pan=-0.2, role="melody")
    gtr = s.add("guitar solo", "od_guitar", gain=1.0, role="melody")
    echo_p = s.add("echo", "square_lead", gain=0.0, pan=-0.45, rev=0.35, role="melody")
    hit = s.add("orchestra hits", "orch_hit", gain=1.0, role="perc")
    fx = s.add("swells", "reverse_cymbal", gain=-4.0, role="perc")

    # ---- intro and outro (the same 8 bars) ------------------------------------------------------
    for bar in (1, 89):
        h = Harmony(bar, INTRO)
        groove(kit, bar, 4, "rock", fill="toms4", every=4)
        groove(kit, bar + 4, 4, "rock2", fill="toms8", every=4)
        bass(slap, h, SLAP_GROOVE, 92)
        arp(arps, h, 84, lo="A4")
        stabs(brass, Harmony(bar, "Dm | Dm | Bb | C"), "X..X..X.....X.x.", 96, lo="A3", hi="F5")
        hits(hit, Harmony(bar, "Dm"), "X...............", 110)
        lead.line(bar + 4, RIFF, 100, gate=0.85)
    saw.line(93, RIFF, 104, gate=0.85, tr=12)            # the second time round, an octave up
    stabs(brass, Harmony(93, "Dm | Dm | Bb | C A"), "X.......X.......", 90, lo="A3", hi="F5")

    # ---- verse ----------------------------------------------------------------------------------
    hv = Harmony(9, VERSE)
    groove(kit, 9, 8, "rock2", fill="flam")
    groove(kit, 17, 8, "rock2", fill="toms8")
    bass(slap, hv, SLAP_GROOVE, 92)
    lead.line(9, VERSE_MEL, 98, gate=0.88)
    for bar in (10, 12, 14, 18, 20):
        stabs(brass, Harmony(bar, hv.at(B(bar))), "........X..X.x..", 100, lo="A3", hi="F5")
    pad(strings, Harmony(17, "Dm | C | Bb | A | Gm | Bb | C | A"), 78, lo="A3", hi="E5")
    arp(arps, Harmony(17, "Dm | C | Bb | A | Gm | Bb | C | A"), 70, lo="A4", shape="updown")

    # ---- pre-chorus -----------------------------------------------------------------------------
    hp = Harmony(25, PRE)
    groove(kit, 25, 4, "half", fill=None)
    groove(kit, 29, 2, "rock", fill=None, crash=True)
    kit.bar(31, kick="X...X...X...X...", snare="X...X...X...X...", hats="x.x.x.x.x.x.x.x.")
    kit.roll(B(32), 4, 70, 120)
    kit.bar(32, kick="X...X...X...X...")
    swell(fx, B(33), spb)
    bass(slap, hp, SLAP_EIGHTHS, 90)
    saw.line(25, PRE_MEL, 100, gate=0.95, cresc=(92, 112))
    pad(strings, hp, 84, lo="A3", hi="E5")
    arp(arps, hp, 76, lo="A4", shape="up")

    # ---- chorus ---------------------------------------------------------------------------------
    def chorus(bar: int, harm: Harmony, last_line: str, tr: int = 0) -> None:
        groove(kit, bar, 8, "drive", fill="toms4", crash_every=4)
        groove(kit, bar + 8, 8, "drive", fill="toms8", crash_every=4)
        bass(slap, harm, SLAP_BUSY, 96)
        bass(sub, harm, SUB, 92, lo="C1", gate=0.95)
        arp(arps, harm, 84, lo="A4")
        stabs(brass, harm, "X------.......x.", 100, lo="A3", hi="F5")
        pad(strings, harm, 82, lo="A3", hi="E5")
        for b in (bar, bar + 4, bar + 8, bar + 12):
            hits(hit, Harmony(b, harm.at(B(b))), "X..X..X.........", 112)
        hits(hit, Harmony(bar + 7, harm.at(B(bar + 7))), "X..X..X.X.......", 104)
        saw.line(bar, " | ".join([HOOK_1, HOOK_2, HOOK_1]) + " | " + last_line, 112, gate=0.92, tr=tr)
        saw_lo.line(bar, " | ".join([HOOK_1, HOOK_2, HOOK_1]) + " | " + last_line, 104, gate=0.92, tr=tr - 12)

    chorus(33, Harmony(33, CHORUS), HOOK_2.rsplit(" | ", 1)[0] + " | " + H_F_END)

    # ---- breakdown: the theme, with a dotted-eighth echo ----------------------------------------
    hb = Harmony(49, BREAK)
    groove(kit, 49, 4, "sparse", fill=None, crash=True)
    groove(kit, 53, 2, "pulse", fill=None, crash=False)
    kit.bar(55, kick="X...X...X...X...", snare="x.x.x.x.x.x.x.x.", scale=0.85)
    kit.roll(B(56), 4, 76, 122)
    kit.bar(56, kick="X...X...X...X...")
    swell(fx, B(57), spb)
    long_bass(sub, hb, 90, lo="C1")
    long_bass(slap, hb, 84, lo="A1")
    pad(strings, hb, 88, lo="A3", hi="E5")
    lead.line(49, THEME, 92, gate=0.9)
    echo(lead, echo_p, delay=0.75, scale=0.55, start=B(49), end=B(57), repeats=2)
    arp(arps, Harmony(53, "Dm | C | Gm | A"), 72, lo="A4", shape="updown")

    # ---- guitar solo ----------------------------------------------------------------------------
    hs = Harmony(57, SOLO)
    for i in range(15):
        kit.bar(57 + i, kick="X.....x.X.x....." if i % 2 == 0 else "X.x...x.X...x...",
                snare="....X.......X..g" if i != 7 else "....X.......X...",
                cym="R.R.R.R.R.R.R.R." if i < 8 else "B.R.B.R.B.R.B.R.")
    kit.bar(57, cym="C")
    kit.bar(65, cym="C")
    kit.bar(64, toms="............1234")
    kit.bar(72, kick="X.....x.........", snare="X.x.X.x.........", cym="R.R.R.R.........",
            toms="........11223456")
    bass(slap, hs, SLAP_SOLO, 92)
    gtr.line(57, SOLO_MEL, 104, gate=0.9)
    stabs(brass, hs, "X.....X.....X...", 88, lo="A3", hi="F5")
    pad(strings, Harmony(65, "Dm | F | G | Bb | Gm | Bb | C | D"), 78, lo="A3", hi="E5")

    # ---- chorus in E minor ----------------------------------------------------------------------
    h2 = Harmony(73, CHORUS2)
    chorus(73, h2, H_A + " | " + H_B2, tr=2)
    saw.line(87, CHORUS2_TURN, 112, gate=0.92)
    saw_lo.line(87, CHORUS2_TURN, 104, gate=0.92, tr=-12)

    # ---- the whole loop: a swell into the outro, which leads back to bar 1 ----------------------
    swell(fx, B(89), spb, vel=80)
    return cue


