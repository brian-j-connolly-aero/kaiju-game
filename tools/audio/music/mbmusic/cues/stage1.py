"""stage1: "Something in the Streets" (the hatchling). 32 bars, 80 s loop, base and combat stems.

Sparse and nervous. The theme never gets going: the head motif is passed around in fragments,
and only near the end do the cellos get four bars of the tune out before it sinks back.

    bars  1-8   a stop-and-start cello figure on D with a flat-second twitch; plucked fragments
                of the head motif (violins, answered by violas)
    bars  9-16  the harmony finally moves (D minor, B flat, G minor, A); a clarinet tries the
                tune and breaks off; a hint of choir (women, "ooh") over the last four bars
    bars 17-24  back to the pedal, more restless: tremolo violas, a distant muted trumpet with
                the head motif, bassoon and clarinet answering
    bars 25-32  the first four bars of the theme at last, cellos and violas with the choir
                humming above; then the figure returns and winds down

Base stem: low strings, pizzicato, tremolo, woodwind fragments, the hint of choir, a snare tic.
Combat stem: snare, bass drum, timpani, rim clicks; stopped low-brass stabs; a muted trumpet
alarm figure; small choir shouts.
"""
from ..orchestra import BASS_DRUM, CRASH_SHORT, RIM, SNARE, SNARE_ALT
from ..patterns import stab, swell_into
from ..score import B, Cue, pitch
from ..theme import A1, HEAD

P = pitch
# the nervous figure, in eighths with holes; x = root, n = upper neighbour, f = fifth below
FIG_A = "x.xnx.f."
FIG_B = "x.xn.xf."
FIG_C = "xx.nx.f."
ROOTS = {  # root, twitch (neighbour), lower fifth or fourth
    "D": ("D3", "Eb3", "A2"), "Bb": ("Bb2", "C3", "F2"), "G": ("G2", "Ab2", "D3"), "A": ("A2", "Bb2", "E3"),
    "C": ("C3", "D3", "G2"), "Eb": ("D3", "Eb3", "Bb2"),
}
# bars 9-16 and the theme bars use these roots; everything else sits on D
PLAN = {9: "D", 10: "D", 11: "Bb", 12: "Bb", 13: "G", 14: "G", 15: "A", 16: "A",
        19: "Eb", 23: "Eb"}


