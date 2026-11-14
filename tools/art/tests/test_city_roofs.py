"""The city kit's roof mask (roadmap phase 3, "roofs colored by district").

Builds a small house with the kit (house_a's archetype: a gable roof in clay tiles, a flat
gravel roof on a wing, a plain canopy roof, a chimney, a skylight) into
/tmp/mb-scratch/art-tests/bld_roof_test.glb, never into the game's assets, and checks the file:
roof faces carry COLOR_0 alpha 0.5 and sit on the grey roof regions in every state that shows
a roof (intact, damaged, the roof piece on the rubble, the chunks); walls that take the
building's color carry 1; trim, chimney, skylight and undersides 0. Also: the grey roofs stand
in for the colored ones at the same size and all average the roof base in linear light, and
landmarks, bridges and the archetypes in style.OWN_ROOFS keep their own roofs.

    /opt/mbtools/venv/bin/python tools/art/tests/test_city_roofs.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "lib"))
sys.path.insert(0, os.path.join(HERE, ".."))
import numpy as np  # noqa: E402

import glb  # noqa: E402
import mb  # noqa: E402
from city import atlas, destruct, kit, style  # noqa: E402

OUT = "/tmp/mb-scratch/art-tests"


def check(label, ok, detail=""):
    print(("PASS  " if ok else "FAIL  ") + label + (f"  ({detail})" if detail else ""))
    return bool(ok)


def build(path):
    b = kit.Building("house_a", district="suburb", tone="cream", seed=3)
    main = b.block(6.0, 9.25, 3.4, at=(-1.125, 0.0, 0.0), facade="plaster_sash", roof=False)
    b.gable(main, rise=2.6, along="y", roof="tile_red")
    b.chimney(-3.0, 1.8, 3.0, 5.9, region="brick_plain")
    wing = b.block(2.25, 6.0, 2.6, at=(3.0, 1.25, 0.0), facade="plaster_plain", roof="gravel", sides={"right": None})
    b.box((wing.x0 + 0.2, wing.y0 - 1.2, 2.2), (wing.x1 - 0.2, wing.y0, 2.35), color="#f2efe8", top="roof_plain",
          bottom=True)                                                         # a canopy with a plain roof
    b.box((2.5, 1.0, 2.6), (3.5, 2.0, 2.7), color="#f2efe8", top="glass_roof")  # a skylight: glass, no mask
    roofs = kit.grey_roofs(b)
    states = destruct.derive(b)
    mb.reset()
    kit.make_node("intact", b.intact)
    kit.make_node("damaged", states.damaged)
    kit.make_node("rubble", states.rubble)
    for i, ch in enumerate(states.chunks):
        lo, hi = ch.bounds()
        kit.make_node(f"chunk_{i:02d}", ch, pivot=tuple((lo + hi) / 2))
    mb.export_glb(path)
    return roofs


def region_at(uv):
    """The atlas region a triangle's texture coordinates fall in (glTF: v runs down)."""
    xs, ys = uv[:, 0] * atlas.W, uv[:, 1] * atlas.H
    for name, r in atlas.REGIONS.items():
        if xs.min() >= r.x - 0.01 and xs.max() <= r.x + r.w + 0.01 and ys.min() >= r.y - 0.01 and ys.max() <= r.y + r.h + 0.01:
            return name
    return None


def main() -> int:
    os.makedirs(OUT, exist_ok=True)
    atlas.load_extensions()
    ok = True
    # who takes a roof color
    ok &= check("ordinary buildings take the district's roof color",
                kit.roof_masked("house_a") and kit.roof_masked("shop_b") and kit.roof_masked("tower_a"))
    ok &= check("landmarks, bridges and the own-roof archetypes do not",
                not any(kit.roof_masked(a) for a in ("city_hall", "bridge_a", "gasstation_a", "tank_a"))
                and set(style.SPECIAL) <= set(style.OWN_ROOFS))
    # the grey roofs
    cv = atlas.paint_all()
    want = float(atlas._srgb_to_lin(atlas.hexrgb(atlas.ROOF_BASE))[0])
    bad = []
    for colored, grey in kit.GREY_ROOFS.items():
        a, g = atlas.region(colored), atlas.region(grey)
        if (a.w, a.h) != (g.w, g.h) or not g.roof or a.roof:
            bad.append(f"{grey} for {colored}")
    for name, r in atlas.REGIONS.items():
        if not r.roof:
            continue
        px = cv.col[r.y:r.y + r.h, r.x:r.x + r.w]
        mean = float(atlas._srgb_to_lin(px).mean())
        if abs(mean - want) > 0.01 * want or float(np.abs(px[..., 0] - px[..., 2]).max()) > 1.0:
            bad.append(f"{name} averages {mean:.4f} (want {want:.4f}) or is not grey")
    ok &= check("grey roofs: the colored roofs' size, neutral, each averaging the roof base", not bad, "; ".join(bad))
    # the mask in the file
    path = os.path.join(OUT, "bld_roof_test.glb")
    roofs = build(path)
    ok &= check("the kit moved the roofs onto the grey regions", roofs > 0, f"{roofs} roof faces")
    g = glb.load(path)
    count = {}            # node -> {0, 0.5, 1: triangles}
    wrong = []
    tintable = {n for n, r in atlas.REGIONS.items() if r.tint}
    for n in g.reachable():
        if n.mesh is None:
            continue
        c = count.setdefault(n.name, {0.0: 0, 0.5: 0, 1.0: 0})
        for p in g.meshes[n.mesh]:
            for tri in p.indices:
                a = float(p.colors[tri[0], 3])
                level = min((0.0, 0.5, 1.0), key=lambda v: abs(v - a))
                if abs(level - a) > 0.01:
                    wrong.append(f"{n.name}: alpha {a:.3f}")
                    continue
                c[level] += 1
                reg = region_at(p.uvs[tri])
                is_roof = bool(reg and atlas.region(reg).roof)
                if (level == 0.5) != is_roof:
                    wrong.append(f"{n.name}: alpha {level} on {reg}")
                if level == 1.0 and reg not in tintable:
                    wrong.append(f"{n.name}: wall mask on {reg}")
                if reg in kit.GREY_ROOFS:
                    wrong.append(f"{n.name}: colored roof {reg} left on an ordinary building")
    ok &= check("alpha is 0, 0.5 or 1; 0.5 exactly on the grey roofs; 1 only on tintable walls",
                not wrong, "; ".join(sorted(set(wrong))[:6]))
    ok &= check("intact: roofs 0.5, walls 1, the rest 0",
                all(count["intact"][v] > 0 for v in (0.0, 0.5, 1.0)), str(count["intact"]))
    ok &= check("damaged keeps its roof faces masked", count["damaged"][0.5] > 0, str(count["damaged"]))
    ok &= check("the rubble carries a masked piece of the roof", count["rubble"][0.5] > 0, str(count["rubble"]))
    chunk_roofs = sum(v[0.5] for k, v in count.items() if k.startswith("chunk_"))
    ok &= check("collapse chunks carry masked roof faces", chunk_roofs > 0, f"{chunk_roofs} triangles")
    print("CITY ROOFS TEST PASSED" if ok else "CITY ROOFS TEST FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
