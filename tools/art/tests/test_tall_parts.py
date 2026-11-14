"""A slim part may stand above its archetype's box (contract.TALL_PARTS: the firehouse's hose
tower, 12 m on a 9 m building). The fit check then asks for that height, and nothing else
changes: the size class and the budget still come from the archetype's box, and every other
archetype must still fill its box exactly.

    /opt/mbtools/venv/bin/python tools/art/tests/test_tall_parts.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "lib"))
sys.path.insert(0, os.path.join(HERE, ".."))

import contract  # noqa: E402
from city import kit  # noqa: E402


def check(label, ok, detail=""):
    print(("PASS  " if ok else "FAIL  ") + label + (f"  ({detail})" if detail else ""))
    return bool(ok)


def boxy(aid, top):
    """The archetype's box as one block, plus a 2 m square tower up to `top` (if above it)."""
    b = kit.Building(aid)
    b.block(b.W, b.D, b.H, roof="gravel")
    if top > b.H:
        b.box((b.W / 2 - 2, b.D / 2 - 2, 0.0), (b.W / 2, b.D / 2, top), region="brick_plain")
    return b


def main() -> int:
    ok = True
    arch = contract.archetypes()
    for aid, top in contract.TALL_PARTS.items():
        a = arch.get(aid)
        if not check(f"{aid} is an archetype", a is not None):
            ok = False
            continue
        h = float(a["height"])
        ok &= check(f"{aid}: the tall part is above the box", top > h, f"{top} m over {h} m")
        ok &= check(f"{aid}: the fit check asks for the tall part", boxy(aid, top).fit() == [], str(boxy(aid, top).fit()))
        ok &= check(f"{aid}: without it the model does not fit", boxy(aid, h).fit() != [])
        ok &= check(f"{aid}: size class still from the box", contract.size_class("bld_" + aid) == a.get("sizeClass"),
                    f"{contract.size_class('bld_' + aid)} vs {a.get('sizeClass')}")
    ok &= check("an ordinary archetype may not stand above its box", boxy("house_a", arch["house_a"]["height"] + 3).fit() != [])
    ok &= check("... and fits when it fills it", boxy("house_a", arch["house_a"]["height"]).fit() == [])
    print("test_tall_parts:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
