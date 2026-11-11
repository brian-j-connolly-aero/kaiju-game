"""The cue list. Each module has build() returning a Cue (or build_all() returning several)."""
from importlib import import_module

MODULES = ["lobby", "briefing", "stage1", "stage2", "stage3", "cocoon", "intermission", "win", "hearing"]


def all_cues(only=None):
    cues = []
    for name in MODULES:
        try:
            mod = import_module(f"{__name__}.{name}")
        except ModuleNotFoundError:
            continue
        built = mod.build_all() if hasattr(mod, "build_all") else [mod.build()]
        cues.extend(built)
    if only:
        cues = [c for c in cues if c.name in only or any(s.name in only for s in c.stems)]
    return cues
