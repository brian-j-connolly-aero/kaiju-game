"""The orchestra: General MIDI programs from FluidR3_GM, with real instrument ranges, seating
(stereo position as heard from the audience) and default mix settings.

`trim` levels every instrument so that a single mezzo-forte note lands at a similar loudness;
the cue files then only write musical balance (gain offsets in dB).
"""
from __future__ import annotations

from dataclasses import dataclass

from .score import pitch


@dataclass(frozen=True)
class Instrument:
    key: str
    program: int
    lo: int                 # lowest and highest sounding pitch that a real player (or section)
    hi: int                 # can be asked for; the score review enforces these
    family: str             # strings / brass / winds / choir / perc / keys
    pan: float = 0.0        # -1 left .. +1 right
    width: float = 1.0      # stereo width of the sampled instrument (0 = mono)
    rev: float = 0.3        # send level into the hall
    trim: float = 0.0       # dB
    hp: float = 0.0         # high-pass in Hz (clears rumble and low mud under each part)
    lp: float = 0.0         # low-pass in Hz (0 = none)
    sub: float = 0.0        # low-shelf lift in dB under about 60 Hz (see SUB_HZ in mixdown.py)
    ofs: int = 0            # sample start offset: skips the slow sampled bow or breath attack
    atk_ms: float = 0.0     # replaces it with a short clean fade-in
    human_ms: float = 7.0   # timing looseness of the section
    bank: int = 0
    drums: bool = False
    pitched: bool = True

    @property
    def air(self) -> float:
        """High-shelf lift in dB at 6 kHz. The sampled strings, voices and brass are dull on
        top; percussion and bells are not, so they are left alone."""
        return {"strings": 3.5, "choir": 4.0, "brass": 3.0, "winds": 2.0}.get(self.family, 0.0)


def _i(key, program, lo, hi, family, **kw) -> Instrument:
    return Instrument(key, program, pitch(lo) if isinstance(lo, str) else lo,
                      pitch(hi) if isinstance(hi, str) else hi, family, **kw)


