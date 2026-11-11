"""The list of sound effects: every generator function registers itself here."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

import numpy as np

FAMILIES = ("kaiju", "humans", "world", "ui", "tier2")


@dataclass
class Spec:
    id: str
    family: str
    fn: Callable[[np.random.Generator, int], np.ndarray]
    variants: int = 1          # files <id>_1.. when more than one, otherwise just <id>
    loop: float = 0.0          # loop body length in seconds (0: one-shot)
    level: float = -16.0       # target loudness in dB (see dsp.level_short / dsp.level_loop)
    use: str = ""              # intended use, for docs/audio/SFX.md
    group: str = ""            # sounds that are measured against each other (for example "step")
    clip: bool = False         # impacts: soft-clip the peaks instead of limiting them

    def names(self) -> list[str]:
        if self.variants > 1:
            return [f"{self.id}_{i}" for i in range(1, self.variants + 1)]
        return [self.id]


REGISTRY: dict[str, Spec] = {}


def sfx(id: str, family: str, *, variants: int = 1, loop: float = 0.0, level: float = -16.0,
        use: str = "", group: str = "", clip: bool = False):
    """Register a generator: fn(rng, variant) -> mono (n,) or stereo (n, 2) float array.
    Loop generators return exactly one seamless pass of `loop` seconds."""
    assert family in FAMILIES, family

    def deco(fn):
        assert id not in REGISTRY, f"duplicate sound id {id}"
        REGISTRY[id] = Spec(id, family, fn, variants, loop, level, use, group, clip)
        return fn

    return deco


def load_all() -> dict[str, Spec]:
    from . import humans, kaiju, ui, world  # noqa: F401  (importing registers the sounds)
    from . import tier2  # noqa: F401  (last, so the Tier 2 sounds follow the others in the manifest)
    return REGISTRY
