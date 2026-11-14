"""The two endings. Both are one-shots built on the head motif.

win_humans: "Port Meridian Stands". The head motif turned to D major as a trumpet fanfare,
            closing B flat, C, D major (the lament bass run upwards). 5 bars and ring-out.
win_kaiju:  "The City Falls Silent". The head motif and the theme's last two bars (the
            flat-second close) for the whole choir, low brass, organ pedal and a tolling bell.
"""
from ..orchestra import BASS_DRUM, CRASH, SNARE, SNARE_ALT
from ..patterns import swell_into
from ..score import B, Cue, pitch

P = pitch


def build_humans() -> Cue:
    cue = Cue("win_humans", 5, loop=False, title="Port Meridian Stands (fanfare)", tail_seconds=2.0,
              sections=[(1, "head motif in D major"), (3, "B flat, C"), (4, "D major")])
    s = cue.stem("win_humans")
    tune = ("D5:1.5 D5:.5 F#5:2 | E5:1.5 D5:.5 A4:1 A4:1/3 A4:1/3 A4:1/3 | "
            "D5:1/3 D5:1/3 D5:1/3 D5:1 E5:1/3 E5:1/3 E5:1/3 E5:1 | F#5:6.5")
    second = ("A4:1.5 A4:.5 D5:2 | C#5:1.5 A4:.5 E4:1 E4:1/3 E4:1/3 E4:1/3 | "
              "Bb4:1/3 Bb4:1/3 Bb4:1/3 Bb4:1 C5:1/3 C5:1/3 C5:1/3 C5:1 | D5:6.5")
    tp1 = s.add("trumpets 1", "trumpets", gain=1.0, pan=0.14, role="melody")
    tp2 = s.add("trumpets 2", "trumpets", gain=-0.5, pan=0.26, role="melody")
    tp1.line(1, tune, 110, gate=0.9)
    tp2.line(1, second, 106, gate=0.9)
    hn = s.add("horns", "horns", gain=2.0, role="melody")
    hn.line(1, "D4:1.5 D4:.5 F#4:2 | E4:1.5 D4:.5 A3:2 | F4:2 G4:2 | A4:6.5", 110, gate=0.95)
    v1 = s.add("violins 1", "violins1", gain=3.0, role="melody")
    v1.line(1, "D5:1.5 D5:.5 F#5:2 | E5:1.5 D5:.5 A5:2 | Bb5:2 C6:2 | D6:6.5", 110, gate=0.98)
    vt = s.add("violins tremolo", "violins_trem", gain=-3.0, role="pad")
    vt.line(1, "F#5+A5:4 | E5+A5:4 | F5+Bb5:2 E5+G5:2 | F#5+A5:6.5", 100, gate=0.99)
    va = s.add("violas", "violas", gain=0.0, role="pad")
    va.line(1, "A3+D4:4 | A3+C#4:4 | Bb3+D4:2 C4+E4:2 | A3+D4:6.5", 96, gate=0.99)
    tb = s.add("trombones", "trombones", gain=1.0, role="pad")
    tb.line(1, "D3+A3+D4:4 | A2+E3+A3:4 | Bb2+F3+Bb3:2 C3+G3+C4:2 | D3+A3+D4:6.5", 104, gate=0.95)
    tb.expr([(0, 110), (12, 104), (13, 90), (17, 127)])
    for name, inst, gain, tr in (("basses", "basses", 3.0, 0), ("cellos", "cellos_marc", 1.0, 12),
                                 ("tuba", "tuba", 0.0, 0)):
        part = s.add(name, inst, gain=gain, role="bass")
        part.line(1, "D2:1 D2:.5 D2:.5 D2:1 D2:1 | A1:1 A1:.5 A1:.5 A1:1 A1:1 | "
                     "Bb1:1 Bb1:1 C2:1 C2:1 | D2:6.5", 106, tr=tr, gate=0.85)
    women = s.add("women", "sopranos", gain=1.0, role="pad")
    men = s.add("men", "tenors", gain=1.0, role="pad")
    alt = s.add("altos", "altos", gain=1.0, role="pad")
    women.line(4, "F#5:6.5", 110, gate=0.98)
    alt.line(4, "A4+D5:6.5", 108, gate=0.98)
    men.line(4, "D3+A3+F#4:6.5", 108, gate=0.98)
    for part in (women, alt, men, vt, v1):
        part.expr([(0, 118), (12, 112), (13.5, 96), (17.5, 127)])

    tm = s.add("timpani", "timpani", gain=0.0, role="perc")
    tm.line(1, "D3:1> A2:.5 A2:.5 D3:1 A2:1 | A2:1> A2:.5 A2:.5 A2:1 A2:1/3 A2:1/3 A2:1/3 | "
               "Bb2:1> Bb2:1/3 Bb2:1/3 Bb2:1/3 C3:1> C3:1/3 C3:1/3 C3:1/3", 108)
    tm.note(B(4), P("D2"), 1.0, 122)
    tm.roll(B(4, 2), 5.4, "D2", 64, 108, step=0.125, dur=0.5, curve=0.8)
    sn = s.add("snare", "snare", gain=1.0, role="perc")
    sn.hits(1, "X.gxX.ggX.gxXgxx", SNARE)
    sn.hits(2, "X.gxX.ggX...", SNARE)
    sn.roll(B(2, 4), 1.0, SNARE, 60, 110, alt=SNARE_ALT)
    sn.hits(3, "X..XxxX.X..XxxXx", SNARE)
    sn.note(B(4), SNARE, 0.2, 124)
    sn.roll(B(4, 2), 5.4, SNARE, 60, 112, curve=0.8, alt=SNARE_ALT)
    bd = s.add("bass drum", "bass_drum", gain=2.0, role="perc")
    for t, v in ((B(1), 118), (B(2), 100), (B(3), 104), (B(3, 3), 104), (B(4), 124)):
        bd.note(t, BASS_DRUM, 0.6, v)
    cy = s.add("cymbals", "cymbals", gain=2.0, role="perc")
    cy.note(B(1), CRASH, 4.0, 112)
    cy.note(B(4), CRASH, 6.0, 124)
    rc = s.add("cymbal swell", "reverse_cymbal", gain=2.0, role="perc")
    swell_into(rc, B(4), 110)
    bell = s.add("tubular bells", "tubular_bells", gain=2.0, role="perc")
    bell.line(4, "D5:1 A4:1 F#5:1 D5:1 | A4:1 D5:1.5", 106)
    gl = s.add("glockenspiel", "glockenspiel", gain=1.0, role="perc")
    gl.line(4, "F#6:.5 A6:.5 D7:1 r:2 | F#6:.5 A6:.5 D7:1.5", 96)
    return cue