_ALL = [
    # ---- strings (ensemble patch unless noted) --------------------------------------------
    _i("violins1", 48, "G3", "C7", "strings", pan=-0.45, rev=0.34, hp=170, trim=0.0),
    _i("violins2", 48, "G3", "A6", "strings", pan=-0.18, rev=0.34, hp=170, trim=0.0),
    _i("violas", 48, "C3", "E6", "strings", pan=0.1, rev=0.32, hp=110, trim=0.0),
    _i("cellos", 48, "C2", "A5", "strings", pan=0.22, rev=0.28, hp=55, trim=0.0),
    _i("basses", 43, "C1", "G3", "strings", pan=0.1, width=0.4, rev=0.16, hp=28, lp=4500, trim=-1.0),
    # marcato: the same sections with the sampled swell skipped, for ostinatos and accents
    _i("violins1_marc", 48, "G3", "C7", "strings", pan=-0.45, rev=0.30, hp=170, ofs=3600, atk_ms=6),
    _i("violins2_marc", 48, "G3", "A6", "strings", pan=-0.18, rev=0.30, hp=170, ofs=3600, atk_ms=6),
    _i("violas_marc", 48, "C3", "E6", "strings", pan=0.1, rev=0.28, hp=110, ofs=3600, atk_ms=6),
    _i("cellos_marc", 48, "C2", "A5", "strings", pan=0.22, rev=0.24, hp=55, ofs=4200, atk_ms=8),
    _i("cello_solo", 42, "C2", "A5", "strings", pan=0.2, width=0.5, rev=0.3, hp=55, trim=-1.0),
    _i("viola_solo", 41, "C3", "E6", "strings", pan=0.12, width=0.5, rev=0.32, hp=110, trim=-1.0),
    _i("violins_trem", 44, "G3", "C7", "strings", pan=-0.3, rev=0.38, hp=170, trim=1.0),
    _i("violas_trem", 44, "C3", "E6", "strings", pan=0.1, rev=0.36, hp=110, trim=1.0),
    _i("cellos_trem", 44, "C2", "A5", "strings", pan=0.22, rev=0.3, hp=55, trim=1.0),
    _i("pizz_hi", 45, "G3", "E6", "strings", pan=-0.3, rev=0.30, hp=150, trim=2.0, human_ms=9),
    _i("pizz_mid", 45, "C3", "A5", "strings", pan=0.1, rev=0.30, hp=100, trim=2.0, human_ms=9),
    _i("pizz_lo", 45, "C2", "G4", "strings", pan=0.2, rev=0.26, hp=50, trim=2.0, human_ms=9),
    _i("pizz_bass", 45, "C1", "G3", "strings", pan=0.1, width=0.4, rev=0.2, hp=28, lp=3000, trim=3.0,
       human_ms=9),
    _i("harp", 46, "C1", "G7", "keys", pan=-0.5, rev=0.36, hp=60, trim=1.0),
    # ---- woodwinds ------------------------------------------------------------------------
    _i("flute", 73, "C4", "C7", "winds", pan=-0.12, width=0.3, rev=0.36, hp=220),
    _i("piccolo", 72, "D5", "C8", "winds", pan=-0.2, width=0.3, rev=0.36, hp=450, trim=-2.0),
    _i("oboe", 68, "Bb3", "A6", "winds", pan=0.08, width=0.3, rev=0.34, hp=200, trim=-2.0),
    _i("english_horn", 69, "E3", "Bb5", "winds", pan=0.1, width=0.3, rev=0.36, hp=140, trim=-1.0),
    _i("clarinet", 71, "D3", "Bb6", "winds", pan=-0.1, width=0.3, rev=0.34, hp=120, trim=-3.0),
    _i("bassoon", 70, "Bb1", "Eb5", "winds", pan=0.14, width=0.3, rev=0.30, hp=50, trim=0.0),
    # ---- brass ----------------------------------------------------------------------------
    _i("horns", 60, "B1", "F5", "brass", pan=-0.3, width=0.7, rev=0.42, hp=70, trim=-1.5, human_ms=8),
    _i("horns_marc", 60, "B1", "F5", "brass", pan=-0.3, width=0.7, rev=0.40, hp=70, trim=-1.5, ofs=1800,
       atk_ms=5, human_ms=8),
    _i("trumpets", 56, "E3", "C6", "brass", pan=0.2, width=0.3, rev=0.38, hp=150, trim=3.0, human_ms=6),
    _i("trumpet_muted", 59, "E3", "C6", "brass", pan=0.2, width=0.3, rev=0.42, hp=180, trim=-3.0),
    _i("trombones", 57, "E2", "Bb4", "brass", pan=0.24, width=0.3, rev=0.36, hp=60, trim=-7.0, human_ms=6),
    _i("tuba", 58, "D1", "F4", "brass", pan=0.14, width=0.3, rev=0.28, hp=30, lp=3500, trim=-2.0),
    _i("brass_section", 61, "E2", "C6", "brass", pan=0.25, width=0.6, rev=0.4, hp=80, trim=-2.0),
    # ---- choir ----------------------------------------------------------------------------
    _i("sopranos", 52, "C4", "A5", "choir", pan=-0.28, rev=0.55, hp=200, trim=1.5, human_ms=10),
    _i("altos", 52, "G3", "D5", "choir", pan=0.28, rev=0.55, hp=150, trim=1.5, human_ms=10),
    _i("tenors", 52, "C3", "G4", "choir", pan=-0.1, rev=0.55, hp=110, trim=1.0, human_ms=10),
    _i("choir_basses", 52, "D2", "D4", "choir", pan=0.14, rev=0.5, hp=65, trim=1.0, human_ms=10),
    # "ooh" layer: quicker speech, used under the "aah" and for soft passages
    _i("women_ooh", 53, "G3", "A5", "choir", pan=0.0, rev=0.6, hp=180, trim=-2.0, human_ms=10),
    _i("men_ooh", 53, "D2", "G4", "choir", pan=0.05, rev=0.55, hp=70, trim=3.0, human_ms=10),
    # choir "hits": the aah with its slow onset cut, for short accented chords
    _i("women_hit", 52, "G3", "A5", "choir", pan=0.0, rev=0.5, hp=160, trim=2.5, ofs=7000, atk_ms=8,
       human_ms=6),
    _i("men_hit", 52, "D2", "G4", "choir", pan=0.05, rev=0.5, hp=70, trim=2.0, ofs=7000, atk_ms=8,
       human_ms=6),
    # ---- pitched percussion and keys --------------------------------------------------------
    _i("timpani", 47, "D2", "A3", "perc", pan=-0.12, width=0.6, rev=0.34, hp=38, trim=4.0, human_ms=3),
    _i("tubular_bells", 14, "C4", "G5", "perc", pan=-0.38, width=0.6, rev=0.5, hp=180, trim=-1.0,
       human_ms=3),
    _i("church_bell", 14, "C3", "C5", "perc", pan=0.0, width=0.6, rev=0.5, hp=90, trim=0.0, human_ms=3,
       bank=8),
    _i("celesta", 8, "C4", "C8", "keys", pan=-0.34, width=0.5, rev=0.45, hp=200, trim=0.0),
    _i("glockenspiel", 9, "G5", "C8", "keys", pan=-0.3, width=0.5, rev=0.45, hp=500, trim=-5.0),
    _i("harpsichord", 6, "F1", "F6", "keys", pan=-0.08, width=0.5, rev=0.3, hp=70, trim=-1.0),
    _i("organ_pedal", 19, "C1", "C3", "keys", pan=0.0, width=0.5, rev=0.4, hp=28, lp=400, trim=-2.0,
       human_ms=2),
    _i("taiko", 116, "C2", "C4", "perc", pan=0.12, width=0.5, rev=0.36, hp=32, trim=-2.0, human_ms=3,
       pitched=False),
    _i("reverse_cymbal", 119, "C4", "C6", "perc", pan=0.08, width=0.7, rev=0.4, hp=300, trim=-3.0,
       human_ms=0, pitched=False),
    # ---- the orchestral percussion kit (channel 10, program 48) ------------------------------
    _i("percussion", 48, 27, 88, "perc", pan=0.0, width=0.55, rev=0.3, hp=30, trim=0.0, human_ms=2.5,
       drums=True, pitched=False),
    _i("snare", 48, 27, 88, "perc", pan=0.06, width=0.4, rev=0.3, hp=110, trim=5.0, human_ms=2.5,
       drums=True, pitched=False),
    _i("bass_drum", 48, 27, 88, "perc", pan=0.0, width=0.3, rev=0.26, hp=28, lp=6000, trim=4.0,
       human_ms=2.5, drums=True, pitched=False),
    _i("cymbals", 48, 27, 88, "perc", pan=0.1, width=0.8, rev=0.36, hp=250, trim=1.0, human_ms=2.5,
       drums=True, pitched=False),
]

INSTRUMENTS: dict[str, Instrument] = {i.key: i for i in _ALL}

# Orchestral kit note numbers (FluidR3_GM bank 128, program 48)
BASS_DRUM = 36
SNARE = 38
SNARE_ALT = 40          # the same drum a few cents lower: alternated so repeats do not sound cloned
RIM = 37
STICKS = 31
CRASH = 57              # orchestral crash cymbals, long ring
CRASH_SHORT = 59        # the same pair, damped
SPLASH = 55
TAIKO_SHORT = 86
TAIKO_LONG = 87
WOODBLOCK_HI = 76
WOODBLOCK_LO = 77
TRIANGLE = 81
TAMBOURINE = 54
CASTANET = 85
