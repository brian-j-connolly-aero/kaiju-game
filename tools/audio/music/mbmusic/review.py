"""Composer's review of the written score, before anything is rendered.

Checks every cue for:
  - notes outside the real range of the instrument (or section, or voice type)
  - muddy low intervals: thirds or seconds sounding below C3, anything but octaves and fifths
    below F2, counted across all parts and stems of the cue together
  - stems of one cue that are not the same length
and prints the score at a glance: who plays in which bar and how loud (0-9, from velocity).
"""
from __future__ import annotations

from collections import defaultdict

from .score import BEATS_PER_BAR, Cue, pitch, pitch_name

C3 = pitch("C3")
F2 = pitch("F2")
STEP = 0.125            # beats


def _glance(cue: Cue) -> list[str]:
    bars = int(round(cue.bars))
    rows = []
    for stem in cue.stems:
        for part in stem.parts:
            cells = []
            for bar in range(bars):
                vels = [v for s, d, p, v in part.notes
                        if bar * BEATS_PER_BAR <= s < (bar + 1) * BEATS_PER_BAR]
                held = any(s < bar * BEATS_PER_BAR < s + d - 0.26 for s, d, p, v in part.notes)
                if vels:
                    cells.append(str(min(9, int(round(sum(vels) / len(vels) / 13.5)))))
                else:
                    cells.append("-" if held else " ")
            row = "".join(cells)
            row = " ".join(row[i:i + 4] for i in range(0, len(row), 4))
            lo = min((p for _, _, p, _ in part.notes), default=0)
            hi = max((p for _, _, p, _ in part.notes), default=0)
            rng = f"{pitch_name(lo)}-{pitch_name(hi)}" if part.inst.pitched and part.notes else ""
            rows.append(f"  {stem.name[-6:]:>6s} {part.name[:20]:20s} {part.inst.key[:13]:13s} |{row}| {rng}")
    return rows


def _range_errors(cue: Cue) -> list[str]:
    out = []
    for stem in cue.stems:
        for part in stem.parts:
            if not part.inst.pitched:
                continue
            bad = sorted({p for _, _, p, _ in part.notes if not part.inst.lo <= p <= part.inst.hi})
            if bad:
                out.append(f"  RANGE {stem.name}/{part.name} ({part.inst.key} "
                           f"{pitch_name(part.inst.lo)}-{pitch_name(part.inst.hi)}): "
                           + " ".join(pitch_name(p) for p in bad))
    return out


def _low_interval_errors(cue: Cue) -> list[str]:
    """Scan the cue in steps of a 32nd note and collect every low pair that sounds muddy."""
    notes = []
    for stem in cue.stems:
        for part in stem.parts:
            if not part.inst.pitched:
                continue
            # plucked and struck notes die away: only their first beat counts as sounding
            short = part.inst.key.startswith("pizz") or part.inst.key in (
                "timpani", "harp", "harpsichord", "celesta", "tubular_bells", "church_bell")
            for s, d, p, v in part.notes:
                if p < 60:
                    notes.append((s, s + (min(d, 1.0) if short else d), p, f"{stem.name[-6:]}/{part.name}"))
    found: dict[tuple, float] = defaultdict(float)
    first: dict[tuple, float] = {}
    n_steps = int(round(cue.beats / STEP))
    for i in range(n_steps):
        t = i * STEP + STEP / 2
        sounding = [(p, who) for s, e, p, who in notes if s <= t < e - 0.05]
        pitches = sorted({p for p, _ in sounding})
        for a_i, a in enumerate(pitches):
            for b in pitches[a_i + 1:]:
                iv = b - a
                if iv >= 12:
                    continue
                bad = (a < F2 and iv not in (0, 7)) or (a < C3 and iv in (1, 2, 3, 4)) \
                    or (a < C3 + 4 and iv in (1, 2))
                if bad:
                    who = tuple(sorted({w for p, w in sounding if p in (a, b)}))
                    key = (a, b, who)
                    found[key] += STEP
                    first.setdefault(key, t)
    out = []
    for (a, b, who), beats in sorted(found.items(), key=lambda kv: first[kv[0]]):
        if beats < 1.0:                      # short passing clashes are not mud
            continue
        bar = int(first[(a, b, who)] // BEATS_PER_BAR) + 1
        out.append(f"  LOW   {pitch_name(a)}+{pitch_name(b)} for {beats:g} beats, first in bar {bar}: "
                   + ", ".join(who))
    return out


def review_cue(cue: Cue) -> tuple[list[str], list[str]]:
    errors = _range_errors(cue) + _low_interval_errors(cue)
    for stem in cue.stems:
        for part in stem.parts:
            over = part.end_beat() - cue.beats
            if not cue.loop and over > 0.01 + cue.tail_seconds / 0.625:
                errors.append(f"  LENGTH {stem.name}/{part.name} runs {over:g} beats past the end")
    return _glance(cue), errors


def run(cues: list[Cue]) -> int:
    total = 0
    for cue in cues:
        glance, errors = review_cue(cue)
        bars = int(round(cue.bars))
        ruler = " ".join(f"{b:<4d}" for b in range(1, bars + 1, 4))
        print(f"\n== {cue.name}: {cue.title} ({cue.bars:g} bars, {'loop' if cue.loop else 'one-shot'}) ==")
        print(f"  {'':6s} {'':20s} {'bar':13s}  {ruler}")
        print("\n".join(glance))
        print("\n".join(errors) if errors else "  review: ranges ok, no muddy low intervals")
        total += len(errors)
    print(f"\n{total} finding(s)")
    return 1 if total else 0