def build() -> Cue:
    cue = Cue("stage1", 32, loop=True, group="stage1", title="Something in the Streets (stage 1, the hatchling)",
              sections=[(1, "nervous figure, plucked fragments"), (9, "harmony moves; clarinet; hint of choir"),
                        (17, "restless pedal; muted trumpet"), (25, "four bars of the theme; winds down")],
              target_lufs=-16.5)
    base = cue.stem("stage1_base")
    combat = cue.stem("stage1_combat")

    # =========================== base ===========================================================
    # ---- the nervous figure: cellos, short bows -------------------------------------------------
    vc = base.add("cellos figure", "cellos_marc", gain=4.0, role="ostinato")
    for bar in range(1, 33):
        if 25 <= bar <= 28:
            continue                                      # the cellos have the tune here
        root, twitch, fifth = (P(n) for n in ROOTS[PLAN.get(bar, "D")])
        fig = (FIG_A, FIG_B, FIG_A, FIG_C)[(bar - 1) % 4]
        soft = bar >= 30
        for k, ch in enumerate(fig):
            if ch == ".":
                continue
            p = {"x": root, "n": twitch, "f": fifth}[ch]
            v = (88 if k == 0 else 74) - (10 if soft else 0) + (6 if 17 <= bar <= 24 else 0)
            vc.note(B(bar) + k * 0.5, p, 0.26, v)
    # ---- plucked bass: sparse, on the root -------------------------------------------------------
    pb = base.add("basses pizz", "pizz_bass", gain=3.0, role="bass")
    for bar in range(1, 33):
        root = P(ROOTS[PLAN.get(bar, "D")][0]) - 12
        if PLAN.get(bar) == "Eb":
            root = P("D2")                                # E flat over the D pedal
        if 25 <= bar <= 28:
            continue
        pb.note(B(bar), root, 1.0, 88)
        if bar % 2 == 0:
            pb.note(B(bar, 3.5), root, 0.5, 72)
    pb.line(25, "D2:1 r:1 D2:1 r:1 | C2:1 r:1 C2:1 r:1 | Bb1:1 r:1 G1:1 r:1 | A1:1 r:1 A1:1 r:.5 A1:.5", 86)

    # ---- plucked fragments of the head motif ------------------------------------------------------
    pz1 = base.add("violins pizz", "pizz_hi", gain=2.0, role="melody")
    pz2 = base.add("violas pizz", "pizz_mid", gain=2.0, role="melody")
    pz1.line(3, "D5:1.5 D5:.5 F5:2", 88)
    pz2.line(4, "E4:1.5 D4:.5 C4:2", 84)
    pz1.line(7, "D5:1.5 D5:.5 F5:1 r:.5 F5:.5", 90)
    pz2.line(8, "E4:1.5 D4:.5 C4:1 A3:.5 C#4:.5", 86)
    # off-beat plucked chords, like something scuttling
    for bar in (5, 6):
        pz2.line(bar, "r:.5 D4+A4:.5 r:1.5 D4+A4:.5 r:1", 70)
    for bar in (17, 18, 21, 22):
        pz1.line(bar, "r:.5 A4+D5:.5 r:1 r:.5 A4+D5:.25 A4+D5:.25 r:1", 76)
        pz2.line(bar, "r:1.5 D4+A4:.5 r:1.5 F4+A4:.5", 72)
    for bar in (19, 23):
        pz1.line(bar, "r:.5 Bb4+Eb5:.5 r:1 r:.5 Bb4+Eb5:.25 Bb4+Eb5:.25 r:1", 78)
        pz2.line(bar, "r:1.5 Eb4+G4:.5 r:1.5 Eb4+Bb4:.5", 74)
    pz1.line(30, "r:2 D5:.5 r:.5 A4:.5 r:.5", 72)
    pz2.line(32, "r:2 D4:.5 r:.5 A3:.5 C#4:.5", 74)

    # ---- held tones: tremolo violas, sustained violins ----------------------------------------------
    vt = base.add("violas tremolo", "violas_trem", gain=4.0, role="pad")
    vt.line(1, "D4:16_ D4:16_", 66)
    vt.line(9, "D4:8_ D4:8_ | D4:4_ Bb3:4_ | A3:4_ C#4:4", 72)
    vt.line(17, "A3+D4:8_ Bb3+Eb4:4_ A3+D4:4_ | A3+D4:8_ Bb3+Eb4:4_ A3+D4:4", 62)
    vt.line(29, "D4:16", 64)
    vt.expr([(B(1), 60), (B(4), 100), (B(5), 70), (B(8), 108), (B(9), 80), (B(13), 104), (B(16), 118),
             (B(17), 84), (B(19), 108), (B(20), 86), (B(23), 112), (B(24), 88), (B(29), 100), (B(33), 60)])
    v2 = base.add("violins held", "violins2", gain=2.0, role="pad")
    v2.line(11, "F4:8_ | G4:8_ | E4:4_ G4:4", 68)
    v2.expr([(B(11), 60), (B(13), 96), (B(15), 110), (B(17), 60)])

    # ---- woodwind: the tune tried and dropped --------------------------------------------------------
    cl = base.add("clarinet", "clarinet", gain=6.0, role="melody")
    cl.line(9, "D4:1.5 D4:.5 F4:2 | E4:1.5 D4:.5 C4:2 | F4:1.5 F4:.5 Bb4:2 | A4:4", 84, gate=0.95)
    cl.expr([(B(1), 120), (B(12), 120), (B(13), 40), (B(14), 120)])
    bn = base.add("bassoon", "bassoon", gain=5.0, role="melody")
    bn.line(21, HEAD, 84, gate=0.95)
    cl.line(22, "r:2 E5:1.5 D5:.5", 78, gate=0.95)
    tpm = base.add("muted trumpet", "trumpet_muted", gain=6.0, rev=0.6, role="melody")
    tpm.line(17, HEAD, 84, gate=0.9)

    # ---- hint of choir ------------------------------------------------------------------------------
    wo = base.add("women ooh", "women_ooh", gain=5.5, role="pad")
    wo.line(13, "Bb4+D5:8_ | A4+C#5:8", 76, gate=1.0)
    wo.line(25, "A4:16", 80)
    wo.expr([(B(1), 50), (B(13), 50), (B(15), 104), (B(16.5), 120), (B(17), 60),
             (B(25), 60), (B(27), 110), (B(28.5), 118), (B(29), 50)])

    # ---- four bars of the theme ----------------------------------------------------------------------
    vcm = base.add("cellos tune", "cellos", gain=5.0, role="melody")
    vam = base.add("violas tune", "violas", gain=2.0, role="melody")
    vcm.line(25, A1, 92, tr=-12, gate=0.97)
    vam.line(25, A1, 86, gate=0.97)

    # ---- the snare tic (the only percussion in the base stem) --------------------------------------
    sn0 = base.add("snare tic", "snare", gain=3.0, role="perc")
    for bar in range(2, 33, 2):
        if bar in (8, 16, 24, 32):
            sn0.roll(B(bar, 3.5), 0.5, SNARE, 36, 60, step=1 / 12)
            sn0.hits(bar, "............x...", SNARE, scale=0.8)
        else:
            sn0.hits(bar, ".............ggo", SNARE)

    # =========================== combat =========================================================
    sn = combat.add("snare", "snare", gain=0.0, role="perc")
    pats = ["X.gx..g.x.g.g.x.", "x.g.X.gg..x.g.xx", "X.gx..g.x.gxg.x.", "x.g.X.gg.x.gXgxx"]
    for bar in range(1, 33):
        last = bar % 8 == 0
        pat = pats[(bar - 1) % 4]
        if 25 <= bar <= 28:
            pat = "x...g.g.x...g.gg"                     # under the tune: a plain march
        if last:
            pat = pat[:10] + "......"
            sn.roll(B(bar, 3.5), 1.5, SNARE, 44, 108, curve=1.3)
        sn.hits(bar, pat, SNARE, scale=0.92)
    sn.notes = [(st, d, SNARE_ALT if (i % 3 == 1 and v < 80) else p, v)
                for i, (st, d, p, v) in enumerate(sorted(sn.notes))]

    rim = combat.add("rim clicks", "percussion", gain=-2.0, role="perc")
    for bar in range(1, 33):
        if 25 <= bar <= 28:
            continue
        rim.hits(bar, "..o...o..o...o.." if bar % 2 else "...o..o...o..o.o", RIM, dur=0.1)

    bd = combat.add("bass drum", "bass_drum", gain=0.0, role="perc")
    for bar in range(1, 33):
        bd.hits(bar, "X.........o....." if bar % 2 else "x......o..x.....", BASS_DRUM, dur=0.5)

    tm = combat.add("timpani", "timpani", gain=0.0, role="perc")
    TIMP = {"D": "D2", "Bb": "Bb2", "G": "G2", "A": "A2", "Eb": "D2", "C": "C3"}
    theme_roots = {25: ("D2", "D2"), 26: ("C3", "C3"), 27: ("Bb2", "G2"), 28: ("A2", "A2")}
    for bar in range(1, 33):
        r1, r2 = theme_roots.get(bar, (TIMP[PLAN.get(bar, "D")],) * 2)
        if bar % 8 == 0:
            tm.line(bar, f"{r1}:1 r:1 {r2}:.5 {r2}:.5 A2:1/3 A2:1/3 A2:1/3", 92)
        elif bar % 2:
            tm.line(bar, f"{r1}:1> r:2.5 {r2}:.25 {r2}:.25", 90)
        else:
            tm.line(bar, f"{r1}:1 r:.5 {r1}:.5 r:2", 80)

    cy = combat.add("cymbals", "cymbals", gain=1.0, role="perc")
    rc = combat.add("cymbal swell", "reverse_cymbal", gain=0.0, role="perc")
    for bar in (1, 9, 17, 25):
        cy.note(B(bar), CRASH_SHORT, 2.0, 84)
        swell_into(rc, B(bar) if bar > 1 else B(33), 84)

    # ---- stopped low brass: short open fifths, off the beat ----------------------------------------
    hn = combat.add("horns stabs", "horns_marc", gain=-1.0, role="melody")
    tb = combat.add("trombone stabs", "trombones", gain=4.0, role="melody")
    for bar in range(1, 33):
        root = P(ROOTS[PLAN.get(bar, "D")][0])
        if bar in theme_roots:
            root = P({25: "D3", 26: "C3", 27: "Bb2", 28: "A2"}[bar])
        low, high = [root, root + 7], [root + 12, root + 19]
        if PLAN.get(bar) == "Eb":                         # E flat over the D pedal: no A natural
            low, high = [P("D3"), P("D4")], [P("D4"), P("Bb4")]
        # the stabs land where the cello figure plays its root or fifth, never on the twitch
        beats = ((1, 100), (2.75, 84)) if bar % 2 else ((2, 88), (4, 92))
        for beat, v in beats:
            stab(tb, B(bar, beat), low, v, 0.3)
            stab(hn, B(bar, beat), high, v - 4, 0.3)

    # ---- muted trumpets: a two-note alarm --------------------------------------------------------
    al = combat.add("muted trumpet alarm", "trumpet_muted", gain=5.0, role="melody")
    for bar in range(1, 33):
        if bar % 2 == 0 and not 25 <= bar <= 28:
            n = {"D": "A4", "Bb": "Bb4", "G": "Bb4", "A": "A4", "Eb": "Bb4"}[PLAN.get(bar, "D")]
            al.line(bar, f"r:1.5 {n}:.25' {n}:.25' r:1.5 {n}:.25' {n}:.25'", 92)

    # ---- small choir shouts at the phrase starts ----------------------------------------------------
    mh = combat.add("men shout", "men_hit", gain=3.0, role="choir")
    wh = combat.add("women shout", "women_hit", gain=1.0, role="choir")
    for bar in (1, 5, 9, 13, 17, 21, 25, 29):
        stab(mh, B(bar), [P("G2"), P("D3")] if bar == 13 else [P("D3"), P("A3")], 92, 0.6)
        if bar % 8 == 1:
            stab(wh, B(bar), [P("D4"), P("A4")], 88, 0.6)
    return cue
