"""lobby: "The Long Watch", a brooding march. 32 bars, 80 s loop.

    bars  1-4   vamp: pizzicato march bass, soft field drum, a held D with the violas on the
                fifth above it, sighing up to B flat; the theme's rhythm as a timpani signal
    bars  5-12  the theme, low and plain: horns, cellos and bassoon in unison over the bass
    bars 13-20  second strain: violins and clarinet, warm string harmony, drums swell back in
    bars 21-28  the theme, tutti: trumpets, horns and men's voices, tremolo violins, low brass
    bars 29-32  codetta: the head motif echoed by clarinet and bassoon, winding down to the vamp
"""
from ..orchestra import BASS_DRUM, CRASH, SNARE, SNARE_ALT
from ..score import B, Cue, pitch
from ..theme import A2, HARM_A, HARM_B, HEAD, STRAIN_B, THEME, harm_voice, pad

VAMP_BASS = ("D2:1 r:1 A1:1 r:1 | D2:1 r:1 A1:1 r:.5 A1:.5 | D2:1 r:1 A1:1 r:1 | "
             "D2:1 r:1 A1:1 r:.5 A1:.5")
MARCH_BASS = ("D2:1 r:1 A1:1 r:.5 D2:.5 | C2:1 r:1 G1:1 r:.5 C2:.5 | Bb1:1 r:1 G1:1 r:.5 G1:.5 | "
              "A1:1 r:1 E2:1 r:.5 C#2:.5 | D2:1 r:1 A1:1 r:.5 D2:.5 | C2:1 r:1 G1:1 r:.5 D2:.5 | "
              "Eb2:1 r:1 A1:1 r:.5 C#2:.5 | D2:1 r:1 A1:1 r:1")
# heavier version for the tutti: bowed, with a push on the off-beats
TUTTI_BASS = ("D2:1 r:.5 D2:.5 A1:1 r:.5 D2:.5 | C2:1 r:.5 C2:.5 G1:1 r:.5 C2:.5 | "
              "Bb1:1 r:.5 Bb1:.5 G1:1 r:.5 G1:.5 | A1:1 r:.5 A1:.5 A1:1 A1:.5 C#2:.5 | "
              "D2:1 r:.5 D2:.5 A1:1 r:.5 D2:.5 | C2:1 r:.5 C2:.5 G1:1 r:.5 D2:.5 | "
              "Eb2:1 r:.5 Eb2:.5 A1:1 A1:.5 C#2:.5 | D2:2 A1:1 D2:1")
# low brass under the tutti: open fifths and octaves; the A7 flat 5 gets root and seventh only
LOW_BRASS = ("D3+A3+D4:4 | C3+G3+C4:4 | Bb2+F3+Bb3:2 G2+D3+G3:2 | A2+E3+A3:4 | "
             "D3+A3+D4:4 | C3+G3+C4:4 | Eb3+Bb3+Eb4:2 A2+G3+A3:2 | D3+A3+D4:4")


