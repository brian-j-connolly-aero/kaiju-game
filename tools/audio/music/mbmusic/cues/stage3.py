"""stage3: "Colossus over Port Meridian" (the titan). 32 bars, 80 s loop, base and combat stems.

Enormous: the whole choir, full brass and strings, bells; timpani and drums in the combat stem.
The pulse is the same 96 beats per minute, but the accents fall 3+3+2, so it lurches like
something very heavy walking.

    bars  1-8   theme, dark: men's voices, trombones and horns in unison; women hold the harmony
    bars  9-16  second strain: women and violins; men, horns and low brass in harmony, building
    bars 17-24  the theme at half speed in the bass (men, trombones, tuba, basses, organ pedal)
                under a slow rising chorale for the women and strings; bells toll every two bars
    bars 25-32  theme, apotheosis: choir in octaves, trumpets and high woodwind above, bells on
                every bar, closing on the flat-second cadence

Base stem: everything pitched that carries harmony or tune, including the bells.
Combat stem: timpani, bass drum, taiko, snare, cymbals; trumpet calls and trombone punches on
the 3+3+2 accents; choir shouts.
"""
from ..orchestra import BASS_DRUM, CRASH, SNARE, SNARE_ALT, TAIKO_LONG, TAIKO_SHORT
from ..patterns import bass, hammer, motor, octaves, stab, swell_into, voice, voices
from ..score import B, Cue, pitch
from ..theme import B1, HARM_A, HARM_B, STRAIN_B, THEME, pad, sustain

P = pitch
LOW_BRASS = ("D3+A3+D4:4 | C3+G3+C4:4 | Bb2+F3+Bb3:2 G2+D3+G3:2 | A2+E3+A3:4 | "
             "D3+A3+D4:4 | C3+G3+C4:4 | Eb3+Bb3+Eb4:2 A2+G3+A3:2 | D3+A3+D4:4")
# bars 17-24: the first half of the theme at half speed, as the bass (cello octave)
CANTUS = "D3:3 D3:1 | F3:4 | E3:3 D3:1 | C3:4 | F3:3 F3:1 | Bb3:4 | A3:3 G3:1 | E3:4"
# the basses' lower octave of the cantus. It rests on the long C of the fourth bar: bowed C1 under
# C2 adds up to a boom at 65 Hz there (measured 5 dB over every other bar), and the organ pedal
# holds that C1 anyway.
CANTUS_LOW = "D3:3 D3:1 | F3:4 | E3:3 D3:1 | r:4 | F3:3 F3:1 | Bb3:4 | A3:3 G3:1 | E3:4"
# and the chorale above it (soprano, alto, tenor), led against the bass in contrary motion
CHORALE_S = "A4:4 | A4:2 C5:2 | C5:3 D5:1 | E5:4 | F5:4 | F5:2 D5:2 | E5:4 | E5:2 C#5:2"
CHORALE_A = "F4:4 | F4:2 A4:2 | G4:4 | G4:2 C5:2 | C5:4 | Bb4:4 | A4:4 | A4:2 G4:2"
CHORALE_T = "D4:4 | C4:4 | C4:4 | C4:4 | A3:4 | D4:4 | C#4:4 | E4:4"
# harmony of those bars per half bar, for the string motor: (bass, upper voices)
HARM_C = [
    ("D3", "D4 F4 A4"), ("D3", "D4 F4 A4"), ("F3", "C4 F4 A4"), ("F3", "C4 A4 C5"),
    ("E3", "C4 G4 C5"), ("E3", "C4 G4 C5"), ("C3", "C4 G4 E5"), ("C3", "C4 C5 E5"),
    ("F3", "A3 C5 F5"), ("F3", "A3 C5 F5"), ("Bb3", "D4 Bb4 F5"), ("Bb3", "D4 Bb4 D5"),
    ("A3", "C#4 A4 E5"), ("G3", "C#4 A4 E5"), ("E3", "E4 A4 E5"), ("E3", "E4 G4 C#5"),
]
# low-brass and men's-shout dyads for those bars: the bass note plus a chord tone that is
# clean above it (these chords are not all in root position, so "root and fifth" would be wrong)
DYADS_C = ["D3 A3", "D3 A3", "F3 C4", "F3 C4", "E3 C4", "E3 C4", "C3 G3", "C3 G3",
           "F3 C4", "F3 C4", "Bb2 F3", "Bb2 F3", "A2 E3", "G3 E4", "E3 C#4", "E3 C#4"]