def build_kaiju() -> Cue:
    cue = Cue("win_kaiju", 5, loop=False, title="The City Falls Silent (ominous choir)", tail_seconds=2.4,
              sections=[(1, "head motif, men"), (3, "flat-second close, full choir"), (4, "D minor")])
    s = cue.stem("win_kaiju")
    tune = "D4:1.5 D4:.5 F4:2 | E4:1.5 D4:.5 C4:2 | G4:1.5 F4:.5 Eb4:2 | D4:6"
    ten = s.add("tenors", "tenors", gain=2.0, role="melody")
    chb = s.add("choir basses", "choir_basses", gain=2.0, role="melody")
    men = s.add("men ooh", "men_ooh", gain=0.0, role="melody")
    for part in (ten, chb, men):
        part.line(1, tune, 106, tr=-12, gate=0.98)
    sop = s.add("sopranos", "sopranos", gain=2.0, role="melody")
    alt = s.add("altos", "altos", gain=2.0, role="melody")
    sop.line(3, "G4:1.5 F4:.5 Eb4:2 | D4+A4:6", 108, gate=0.98)
    alt.line(3, "Bb3:2 A3:2 | A3+F4:6", 104, gate=0.98)        # altos: harmony under the close
    for part in (ten, chb, men, sop, alt):
        part.expr([(0, 104), (8, 112), (12, 127), (14, 110), (17.9, 127)])
    tb = s.add("trombones", "trombones", gain=4.0, role="melody")
    tb.line(1, tune, 108, tr=-12, gate=0.95)
    hn = s.add("horns", "horns", gain=1.0, role="pad")
    hn.line(3, "Eb4+G4:2 C#4+G4:2 | D4+F4:6", 100, gate=0.97)
    for name, inst, gain in (("basses", "basses", 4.0), ("tuba", "tuba", 1.0)):
        part = s.add(name, inst, gain=gain, role="bass")
        part.line(1, "D2:4_ | C2:4_ | Eb2:2_ A1:2 | D2:6", 104, gate=0.98)
    org = s.add("organ pedal", "organ_pedal", gain=0.0, role="bass")
    org.line(1, "D1:4_ | C1:4_ | Eb1:2_ A1:2 | D1:6", 104, gate=0.98)
    vt = s.add("cellos tremolo", "cellos_trem", gain=2.0, role="pad")
    vt.line(1, "D3+A3:4_ | C3+G3:4_ | Eb3+Bb3:2_ A2+G3:2_ | D3+A3:6", 92, gate=0.99)
    vv = s.add("violas tremolo", "violas_trem", gain=1.0, role="pad")
    vv.line(1, "A3+D4:4_ | G3+E4:4_ | Bb3+Eb4:2_ C#4+G4:2_ | A3+D4:6", 88, gate=0.99)
    for part in (vt, vv):
        part.expr([(0, 90), (8, 104), (12, 124), (14, 104), (17.9, 127)])

    bell = s.add("church bell", "church_bell", gain=-1.0, role="perc")
    for bar in (1, 4, 5):                                   # not on the E flat chord of bar 3
        bell.note(B(bar), P("D3"), 8.0 if bar != 5 else 3.5, 108 if bar != 5 else 96)
    tub = s.add("tubular bells", "tubular_bells", gain=1.0, role="perc")
    tub.note(B(4), P("D4"), 6.0, 104)
    tub.note(B(5), P("A4"), 4.0, 90)
    tm = s.add("timpani", "timpani", gain=0.0, role="perc")
    tm.line(1, "D2:1.5> D2:.5 D2:2 | C3:1.5> C3:.5 C3:2 | Eb3:1.5> Eb3:.5 A2:1 A2:1/3 A2:1/3 A2:1/3", 104)
    tm.note(B(4), P("D2"), 1.0, 124)
    tm.roll(B(4, 2), 4.8, "D2", 56, 120, step=0.125, dur=0.5, curve=1.2)
    bd = s.add("bass drum", "bass_drum", gain=3.0, role="perc")
    for t, v in ((B(1), 112), (B(2), 96), (B(3), 104), (B(3, 3), 104), (B(4), 124)):
        bd.note(t, BASS_DRUM, 0.8, v)
    cy = s.add("cymbals", "cymbals", gain=0.0, role="perc")
    cy.note(B(4), CRASH, 6.0, 104)
    rc = s.add("cymbal swell", "reverse_cymbal", gain=1.0, role="perc")
    swell_into(rc, B(4), 100)
    return cue


def build_all() -> list[Cue]:
    return [build_humans(), build_kaiju()]
