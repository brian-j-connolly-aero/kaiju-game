"""stage2: "Steel Against Scale" (the juvenile). 32 bars, 80 s loop, base and combat stems.

Full and driving. The whole theme is stated for the first time in the match.

    bars  1-8   theme in the horns over galloping low strings
    bars  9-16  theme in the violins and high woodwind; the choir enters under it (women, "ooh")
    bars 17-24  second strain sung by the women with the violins, men and horns in harmony, building
    bars 25-32  theme, full: choir in octaves, horns, violins; low brass under it

Base stem: bass, galloping strings, harmony, the tune and the choir.
Combat stem: snare, bass drum, taiko, timpani, cymbals; trumpets and trombones answering each
bar of the theme with its own rhythm; short choir shouts on the strong bars.
"""
from ..orchestra import BASS_DRUM, CRASH, SNARE, SNARE_ALT, TAIKO_LONG
from ..patterns import bass, drive_bass, gallop, octaves, pluck_roots, pulse, stab, swell_into, voice, voices
from ..score import B, Cue, pitch
from ..theme import B1, HARM_A, HARM_B, STRAIN_B, THEME, pad, sustain

P = pitch
# trumpets (two parts) and trombones answer the theme on beats 3 and 4: "da-da-DUM"
ANSWER = {  # bar of the theme -> (trumpet 1, trumpet 2, trombone pair)
    1: ("A4", "F4", ("D3", "A3")), 2: ("G4", "E4", ("C3", "G3")), 3: ("Bb4", "G4", ("G2", "D3")),
    4: ("A4", "E4", ("A2", "E3")), 5: ("A4", "F4", ("D3", "A3")), 6: ("G4", "E4", ("C3", "G3")),
    7: ("A4", "G4", ("A2", "G3")),
}
ANSWER_TOP = {1: "D5", 2: "C5", 3: "D5", 4: "C#5", 5: "D5", 6: "C5", 7: "C#5"}
ANSWER_TOP2 = {1: "A4", 2: "G4", 3: "Bb4", 4: "A4", 5: "A4", 6: "G4", 7: "A4"}


