#!/opt/mbtools/venv/bin/python
# mb-family: example order=90
"""Worked example for tools/art/README.md: one street prop, start to finish.

    /opt/mbtools/venv/bin/python tools/art/example.py             build, validate, preview
    /opt/mbtools/venv/bin/python tools/art/example.py --no-previews   geometry only (fast)

Writes client/public/assets/models/prop_hydrant.glb, docs/art/previews/prop_hydrant.png,
docs/art/concept/prop_hydrant.png and client/public/assets/manifest.example.json.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))
import mb  # noqa: E402


@mb.asset("prop_hydrant", kind="prop", concept=dict(backdrop="sky", azimuth=28, elevation=14))
def hydrant():
    """A fire hydrant, 0.9 m tall: stubby, red, readable from a rooftop. Budget: 80 triangles."""
    # Everything is in meters. Up is +Z, the front of the model is -Y, its left is +X.
    g = mb.Geo()

    # Foot and barrel in one go. A lathe profile is a list of (radius, height) points spun
    # around the vertical axis. No bottom cap: nobody sees under a hydrant.
    g += mb.lathe([(0.20, 0.0), (0.15, 0.09), (0.13, 0.63)], n=6, colors=["red_dk", "red"],
                  cap_bottom=False, cap_top=False)

    # Bonnet: a wider collar that closes to a point (radius 0), then the operating nut.
    g += mb.lathe([(0.18, 0.63), (0.18, 0.72), (0.0, 0.85)], n=6, colors=["red", "red_lt"],
                  cap_bottom=False)
    g += mb.prism(3, 0.05, 0.09, at=(0, 0, 0.81), color="grey_light", cap_bottom=False)

    # Outlets: one big one at the front, a smaller one on each side. A beam is a bar
    # between two points. The end buried in the barrel is left open (cap_start=False) to
    # save triangles; the visible cap gets its own color so it reads as metal.
    front = mb.beam((0, -0.08, 0.42), (0, -0.25, 0.42), (0.17, 0.17), (0.14, 0.14), color="red_dk",
                    cap_start=False)
    front.paint("grey_light", where="front")
    g += front
    left = mb.beam((0.08, 0, 0.49), (0.23, 0, 0.49), (0.115, 0.115), (0.095, 0.095), color="red_dk",
                   side=mb.FWD, cap_start=False)
    left.paint("grey_light", where="left")
    g += left
    g += left.mirrored()          # the right-hand outlet is the left one, mirrored

    # A touch of painted-in sky light and facet variation so the facets read.
    g.bake_light(top=1.06, bottom=0.8).jitter(0.035, seed=7)

    # One mesh, named after the asset, origin on the ground at the center: that is a prop.
    mb.node("prop_hydrant", g)


if __name__ == "__main__":
    raise SystemExit(mb.run_family("example"))
