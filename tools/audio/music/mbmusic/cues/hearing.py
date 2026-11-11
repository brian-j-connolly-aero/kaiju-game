"""hearing: "For the Record", a somber, bureaucratic bed for the end-screen hearing. 12 bars, 30 s loop.

A passacaglia: the theme's own lament bass (D, C, B flat and G, A) goes round three times,
plucked, with a dry harpsichord keeping the minutes and a wood block for the clock on the wall.

    bars 1-4    English horn has the first half of the theme
    bars 5-8    bassoon takes it an octave down; clarinet adds a walking counter-line
    bars 9-12   violas and cellos in octaves, English horn above; stops on the dominant
"""
from ..orchestra import WOODBLOCK_HI, WOODBLOCK_LO
from ..score import B, Cue
from ..theme import A1, HARM_A, pad

GROUND = "D2:1 r:1 D2:1 r:.5 D2:.5 | C2:1 r:1 C2:1 r:.5 C2:.5 | Bb1:1 r:1 G1:1 r:.5 G1:.5 | A1:1 r:1 A1:1 r:.5 C#2:.5"
# harpsichord: a chord on beats 1 and 3 (left hand octave, right hand close), a lighter touch between
KEYS = ("D3+A3+D4+F4:1 r:.5 A3:.5 D3+A3+D4+F4:1 r:.5 F4:.5 | C3+G3+C4+E4:1 r:.5 G3:.5 C3+G3+C4+E4:1 r:.5 E4:.5 | "
        "Bb2+F3+Bb3+D4:1 r:.5 F3:.5 G2+G3+Bb3+D4:1 r:.5 D4:.5 | A2+E3+A3+C#4:1 r:.5 E3:.5 A2+G3+A3+C#4:1 r:.5 A3:.5")
COUNTER = ("r:1 A4:.5 G4:.5 F4:.5 E4:.5 F4:.5 A4:.5 | r:1 G4:.5 F4:.5 E4:.5 D4:.5 E4:.5 G4:.5 | "
           "r:1 D5:.5 C5:.5 Bb4:.5 A4:.5 Bb4:.5 D5:.5 | r:1 E5:.5 D5:.5 C#5:.5 B4:.5 C#5:1")
DESCANT = "A4:4_ | G4:2_ E4:2 | D5:2_ D5:2 | C#5:3 E5:1"


def build() -> Cue:
    cue = Cue("hearing", 12, loop=True, title="For the Record (somber, bureaucratic)", target_lufs=-18.0,
              sections=[(1, "English horn"), (5, "bassoon, clarinet counter-line"), (9, "strings; half close")])
    s = cue.stem("hearing")

    pz = s.add("basses pizz", "pizz_bass", gain=3.0, role="bass")
    pc = s.add("cellos pizz", "pizz_lo", gain=-1.0, role="bass")
    hp = s.add("harpsichord", "harpsichord", gain=2.0, role="pad")
    for bar in (1, 5, 9):
        pz.line(bar, GROUND, 84)
        if bar != 9:
            pc.line(bar, GROUND, 78, tr=12)
        hp.line(bar, KEYS, 76 if bar != 9 else 82, gate=0.7)

    eh = s.add("english horn", "english_horn", gain=8.0, role="melody")
    eh.line(1, A1, 86, gate=0.96)
    bn = s.add("bassoon", "bassoon", gain=4.0, role="melody")
    bn.line(5, A1, 86, tr=-12, gate=0.95)
    cl = s.add("clarinet", "clarinet", gain=1.0, role="melody")
    cl.line(5, COUNTER, 76, gate=0.9)
    va = s.add("violas", "violas", gain=4.0, role="melody")
    vc = s.add("cellos", "cellos", gain=5.0, role="melody")
    va.line(9, A1, 88, gate=0.98)
    vc.line(9, A1, 88, tr=-12, gate=0.98)
    eh.line(9, DESCANT, 76, gate=0.97)
    v2 = s.add("violins held", "violins2", gain=0.0, role="pad")
    pad(v2, 9, HARM_A[:8], (1,), 70)
    v2.expr([(B(9), 70), (B(12), 112), (B(13), 60)])

    wb = s.add("clock", "percussion", gain=0.0, rev=0.2, role="perc")
    for bar in range(1, 13):
        wb.note(B(bar, 1), WOODBLOCK_LO, 0.1, 68)                    # beats 1 and 3: tock
        wb.note(B(bar, 3), WOODBLOCK_LO, 0.1, 64)
        wb.note(B(bar, 2), WOODBLOCK_HI, 0.1, 58)                    # beats 2 and 4: tick
        wb.note(B(bar, 4), WOODBLOCK_HI, 0.1, 58)
    return cue