def build() -> Cue:
    cue = Cue("stage2", 32, loop=True, group="stage2", title="Steel Against Scale (stage 2, the juvenile)",
              sections=[(1, "theme, horns"), (9, "theme, violins; choir enters"),
                        (17, "second strain, building"), (25, "theme, full")], target_lufs=-15.5)
    base = cue.stem("stage2_base")
    combat = cue.stem("stage2_combat")
    A_BARS = (1, 9, 25)

    # =========================== base ===========================================================
    # ---- bass and the gallop ------------------------------------------------------------------
    # The bowed basses play in octaves where the lower one is on the instrument (C1 and up), and
    # half of the section plucks each root an octave below: the sampled bowed bass has no
    # fundamental below A1, the plucked one does, and stage 2 should not be lighter at the bottom
    # than stage 1.
    cb = base.add("basses", "basses", gain=5.0, sub=4.0, role="bass")
    pb = base.add("basses pizz", "pizz_bass", gain=1.0, role="bass")
    vc = base.add("cellos gallop", "cellos_marc", gain=1.0, role="ostinato")
    va = base.add("violas gallop", "violas_marc", gain=-1.0, role="ostinato")
    for bar, v in ((1, 98), (9, 100), (25, 106)):
        drive_bass(cb, bar, octaves(bass(HARM_A, -1)), v)
        pluck_roots(pb, bar, bass(HARM_A, -1), v)
        gallop(vc, bar, bass(HARM_A), v - 4)
        gallop(va, bar, voice(HARM_A, 0), v - 10, alt=voice(HARM_A, 1))
    # second strain: four bars held back (long bass notes, plain eighths), then the gallop returns
    cb.line(17, "G1:4_ | F1:4_ | Eb1+Eb2:4_ | A1:4", 92, gate=0.97)
    pb.line(17, "G1:4 | F1:4 | Eb1:4 | A1:4", 88, gate=0.5)
    pulse(vc, 17, bass(HARM_B)[:8], 78, accent=10)
    pulse(va, 17, voice(HARM_B, 0)[:8], 72, accent=8)
    drive_bass(cb, 21, bass(HARM_B, -1)[8:], 96, cresc=(92, 108))
    pluck_roots(pb, 21, bass(HARM_B, -1)[8:], 96, cresc=(92, 108))
    gallop(vc, 21, bass(HARM_B)[8:], 92, cresc=(86, 104))
    gallop(va, 21, voice(HARM_B, 0)[8:], 84, alt=voice(HARM_B, 1)[8:], cresc=(80, 98))
    tuba = base.add("tuba", "tuba", gain=-1.0, role="bass")
    sustain(tuba, 25, bass(HARM_A, -1), 96, rearticulate=4, gate=0.9)

    # ---- harmony --------------------------------------------------------------------------------
    v2 = base.add("violins 2", "violins2", gain=-1.0, role="pad")
    pad(v2, 1, HARM_A, (1, 2), 72)
    v2m = base.add("violins 2 sixteenths", "violins2_marc", gain=-3.0, role="ostinato")
    pulse(v2m, 9, voices(HARM_A, (1, 2)), 78, step=0.25, dur=0.16, accent=14, every=4)
    pad(v2, 17, HARM_B, (2,), 84, cresc=(78, 98))
    pulse(v2m, 21, voices(HARM_B, (1, 2))[8:], 80, step=0.25, dur=0.16, accent=14, every=4, cresc=(74, 96))
    pulse(v2m, 25, voices(HARM_A, (1, 2), 12), 84, step=0.25, dur=0.16, accent=14, every=4)

    hn = base.add("horns", "horns", gain=3.0, role="melody")
    hn.line(1, THEME, 108, gate=0.95)
    sustain(hn, 9, voice(HARM_A, 0), 88, rearticulate=4, gate=0.94)          # the tenor line
    sustain(hn, 17, voice(HARM_B, 1), 84, rearticulate=4, gate=0.94, cresc=(80, 100))
    hn.line(25, THEME, 110, gate=0.95)
    tb = base.add("trombones", "trombones", gain=0.0, role="pad")
    tb.line(23, "G2+D3+G3:4 | A2+E3+A3:4", 84)
    tb.line(25, "D3+A3+D4:4 | C3+G3+C4:4 | Bb2+F3+Bb3:2 G2+D3+G3:2 | A2+E3+A3:4 | "
                "D3+A3+D4:4 | C3+G3+C4:4 | Eb3+Bb3+Eb4:2 A2+G3+A3:2 | D3+A3+D4:4", 92, gate=0.94)
    tb.expr([(B(1), 110), (B(23), 76), (B(25), 124)])

    # ---- the tune above --------------------------------------------------------------------------
    v1 = base.add("violins 1", "violins1", gain=3.0, role="melody")
    fl = base.add("flute", "flute", gain=-3.0, role="melody")
    ob = base.add("oboe", "oboe", gain=-3.0, role="melody")
    v1.line(9, THEME, 100, tr=12, gate=0.98)
    fl.line(9, THEME, 92, tr=12, gate=0.95)
    ob.line(9, THEME, 86, gate=0.95)
    v1.line(17, STRAIN_B, 98, gate=0.98, cresc=(92, 110))
    fl.line(17, STRAIN_B, 88, tr=12, gate=0.95, cresc=(84, 98))
    v1.line(25, THEME, 106, tr=12, gate=0.98)
    fl.line(25, THEME, 100, tr=12, gate=0.95)
    ob.line(25, THEME, 94, tr=12, gate=0.95)

    # ---- the choir enters ------------------------------------------------------------------------
    wo = base.add("women ooh", "women_ooh", gain=5.0, role="pad")
    pad(wo, 9, HARM_A, (1, 2), 84, rearticulate=4, gate=0.96)
    wo.expr([(B(9), 60), (B(11), 110), (B(13), 96), (B(15), 124), (B(17), 100)])
    sop = base.add("sopranos", "sopranos", gain=1.0, role="melody")
    alt = base.add("altos", "altos", gain=0.0, role="melody")
    ten = base.add("tenors", "tenors", gain=0.0, role="pad")
    chb = base.add("choir basses", "choir_basses", gain=0.0, role="pad")
    sop.line(17, STRAIN_B, 94, gate=0.97, cresc=(88, 108))
    # the altos sing the strain with the sopranos, then drop to harmony where it climbs past them
    alt.line(17, B1 + " | Bb4:1.5 A4:.5 G4:2 | F4:1.5 F4:.5 F4:2 | G4:1.5 G4:.5 G4:2 | E4:1.5 E4:.5 G4:2",
             94, gate=0.97, cresc=(88, 108))
    for part in (sop, alt):
        part.line(25, THEME, 102, gate=0.97)
    sustain(ten, 17, voice(HARM_B, 0), 90, rearticulate=4, gate=0.95, cresc=(84, 102))
    sustain(chb, 17, bass(HARM_B), 90, rearticulate=4, gate=0.95, cresc=(84, 102))
    for part in (ten, chb):
        part.line(25, THEME, 102, tr=-12, gate=0.97)

    # =========================== combat =========================================================
    # ---- drums -------------------------------------------------------------------------------------
    sn = combat.add("snare", "snare", gain=2.0, role="perc")
    groove = "X.ggx.ggX.ggx.gg"
    fill = "X.ggx.ggXxXxXXXX"
    for bar in range(1, 33):
        section_end = bar % 8 == 0
        pat = fill if bar % 4 == 0 and not section_end else groove
        if 17 <= bar <= 20:
            pat = "X.g.x.ggX.g.x.gg"                   # held back with the strings, but still a pulse
        if section_end:
            pat = groove[:8] + "x.gg...."
            sn.roll(B(bar, 4), 1.0, SNARE, 52, 118, curve=1.3, alt=SNARE_ALT)
        sn.hits(bar, pat, SNARE)
    sn.notes = [(st, d, SNARE_ALT if (i % 3 == 1 and v < 80) else p, v)
                for i, (st, d, p, v) in enumerate(sorted(sn.notes))]

    bd = combat.add("bass drum", "bass_drum", gain=2.0, role="perc")
    tk = combat.add("taiko", "percussion", gain=2.0, role="perc")
    for bar in range(1, 33):
        quiet = 17 <= bar <= 20
        bd.hits(bar, "X.......x......." if quiet else "X.......x.....o.", BASS_DRUM, dur=0.5)
        if quiet:
            tk.note(B(bar), TAIKO_LONG, 1.0, 92)       # a reduced pulse: the fight does not stop
            continue
        tk.note(B(bar), TAIKO_LONG, 1.0, 108 if bar % 2 else 92)
        if bar % 2 == 0:
            tk.hits(bar, "..........x.x...", TAIKO_LONG, dur=0.5)

    tm = combat.add("timpani", "timpani", gain=2.0, role="perc")
    TIMP = {"D": "D2", "C": "C3", "Bb": "Bb2", "G": "G2", "A": "A2", "Eb": "Eb3", "F": "F2"}

    def timp(bar: int, harm: list, vel: int) -> None:
        for i in range(8):
            r1 = TIMP[harm[2 * i][0][:-1]]
            r2 = TIMP[harm[2 * i + 1][0][:-1]]
            b = bar + i
            if i in (3, 7):                               # phrase ends: a triplet run-up
                tm.line(b, f"{r1}:1> r:.5 {r1}:.5 {r2}:1 {r2}:1/3 {r2}:1/3 {r2}:1/3", vel)
            else:
                tm.line(b, f"{r1}:1> r:.5 {r1}:.5 {r2}:1 r:.5 {r2}:.25 {r2}:.25", vel)
    timp(1, HARM_A, 94)
    timp(9, HARM_A, 98)
    tm.line(17, "G2:1> r:1 G2:1 r:1 | F2:1> r:1 F2:1 r:1 | Eb3:1> r:1 Eb3:1 r:1 | A2:1> r:1 A2:1 A2:.5 A2:.5", 104)
    tm.line(21, "G2:1> r:.5 G2:.5 G2:1 r:.5 G2:.25 G2:.25 | Bb2:1> r:.5 Bb2:.5 Bb2:1 r:.5 Bb2:.25 Bb2:.25 | "
                "G2:1> r:.5 G2:.5 G2:1 r:.5 G2:.25 G2:.25", 98)
    tm.note(B(24), P("A2"), 0.9, 108)
    tm.roll(B(24, 2), 3.0, "A2", 56, 116, step=0.125, dur=0.5, curve=1.4)
    timp(25, HARM_A, 106)

    cy = combat.add("cymbals", "cymbals", gain=3.0, role="perc")
    rc = combat.add("cymbal swell", "reverse_cymbal", gain=2.0, role="perc")
    for bar, v in ((1, 104), (9, 100), (17, 84), (25, 112)):
        cy.note(B(bar), CRASH, 4.0, v)
        swell_into(rc, B(bar) if bar > 1 else B(33), 96 if bar != 17 else 80)

    # ---- brass: a stab on the downbeat, then the answer on beats 3 and 4 ------------------------
    tp1 = combat.add("trumpets 1", "trumpets", gain=-3.0, pan=0.14, role="melody")
    tp2 = combat.add("trumpets 2", "trumpets", gain=-4.5, pan=0.26, role="melody")
    tbs = combat.add("trombones", "trombones", gain=1.0, role="melody")
    for first in A_BARS:
        loud = {1: 100, 9: 104, 25: 112}[first]
        for i in range(1, 8):
            a, b2, low = ANSWER[i]
            bar = first + i - 1
            t = B(bar, 3)
            for part, lo, hi in ((tp1, a, ANSWER_TOP[i]), (tp2, b2, ANSWER_TOP2[i])):
                part.note(t, P(lo), 0.3, loud - 8)
                part.note(t + 0.5, P(lo), 0.3, loud - 4)
                part.note(t + 1, P(hi), 0.85, loud + 6)
            for k, (dt, d, dv) in enumerate(((0, 0.3, -8), (0.5, 0.3, -4), (1, 0.85, 6))):
                stab(tbs, t + dt, [P(n) for n in low], loud + dv, d)
            if i in (1, 5):                               # phrase starts: a short tutti chord
                stab(tbs, B(bar), [P("D3"), P("A3"), P("D4")], loud + 8, 0.5)
                stab(tp1, B(bar), [P("D5")], loud + 6, 0.5)
                stab(tp2, B(bar), [P("A4")], loud + 4, 0.5)
        # last bar of the theme: the head motif's rhythm on the tonic
        for part, n in ((tp1, "D5"), (tp2, "A4")):
            part.line(first + 7, f"{n}:1.5> {n}:.5 {n}:2", loud + 4, gate=0.8)
        tbs.line(first + 7, "D3+A3:1.5> D3+A3:.5 D3+A3:2", loud + 4, gate=0.8)
    # second strain: trombone stabs on the downbeats, then syncopated trumpets as it builds
    for i, (r, f) in enumerate((("G2", "D3"), ("F2", "F3"), ("Eb3", "Bb3"), ("A2", "E3"),
                                ("G2", "D3"), ("Bb2", "F3"), ("G2", "D3"), ("A2", "E3"))):
        stab(tbs, B(17 + i), [P(r), P(f)], (98 if i < 4 else 92) + 2 * i, 0.5)
        if i < 4:                                         # the held-back bars: a second, softer stab
            stab(tbs, B(17 + i, 3), [P(r), P(f)], 90 + 2 * i, 0.4)
    for i, (n1, n2) in enumerate((("D5", "Bb4"), ("D5", "Bb4"), ("E5", "Bb4"), ("E5", "C#5"))):
        for beat in (2.5, 4.5):
            stab(tp1, B(21 + i, beat), [P(n1)], 96 + 4 * i, 0.3)
            stab(tp2, B(21 + i, beat), [P(n2)], 92 + 4 * i, 0.3)

    # ---- choir shouts on the strong bars ----------------------------------------------------------
    wh = combat.add("women shout", "women_hit", gain=0.0, role="choir")
    mh = combat.add("men shout", "men_hit", gain=0.0, role="choir")
    for first, bars, v in ((1, (0, 4), 96), (9, (0, 2, 4, 6), 100), (25, (0, 1, 2, 3, 4, 5, 6), 110)):
        for i in bars:
            hb = 2 * i
            stab(wh, B(first + i), voices(HARM_A, (0, 1, 2))[hb], v, 0.7)
            root = bass(HARM_A)[hb]
            stab(mh, B(first + i), [root, root + 7], v, 0.7)
    for i in (4, 6):
        stab(wh, B(17 + i), voices(HARM_B, (0, 1, 2))[2 * i], 100, 0.7)
        root = bass(HARM_B)[2 * i]
        stab(mh, B(17 + i), [root, root + 7], 100, 0.7)
    return cue