BELLS_A = {1: "D5", 3: "D5", 5: "D5", 7: "Bb4", 8: "D5"}
BELLS_C = {17: "D5", 19: "C5", 21: "F5", 23: "A4"}
BELLS_Z = {25: "D5", 26: "C5", 27: "D5", 28: "A4", 29: "D5", 30: "C5", 31: "Eb5", 32: "D5"}
CALL = {  # trumpet call per theme bar: (lower note, top note) for two trumpet parts
    1: (("A4", "D5"), ("F4", "A4")), 2: (("G4", "C5"), ("E4", "G4")), 3: (("Bb4", "D5"), ("G4", "Bb4")),
    4: (("A4", "C#5"), ("E4", "A4")), 5: (("A4", "D5"), ("F4", "A4")), 6: (("G4", "C5"), ("E4", "G4")),
    7: (("A4", "C#5"), ("G4", "A4")),
}


def build() -> Cue:
    cue = Cue("stage3", 32, loop=True, group="stage3", title="Colossus over Port Meridian (stage 3, the titan)",
              sections=[(1, "theme, dark (men, low brass)"), (9, "second strain"),
                        (17, "theme at half speed in the bass, chorale"), (25, "theme, apotheosis")],
              target_lufs=-15.0)
    base = cue.stem("stage3_base")
    combat = cue.stem("stage3_combat")

    # =========================== base ===========================================================
    # ---- bass: basses, tuba, organ pedal; cellos hammer the roots in 3+3+2 ---------------------
    # This is where the titan's weight comes from, and the samples do not give it away for free:
    # the bowed basses have no fundamental below A1 and the organ's is weak. So the basses play
    # in octaves wherever the lower one is on the instrument (C1 and up), and the organ pedal
    # gets its 16-foot tone back with a low shelf (`sub`) and runs under the whole loop.
    cb = base.add("basses", "basses", gain=4.0, sub=4.0, role="bass")
    tuba = base.add("tuba", "tuba", gain=3.0, role="bass")
    org = base.add("organ pedal", "organ_pedal", gain=7.0, sub=21.0, hp=20, role="bass")
    vc = base.add("cellos hammer", "cellos_marc", gain=2.0, role="ostinato")
    for bar, v in ((1, 100), (25, 110)):
        hammer(cb, bar, octaves(bass(HARM_A, -1)), v, fill=False, dur=0.9)
        hammer(vc, bar, bass(HARM_A), v - 4)
        sustain(tuba, bar, bass(HARM_A, -1), v - 6, rearticulate=4, gate=0.92)
        sustain(org, bar, bass(HARM_A, -2, "C1"), 90, gate=1.0)
    cb.line(9, "G1:4_ | F1:4_ | Eb1+Eb2:4_ | A1:4", 94, gate=0.97)
    hammer(cb, 13, bass(HARM_B, -1)[8:], 98, fill=False, dur=0.9, cresc=(94, 108))
    hammer(vc, 9, bass(HARM_B), 86, cresc=(80, 104))
    sustain(tuba, 13, bass(HARM_B, -1)[8:], 88, rearticulate=4, gate=0.92, cresc=(84, 100))
    sustain(org, 9, bass(HARM_B, -2, "C1"), 86, gate=1.0)
    cb.line(17, CANTUS, 108, tr=-12, gate=0.96)
    cb.line(17, CANTUS_LOW, 100, tr=-24, gate=0.96)             # the cantus in octaves
    tuba.line(17, CANTUS, 100, tr=-12, gate=0.94)
    org.line(17, CANTUS, 92, tr=-24, gate=1.0)
    hammer(vc, 17, bass(HARM_C), 94, cresc=(90, 106))

    # ---- strings: the motor, and tremolo violins on top ------------------------------------------
    v2 = base.add("violins 2 motor", "violins2_marc", gain=-3.0, role="ostinato")
    va = base.add("violas motor", "violas_marc", gain=-2.0, role="ostinato")
    motor(v2, 1, voices(HARM_A, (1, 2)), 78)
    motor(va, 1, voices(HARM_A, (0, 1)), 80)
    motor(va, 9, voice(HARM_B, 0), 76, cresc=(70, 92))
    motor(v2, 13, voices(HARM_B, (1, 2))[8:], 78, cresc=(72, 94))
    motor(v2, 17, voices(HARM_C, (1, 2)), 84, cresc=(80, 96))
    motor(va, 17, voices(HARM_C, (0, 1)), 84, cresc=(80, 96))
    motor(v2, 25, voices(HARM_A, (1, 2), 12), 92)
    motor(va, 25, voices(HARM_A, (0, 1)), 92)
    vt = base.add("violins tremolo", "violins_trem", gain=-4.0, role="pad")
    sustain(vt, 1, voice(HARM_A, 2, 12), 84)
    vt.line(17, CHORALE_S, 92, tr=12, gate=1.0)
    v1 = base.add("violins 1", "violins1", gain=3.0, role="melody")
    v1.line(9, STRAIN_B, 100, tr=12, gate=0.98, cresc=(94, 112))
    v1.line(25, THEME, 112, tr=12, gate=0.98)
    picc = base.add("piccolo", "piccolo", gain=-4.0, role="melody")
    fl = base.add("flute", "flute", gain=-2.0, role="melody")
    fl.line(9, STRAIN_B, 90, tr=12, gate=0.95, cresc=(86, 100))
    picc.line(25, THEME, 96, tr=24, gate=0.94)
    fl.line(25, THEME, 100, tr=12, gate=0.95)

    # ---- brass -----------------------------------------------------------------------------------
    tb = base.add("trombones", "trombones", gain=4.5, role="melody")
    hn = base.add("horns", "horns", gain=2.0, role="melody")
    tb.line(1, THEME, 108, tr=-12, gate=0.94)                   # the tune, dark
    hn.line(1, THEME, 106, tr=-12, gate=0.95)
    sustain(hn, 9, voice(HARM_B, 1), 90, rearticulate=4, gate=0.94, cresc=(84, 104))
    tb.line(13, "G2+D3+G3:4 | Bb2+F3+Bb3:4 | G2+D3+G3:4 | A2+E3+A3:4", 84, cresc=(80, 100))
    tb.line(17, CANTUS, 110, gate=0.95)                         # the cantus (tuba and basses below)
    hn.line(17, CHORALE_T, 98, gate=0.96)
    hn.line(25, THEME, 114, gate=0.95)
    tbl = base.add("trombones low", "trombones", gain=0.0, role="pad")
    tbl.line(25, LOW_BRASS, 100, gate=0.94)
    tp = base.add("trumpets", "trumpets", gain=1.0, role="melody")
    tp.line(25, THEME, 108, tr=12, gate=0.93)

    # ---- the choir -------------------------------------------------------------------------------
    sop = base.add("sopranos", "sopranos", gain=1.0, role="melody")
    alt = base.add("altos", "altos", gain=0.5, role="melody")
    ten = base.add("tenors", "tenors", gain=1.0, role="melody")
    chb = base.add("choir basses", "choir_basses", gain=1.0, role="melody")
    men = base.add("men ooh", "men_ooh", gain=-1.0, role="melody")
    wom = base.add("women ooh", "women_ooh", gain=-3.0, role="pad")
    # 1-8: men carry the tune, women hold the harmony
    for part in (ten, chb, men):
        part.line(1, THEME, 106, tr=-12, gate=0.97)
    sustain(sop, 1, voice(HARM_A, 2), 86, rearticulate=4, gate=0.96)
    sustain(alt, 1, voice(HARM_A, 1), 86, rearticulate=4, gate=0.96)
    # 9-16: women carry the strain, men the harmony
    sop.line(9, STRAIN_B, 98, gate=0.97, cresc=(92, 110))
    alt.line(9, B1 + " | Bb4:1.5 A4:.5 G4:2 | F4:1.5 F4:.5 F4:2 | G4:1.5 G4:.5 G4:2 | E4:1.5 E4:.5 G4:2",
             98, gate=0.97, cresc=(92, 110))
    sustain(ten, 9, voice(HARM_B, 0), 92, rearticulate=4, gate=0.95, cresc=(86, 104))
    sustain(chb, 9, bass(HARM_B), 92, rearticulate=4, gate=0.95, cresc=(86, 104))
    # 17-24: chorale over the cantus
    sop.line(17, CHORALE_S, 104, gate=0.98, cresc=(98, 114))
    alt.line(17, CHORALE_A, 102, gate=0.98, cresc=(96, 112))
    ten.line(17, CHORALE_T, 102, gate=0.98, cresc=(96, 112))
    chb.line(17, CANTUS, 108, gate=0.97)
    men.line(17, CANTUS, 104, gate=0.97)
    wom.line(17, CHORALE_S, 96, gate=0.98)
    # 25-32: everyone on the tune, in octaves
    for part in (sop, alt, wom):
        part.line(25, THEME, 112, gate=0.97)
    for part in (ten, chb, men):
        part.line(25, THEME, 112, tr=-12, gate=0.97)

    # ---- bells -----------------------------------------------------------------------------------
    bells = base.add("tubular bells", "tubular_bells", gain=1.0, role="perc")
    big = base.add("church bell", "church_bell", gain=-3.0, role="perc")
    for table, v in ((BELLS_A, 96), (BELLS_C, 104), (BELLS_Z, 110)):
        for bar, n in table.items():
            bells.note(B(bar), P(n), 3.5, v)
    for bar in (1, 17, 21, 25, 29, 32):
        big.note(B(bar), P("D3"), 6.0, 100 if bar >= 17 else 90)

    # =========================== combat =========================================================
    tm = combat.add("timpani", "timpani", gain=3.5, role="perc")
    TIMP = {"D": "D2", "C": "C3", "Bb": "Bb2", "G": "G2", "A": "A2", "Eb": "Eb3", "F": "F2", "E": "E3"}

    def timp(first: int, harm: list, vel: int, bars: range = range(8)) -> None:
        for i in bars:
            r1 = TIMP[harm[2 * i][0][:-1]]
            r2 = TIMP[harm[2 * i + 1][0][:-1]]
            if i in (3, 7):
                tm.line(first + i, f"{r1}:1.5> {r1}:1> {r2}:.5 {r2}:1/3 {r2}:1/3 {r2}:1/3", vel)
            else:
                tm.line(first + i, f"{r1}:1.5> {r1}:.5> r:.5 {r2}:.5 {r2}:.5> {r2}:.25 {r2}:.25", vel)
    timp(1, HARM_A, 102)
    # bars 9-12 (the strain starts quietly): the 3+3+2 goes on at reduced strength, so that the
    # combat stem still says "fight" when it is faded in here
    tm.line(9, "G2:1.5> G2:1.5> G2:1 | F2:1.5> F2:1.5> F2:1 | Eb3:1.5> Eb3:1.5> Eb3:1 | "
               "A2:1.5> A2:1.5> A2:.5 A2:.5", 96)
    timp(9, HARM_B, 100, range(4, 7))
    tm.note(B(16), P("A2"), 0.9, 110)
    tm.roll(B(16, 2), 3.0, "A2", 60, 120, step=0.125, dur=0.5, curve=1.4)
    timp(17, HARM_C, 106, range(0, 7))
    tm.note(B(24), P("E3"), 0.9, 112)
    tm.roll(B(24, 2), 3.0, "E3", 64, 122, step=0.125, dur=0.5, curve=1.3)
    timp(25, HARM_A, 112)

    bd = combat.add("bass drum", "bass_drum", gain=4.5, role="perc")
    tk = combat.add("taiko", "percussion", gain=4.0, role="perc")
    sn = combat.add("snare", "snare", gain=3.0, role="perc")
    for bar in range(1, 33):
        quiet = 9 <= bar <= 12
        last = bar % 8 == 0
        bd.hits(bar, "X.....X.....x...", BASS_DRUM, dur=0.5)
        if quiet:
            sn.hits(bar, "X.g.g.X.g.g.X.gg", SNARE, scale=1.05)
            tk.hits(bar, "X.....x.....x...", TAIKO_LONG, dur=0.6)
            continue
        tk.hits(bar, "X..x..x.X..x..xx", TAIKO_LONG, dur=0.5)
        tk.hits(bar, ".g..g..g.g..g...", TAIKO_SHORT, dur=0.3)
        if last:
            sn.hits(bar, "XggXggXgXggX....", SNARE)
            sn.roll(B(bar, 4), 1.0, SNARE, 60, 124, curve=1.2, alt=SNARE_ALT)
        else:
            sn.hits(bar, "XggXggXgXggXggXx" if bar % 2 else "XggXggXgXgXgXXXX", SNARE)
    sn.notes = [(st, d, SNARE_ALT if (i % 3 == 1 and v < 80) else p, v)
                for i, (st, d, p, v) in enumerate(sorted(sn.notes))]

    cy = combat.add("cymbals", "cymbals", gain=4.0, role="perc")
    rc = combat.add("cymbal swell", "reverse_cymbal", gain=3.0, role="perc")
    for bar, v in ((1, 112), (5, 92), (9, 96), (17, 112), (21, 96), (25, 120), (29, 100), (32, 108)):
        cy.note(B(bar), CRASH, 4.0, v)
    for bar in (1, 9, 17, 25):
        swell_into(rc, B(bar) if bar > 1 else B(33), 104)

    # ---- brass: trombone punches on the 3+3+2 accents, trumpet calls answering the tune ---------
    tbs = combat.add("trombone punches", "trombones", gain=5.0, role="melody")
    tp1 = combat.add("trumpets 1", "trumpets", gain=0.0, pan=0.14, role="melody")
    tp2 = combat.add("trumpets 2", "trumpets", gain=-1.5, pan=0.26, role="melody")
    for first, harm, v in ((1, HARM_A, 104), (13, HARM_B[8:], 100), (17, HARM_C, 106), (25, HARM_A, 114)):
        roots = bass(harm)
        for i, r in enumerate(roots):
            chord = [r, r + 7]
            if harm is HARM_A and i == 13:                       # A7 flat 5: root and seventh
                chord = [r, r + 10]
            if harm is HARM_C:
                chord = [P(n) for n in DYADS_C[i].split()]
            for pos in (0, 1.5) if i % 2 == 0 else (1.0,):
                stab(tbs, B(first) + i * 2 + pos, chord, v + (6 if pos == 0 and i % 2 == 0 else 0), 0.4)
    # bars 9-12: soft punches on the first two accents only (fifths, and an octave where the
    # chord is D minor over F)
    for i, dyad in enumerate(("G2 D3", "F2 F3", "Eb3 Bb3", "A2 E3")):
        for pos, v in ((0, 88), (1.5, 82)):
            stab(tbs, B(9 + i) + pos, [P(n) for n in dyad.split()], v, 0.4)
    for first, v in ((1, 100), (25, 110)):
        for i in range(1, 8):
            bar = first + i - 1
            for part, (lo, hi) in zip((tp1, tp2), CALL[i]):
                t = B(bar, 3)
                for k in range(3):                               # triplet pickup, then the long note
                    part.note(t + k / 3, P(lo), 0.22, v - 6 + 3 * k)
                part.note(t + 1, P(hi), 0.9, v + 8)
        for part, n in ((tp1, "D5"), (tp2, "A4")):
            part.line(first + 7, f"{n}:1.5> {n}:.5 {n}:2", v + 4, gate=0.8)
    for i in range(4):                                           # the build at the end of the strain
        for beat in (2.5, 4.5):
            stab(tp1, B(13 + i, beat), [P(("D5", "D5", "E5", "E5")[i])], 98 + 4 * i, 0.3)
            stab(tp2, B(13 + i, beat), [P(("Bb4", "Bb4", "Bb4", "C#5")[i])], 94 + 4 * i, 0.3)
    for i, bar in enumerate(range(17, 25)):                      # over the cantus: octave calls
        n = ("A4", "C5", "C5", "E5", "F5", "F5", "E5", "E5")[i]
        for part, tr in ((tp1, 0), (tp2, -12 if P(n) - 12 >= P("E4") else 0)):
            part.line(bar, f"r:2 {n}:1/3 {n}:1/3 {n}:1/3 {n}:1", 102 + i, tr=tr, gate=0.8)

    # ---- choir shouts ----------------------------------------------------------------------------
    wh = combat.add("women shout", "women_hit", gain=2.0, role="choir")
    mh = combat.add("men shout", "men_hit", gain=2.0, role="choir")
    for first, harm, bars, beats, v in ((1, HARM_A, (0, 2, 4, 6), (1,), 100), (13, HARM_B[8:], (0, 2), (1,), 100),
                                        (17, HARM_C, (0, 2, 4, 6), (1, 2.5), 106),
                                        (25, HARM_A, (0, 1, 2, 3, 4, 5, 6), (1, 2.5), 114)):
        for i in bars:
            hb = 2 * i
            root = bass(harm)[hb]
            low = [P(n) for n in DYADS_C[hb].split()] if harm is HARM_C else [root, root + 7]
            for beat in beats:
                stab(wh, B(first + i, beat), voices(harm, (0, 1, 2))[hb], v - (0 if beat == 1 else 8), 0.6)
                stab(mh, B(first + i, beat), low, v - (0 if beat == 1 else 8), 0.6)
    return cue
