"""Checks every shape builder: faces point outward, triangle counts are as documented,
directions mean what the README says.

    /opt/mbtools/venv/bin/python tools/art/tests/test_builders.py
"""
import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
import mb  # noqa: E402


def close(a, b, tol=1e-5):
    return abs(a - b) <= tol * max(1.0, abs(b))


def main() -> int:
    outline = [(0, 0), (2, 0), (2, 1), (1, 2), (0, 1)]
    cases = [
        # name, geometry, expected volume (None: just positive), expected triangles
        ("box", mb.box((2, 3, 4)), 24.0, 12),
        ("box anchor=bottom", mb.box((2, 3, 4), at=(1, 1, 0), anchor="bottom"), 24.0, 12),
        ("tapered_box", mb.tapered_box((2, 2), (1, 1), 3), 7.0, 12),
        ("tapered_box open ends", mb.tapered_box((2, 2), (1, 1), 3, cap_bottom=False, cap_top=False), None, 8),
        ("pyramid", mb.pyramid((2, 2), 3), 4.0, 6),
        ("roof ridge", mb.tapered_box((2, 2), (2, 0), 1), 2.0, 8),
        ("wedge back", mb.wedge((2, 3, 4)), 12.0, 8),
        ("wedge left", mb.wedge((2, 3, 4), high="left"), 12.0, 8),
        ("wedge front", mb.wedge((2, 3, 4), high="front"), 12.0, 8),
        ("wedge right", mb.wedge((2, 3, 4), high="right"), 12.0, 8),
        ("prism 6", mb.prism(6, 1, 2), 2 * 6 * 0.5 * math.sin(math.pi / 3), 20),
        ("cone 8", mb.cone(8, 1, 3), 8 * 0.5 * math.sin(math.pi / 4), 14),
        ("lathe", mb.lathe([(0, 0), (1, 1), (1, 2), (0, 3)], 8), None, 32),
        ("lathe top-down", mb.lathe([(0, 3), (1, 2), (1, 1), (0, 0)], 8), None, 32),
        ("sphere 8x4", mb.sphere(1, 8, 4), None, 48),
        ("icosphere 0", mb.icosphere(1, 0), None, 20),
        ("icosphere 1", mb.icosphere(1, 1), None, 80),
        ("extrude x", mb.extrude(outline, 3, "x"), 9.0, 16),
        ("extrude x, reversed outline", mb.extrude(outline[::-1], 3, "x"), 9.0, 16),
        ("extrude y", mb.extrude(outline, 3, "y"), 9.0, 16),
        ("extrude z, concave", mb.extrude([(0, 0), (3, 0), (3, 1), (1, 1), (1, 3), (0, 3)], 2, "z"), 10.0, 20),
        ("beam", mb.beam((0, 0, 0), (1, 2, 3), (0.5, 0.25)), 0.125 * math.sqrt(14), 12),
        ("beam sideways", mb.beam((0, 0, 1), (3, 0, 1), (0.5, 0.25), (0.2, 0.1)), None, 12),
        ("beam open start", mb.beam((0, 0, 0), (0, -1, 0), (0.5, 0.5), cap_start=False), None, 10),
        ("rod", mb.rod((0, 0, 0), (0, -2, 0), 0.2, 0.1), None, 20),
        ("spike", mb.rod((0, 0, 0), (0, 0, 2), 0.2, 0), None, 10),
        ("loft y", mb.loft([mb.section(6, 1, 1, (0, 0, 1)), mb.section(6, 2, 1.5, (0, 1, 1)),
                            mb.section(6, 0, 0, (0, 3, 1.2))]), None, 22),
        ("loft y reversed", mb.loft([mb.section(6, 0, 0, (0, 3, 1.2)), mb.section(6, 2, 1.5, (0, 1, 1)),
                                     mb.section(6, 1, 1, (0, 0, 1))]), None, 22),
        ("loft z", mb.loft([mb.section(4, 1, 1, (0, 0, 0), "z"), mb.section(4, 2, 2, (0, 0, 1), "z")]), None, 12),
        ("loft x", mb.loft([mb.section(5, 1, 1, (0, 0, 0), "x"), mb.section(5, 2, 2, (1, 0, 0), "x")]), None, 16),
        ("mirrored", mb.wedge((2, 3, 4)).move(3, 0, 0).mirrored(), 12.0, 8),
        ("negative scale", mb.box((1, 1, 1)).scale(1, -2, 1), 2.0, 12),
        ("rotations", mb.box((1, 2, 3)).rx(33).ry(-70).rz(12), 6.0, 12),
        ("triangulate", mb.box((1, 2, 3)).triangulate(), 6.0, 12),
        ("from_data", mb.from_data([(0, 0, 0), (1, 0, 0), (0, 1, 0), (0, 0, 1)],
                                   [(0, 2, 1), (0, 1, 3), (1, 2, 3), (2, 0, 3)]), 1 / 6, 4),
        ("shatter_box", sum(mb.shatter_box((-1, -1, 0), (1, 1, 3), cuts=(2, 2, 3)), mb.Geo()), 12.0, 144),
    ]
    bad = 0
    for name, g, vol, tris in cases:
        v = g.volume()
        ok = v > 0 and (vol is None or close(v, vol)) and g.tris == tris
        bad += not ok
        print(f"{'PASS' if ok else 'FAIL'}  {name:<30} volume {v:8.4f}{'' if vol is None else f' (want {vol:.4f})'}"
              f"  triangles {g.tris} (want {tris})")

    def expect(label, cond):
        nonlocal bad
        bad += not cond
        print(f"{'PASS' if cond else 'FAIL'}  {label}")

    b = mb.box((2, 3, 4))
    expect("'front' faces point to -Y (the model's front)", b.face_normal(b.select("front")[0]).y < -0.9)
    expect("'left' faces point to +X (the model's left)", b.face_normal(b.select("left")[0]).x > 0.9)
    expect("'top' faces point to +Z", b.face_normal(b.select("top")[0]).z > 0.9)
    w = mb.wedge((2, 3, 4), high="left")
    lo, hi = w.bounds()
    expect("wedge keeps its footprint when the tall side is left",
           close((hi - lo).x, 2) and close((hi - lo).y, 3) and all(p.x > 0.9 for p in w.v if p.z > 3.9))
    w = mb.wedge((2, 3, 4), high="front")
    expect("wedge high='front' is tall at the front", all(p.y < -1.4 for p in w.v if p.z > 3.9))
    g = mb.beam((1, 1, 1), (1, -3, 1), (0.4, 0.2))
    lo, hi = g.bounds()
    expect("beam: width stays left-right, thickness up-down, length exact",
           close(lo.y, -3) and close(hi.y, 1) and close((hi - lo).x, 0.4) and close((hi - lo).z, 0.2))
    expect("atlas_rect: row 0 is the top row of the image",
           mb.atlas_rect(0, 0, (8, 8), inset=0) == (0.0, 0.875, 0.125, 1.0))
    expect("prism: a flat side faces the front by default",
           close(min(p.y for p in mb.ring(6, 1)), -math.cos(math.pi / 6)))
    expect("to_gltf: authoring (x, y, z) lands at (x, z, -y)", mb.to_gltf((1, 2, 3)) == (1.0, 3.0, -2.0))
    expect("palette: names, hex and tuples all resolve",
           mb.palette.rgb("kaiju_orange") == mb.palette.rgb("#ff7a1a") and mb.palette.rgb((1, 0, 0)) == (1.0, 0.0, 0.0))
    try:
        mb.box((1, 1, 1), color="no_such_color")
        expect("unknown color names are rejected", False)
    except KeyError:
        expect("unknown color names are rejected", True)
    try:
        mb.box((1, 1, 1), mat="Plaster")
        expect("unknown material names are rejected", False)
    except ValueError:
        expect("unknown material names are rejected", True)
    print("BUILDER TEST PASSED" if not bad else f"BUILDER TEST FAILED ({bad})")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