def build() -> Cue:
    cue = Cue("lobby", 32, loop=True, title="The Long Watch (brooding march)",
              sections=[(1, "vamp"), (5, "theme, low"), (13, "second strain"),
                        (21, "theme, tutti"), (29, "codetta")])
    s = cue.stem("lobby")

    # ---- march bass: plucked basses with cellos an octave above ---------------------------
    pz_b = s.add("basses pizz", "pizz_bass", gain=2.0, role="bass")
    pz_c = s.add("cellos pizz", "pizz_lo", gain=-1.0, role="bass")
    for part, tr in ((pz_b, 0), (pz_c, 12)):
        part.line(1, VAMP_BASS, 86, tr=tr)
        part.line(5, MARCH_BASS, 84, tr=tr)
        part.line(29, VAMP_BASS, 84, tr=tr, cresc=(86, 76))
    # second strain: bowed basses, an octave higher than the march so the texture lightens
    ba = s.add("basses", "basses", gain=3.0, role="bass")
    ba.line(13, "G2:4_ | F2:4_ | Eb2:4_ | A2:4 | G2:4_ | Bb2:4_ | G2:4_ | A2:3 A2:1>", 84,
            cresc=(80, 98))
    ba.line(21, TUTTI_BASS, 104, gate=0.8)
    ce_t = s.add("cellos tutti", "cellos_marc", gain=1.0, role="bass")
    ce_t.line(21, TUTTI_BASS, 102, tr=12, gate=0.8)
    tuba = s.add("tuba", "tuba", gain=0.0, role="bass")
    tuba.line(21, TUTTI_BASS, 96, gate=0.85)

    # ---- held D under the vamp; the violas supply the fifth above it and sigh up to B flat.
    # (The cellos do not hold the A as well: a suspension must not sound against its own
    # resolution in the same octave.)
    vc_p = s.add("cellos pedal", "cellos", gain=9.5, role="pad")
    for bar in (1, 29):
        vc_p.line(bar, "D3:8_ D3:8_", 78)
    vc_p.expr([(B(1), 84), (B(3), 112), (B(5), 78), (B(29), 90), (B(31), 116), (B(33), 84)])
    va_s = s.add("violas sigh", "violas", gain=6.5, role="pad")
    for bar in (1, 29):
        va_s.line(bar, "A3:4_ | Bb3:2_ A3:2_ | A3:4_ | Bb3:3_ A3:1", 70, gate=1.0)
    va_s.expr([(B(1), 80), (B(2), 110), (B(3), 84), (B(4), 116), (B(5), 70),
               (B(29), 80), (B(30), 108), (B(31), 84), (B(32), 110), (B(33), 80)])
    # a high dominant pedal over the low theme
    hi = s.add("violins pedal", "violins1", gain=4.0, role="pad")
    hi.line(5, "A5:16_ A5:16_", 62)
    hi.expr([(B(5), 60), (B(8), 104), (B(9), 84), (B(12), 112), (B(13), 60)])

    # ---- the theme, low: horns, cellos and bassoon in unison --------------------------------
    hn = s.add("horns", "horns", gain=1.0, role="melody")
    hn.line(5, THEME, 92, tr=-12, gate=0.95)
    vc = s.add("cellos", "cellos", gain=4.0, role="melody")
    vc.line(5, THEME, 92, tr=-12, gate=0.97)
    bn = s.add("bassoon", "bassoon", gain=2.0, role="melody")
    bn.line(5, THEME, 84, tr=-12, gate=0.93)

    # ---- second strain: violins with clarinet, violas an octave below, string harmony -----
    v1 = s.add("violins 1", "violins1", gain=4.0, role="melody")
    v1.line(13, STRAIN_B, 90, gate=0.98, cresc=(86, 104))
    cl = s.add("clarinet", "clarinet", gain=1.0, role="melody")
    cl.line(13, STRAIN_B, 80, gate=0.94, cresc=(76, 92))
    va = s.add("violas", "violas", gain=3.0, role="melody")
    va.line(13, STRAIN_B, 86, tr=-12, gate=0.98, cresc=(82, 98))
    v2 = s.add("violins 2", "violins2", gain=1.5, role="pad")
    pad(v2, 13, HARM_B, (1, 2), 78, cresc=(74, 92))
    vc_h = s.add("cellos harmony", "cellos", gain=2.0, role="pad")
    pad(vc_h, 13, HARM_B, (0,), 80, cresc=(76, 94))
    # low brass joins for the last two bars of the strain and swells into the return
    tb = s.add("trombones", "trombones", gain=0.0, role="pad")
    tb.line(19, "G2+D3+G3:4 | A2+E3+A3:4", 80)
    tb.expr([(B(1), 100), (B(19), 70), (B(20), 90), (B(21), 127)])

    # ---- the theme, tutti -----------------------------------------------------------------------
    tp = s.add("trumpets", "trumpets", gain=1.0, role="melody")
    tp.line(21, THEME, 104, gate=0.93)
    hn.line(21, THEME, 108, gate=0.95)
    men = s.add("men", "tenors", gain=0.0, role="melody")
    men.line(21, THEME, 100, tr=-12, gate=0.97)
    men_b = s.add("men ooh", "men_ooh", gain=-2.0, role="melody")
    men_b.line(21, THEME, 96, tr=-12, gate=0.97)
    alt = s.add("altos", "altos", gain=2.0, role="melody")
    alt.line(25, A2, 98, gate=0.97)
    # tremolo violins carry the two upper harmony voices an octave up; violas pulse the lower two
    vt = s.add("violins tremolo", "violins_trem", gain=-4.5, role="pad")
    pad(vt, 21, HARM_A, (1, 2), 92, tr=12)
    vam = s.add("violas pulse", "violas_marc", gain=-3.0, role="ostinato")
    low2 = list(zip(harm_voice(HARM_A, 0), harm_voice(HARM_A, 1)))
    for i, (lo, up) in enumerate(low2):               # one entry per half bar: four eighths each
        for k in range(4):
            beat = B(21) + i * 2 + k * 0.5
            vel = 100 if k % 2 == 0 else 80
            vam.note(beat, lo, 0.34, vel)
            vam.note(beat, up, 0.34, vel)
    tb.line(21, LOW_BRASS, 100, gate=0.93)

    # ---- codetta: the head motif, far away ---------------------------------------------------
    cl.line(29, HEAD, 78, gate=0.95)
    bn.line(29, HEAD, 80, gate=0.95)
    vt.line(29, "F5+A5:8_", 76)
    vt.expr([(B(1), 127), (B(29), 112), (B(31), 30)])

    # ---- percussion ---------------------------------------------------------------------------
    sn = s.add("field drum", "snare", gain=0.0, role="perc")
    bar_a = "x...o...o..gx.o."
    bar_b = "x...o.ggx...o.gg"

    def march(first: int, last: int, scale: float, roll_every: int = 4) -> None:
        for bar in range(first, last + 1):
            pat = bar_a if (bar - first) % 2 == 0 else bar_b
            if (bar - first) % roll_every == roll_every - 1:
                pat = pat[:12] + "...."                       # make room for the roll on beat 4
                sn.roll(B(bar, 4), 1.0, SNARE, 40 * scale, 96 * scale, curve=1.4, alt=SNARE_ALT)
            sn.hits(bar, pat, SNARE, scale=scale)
    march(1, 4, 0.82)
    march(5, 12, 0.86)
    march(15, 20, 0.8)
    sn.roll(B(20, 3), 2.0, SNARE, 44, 112, curve=1.3, alt=SNARE_ALT)
    march(21, 28, 1.0, roll_every=2)
    march(29, 32, 0.8)
    # alternate the two snare samples on soft strokes so repeats are not identical
    sn.notes = [(st, d, SNARE_ALT if (i % 3 == 1 and v < 80) else p, v)
                for i, (st, d, p, v) in enumerate(sorted(sn.notes))]

    bd = s.add("bass drum", "bass_drum", gain=0.0, role="perc")
    for bar in range(1, 33):
        loud = 21 <= bar <= 28
        if 13 <= bar <= 16:
            continue
        bd.note(B(bar), BASS_DRUM, 0.5, 106 if loud else 88)
        if loud:
            bd.note(B(bar, 3), BASS_DRUM, 0.5, 90)

    tm = s.add("timpani", "timpani", gain=0.0, role="perc")
    tm.line(2, "D2:1.5 D2:.5 A2:2", 80)                       # the theme's rhythm, as a signal
    tm.line(4, "D2:1.5 D2:.5 A2:1 r:.5 A2:.25 A2:.25", 82)
    tm.line(12, "D2:4", 80)
    tm.roll(B(20), 4.0, "A2", 50, 106, step=0.125, dur=0.5, curve=1.5)
    tm.line(21, "D2:1> r:1 A2:1 r:.5 A2:.25 A2:.25 | C3:1> r:1 G2:1 r:.5 G2:.25 G2:.25 | "
                "Bb2:1> r:1 G2:1 r:.5 A2:.25 A2:.25 | A2:1> r:1 A2:1 A2:1/3 A2:1/3 A2:1/3 | "
                "D2:1> r:1 A2:1 r:.5 A2:.25 A2:.25 | C3:1> r:1 G2:1 r:1 | "
                "Eb3:1> r:1 A2:1 A2:1/3 A2:1/3 A2:1/3 | D2:2^ A2:1 D2:1", 98)
    tm.line(30, "D2:1.5 D2:.5 A2:2", 78)
    tm.line(32, "D2:1.5 D2:.5 A2:1 r:.5 A2:.25 A2:.25", 80)

    cy = s.add("cymbals", "cymbals", gain=0.0, role="perc")
    cy.note(B(21), CRASH, 4.0, 104)
    cy.note(B(25), CRASH, 4.0, 88)
    cy.note(B(28), CRASH, 4.0, 108)
    return cue
