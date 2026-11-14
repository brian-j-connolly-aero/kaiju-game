"""Proves the export conventions with a deliberately lopsided model.

An arrow that points FORWARD, with a FIN on TOP and a KNOB on its LEFT. If any axis were
swapped or mirrored on the way to the game, one of the checks below would fail and the
pictures would show it at a glance.

    /opt/mbtools/venv/bin/python tools/art/tests/test_conventions.py

Writes the test model to /tmp/mb-scratch/art-tests/ (never into the game's assets) and two
contact sheets to docs/art/conventions/: one rendered from the scene that built the
model, one from the .glb loaded back in. They must look the same.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
import numpy as np  # noqa: E402

import glb  # noqa: E402
import mb  # noqa: E402

OUT = "/tmp/mb-scratch/art-tests"
DOCS = os.path.join(mb.REPO, "docs", "art", "conventions")


def build_arrow():
    mb.reset()
    # shaft: 0.4 wide, 2 long, 0.3 tall, centered on the origin, standing on the ground
    body = mb.box((0.4, 2.0, 0.3), at=(0, 0, 0), color="grey_light", anchor="bottom")
    # arrow head: points FORWARD (authoring -Y)
    body += mb.extrude([(-0.5, -1.0), (0.5, -1.0), (0.0, -2.0)], 0.3, axis="z", color="kaiju_orange")
    root = mb.node("arrow", body)
    # fin on TOP, toward the tail, with its own pivot at its base
    fin = mb.extrude([(0.2, 0.3), (0.9, 0.3), (0.9, 1.0)], 0.06, axis="x", color="human_cyan")
    mb.node("fin", fin, pivot=(0, 0.55, 0.3), parent=root)
    # knob on the model's LEFT (authoring +X)
    knob = mb.sphere(0.15, n=6, rings=3, at=(0.68, 0.3, 0.15), color="volley_yellow")
    knob += mb.beam((0.2, 0.3, 0.15), (0.6, 0.3, 0.15), (0.08, 0.08), color="volley_yellow")
    mb.node("knob_L", knob, pivot=(0.2, 0.3, 0.15), parent=root)
    # an anchor at the tip, like a muzzle, and one above the tail, like a chase camera
    mb.empty("tip", at=(0, -2.0, 0.15), parent=root)
    mb.empty("cam_tail", at=(0, 1.8, 0.9), parent=root)
    # a glowing tail light at the back
    lamp = mb.box((0.2, 0.05, 0.1), at=(0, 1.0, 0.2), color="glow_red", mat="glow", anchor="front")
    mb.node("lamp", lamp, pivot=(0, 1.0, 0.2), parent=root)


def check(label, ok, detail=""):
    print(("PASS  " if ok else "FAIL  ") + label + (f"  ({detail})" if detail else ""))
    return bool(ok)


def main() -> int:
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, "test_arrow.glb")
    build_arrow()
    mb.export_glb(path)
    first = open(path, "rb").read()
    sheet_scene = mb.contact_sheet("arrow_from_scene", out=os.path.join(DOCS, "arrow_from_scene.png"),
                                   title="test arrow: rendered from the scene that built it",
                                   extra=["top", mb.View("FROM THE cam_tail ANCHOR", node="cam_tail", fov=80)])
    # same build again must give the same bytes (reproducible builds)
    build_arrow()
    mb.export_glb(path)
    ok = check("export is reproducible (same bytes twice)", open(path, "rb").read() == first)

    g = glb.load(path)
    arrow, fin, knob, tip, lamp = (g.node(n) for n in ("arrow", "fin", "knob_L", "tip", "lamp"))
    ok &= check("all nodes are in the file", all(n is not None for n in (arrow, fin, knob, tip, lamp)),
                ", ".join(g.node_names()))
    lo, hi = g.bounds()
    # where the arrow head's point is: the vertex furthest from the tail
    head_z = g.world_positions([arrow])[:, 2].max()
    ok &= check("forward is +Z in the file: the arrow head is the furthest +Z point",
                abs(head_z - 2.0) < 1e-5 and abs(lo[2] + 1.05) < 1e-5, f"head z = {head_z:.3f}, tail z = {lo[2]:.3f}")
    ok &= check("the tip anchor sits at the head, at +Z", np.allclose(tip.position, [0, 0.15, 2.0], atol=1e-6),
                f"tip = {np.round(tip.position, 3).tolist()}")
    fin_pts = g.world_positions([fin])
    ok &= check("up is +Y in the file: the fin is the highest part",
                abs(fin_pts[:, 1].max() - hi[1]) < 1e-6 and abs(hi[1] - 1.0) < 1e-5, f"top y = {hi[1]:.3f}")
    ok &= check("the fin is toward the tail (-Z)", fin_pts[:, 2].max() < 0, f"fin z max = {fin_pts[:, 2].max():.3f}")
    ok &= check("the model stands on y = 0", abs(lo[1]) < 1e-6, f"min y = {lo[1]:.4f}")
    knob_pts = g.world_positions([knob])
    ok &= check("left is +X in the file: the knob is on +X only (not mirrored)",
                knob_pts[:, 0].min() > 0.2 and hi[0] > 0.52 and abs(lo[0] + 0.5) < 1e-5,
                f"knob x = {knob_pts[:, 0].min():.3f}..{knob_pts[:, 0].max():.3f}")
    ok &= check("pivots survive: fin pivot at its base", np.allclose(fin.position, [0, 0.3, -0.55], atol=1e-6),
                f"fin pivot = {np.round(fin.position, 3).tolist()}")
    # handedness: forward x up must point to the model's right (-X) in a right-handed file,
    # i.e. left = up x forward = +X. Use the measured part positions.
    fwd = tip.position - arrow.position
    up = np.array([0.0, fin_pts[:, 1].max(), 0.0])
    left = np.cross(up, fwd)
    ok &= check("handedness: up x forward points at the knob", float(np.dot(left, knob.position)) > 0)
    # vertex colors arrive as linear COLOR_0 and decode to the palette's hex values
    prim = g.meshes[knob.mesh][0]
    hexes = {glb.to_hex(c) for c in prim.colors}
    ok &= check("vertex colors decode to the palette color", hexes == {mb.PALETTE["volley_yellow"]},
                f"knob COLOR_0 -> {sorted(hexes)}")
    ok &= check("the lamp uses the glow material", g.node_materials("lamp") == ["glow"])

    # second sheet: from the file, which is what a reviewer would do
    mb.load_glb(path)
    sheet_file = mb.contact_sheet("arrow_from_glb", out=os.path.join(DOCS, "arrow_from_glb.png"),
                                  title="test arrow: rendered from the exported .glb",
                                  extra=["top", mb.View("FROM THE cam_tail ANCHOR", node="cam_tail", fov=80)])
    from PIL import Image, ImageChops
    a = Image.open(sheet_scene).convert("RGB")
    b = Image.open(sheet_file).convert("RGB")
    # ignore the title strip, which differs on purpose
    box = (0, 46, a.width, a.height)
    diff = np.asarray(ImageChops.difference(a.crop(box), b.crop(box)), dtype=np.float64)
    ok &= check("scene render and .glb render match", diff.mean() < 0.6, f"mean pixel difference {diff.mean():.3f} / 255")

    # the picture itself: in the FRONT view the model faces the viewer, so its left (the
    # yellow knob) must be on the viewer's RIGHT, and the cyan fin must be above the body.
    front = np.asarray(b.crop((0, 46, 600, 46 + 450)), dtype=np.int32)
    yellow = (abs(front[..., 0] - 255) < 60) & (abs(front[..., 1] - 217) < 60) & (front[..., 2] < 110)
    cyan = (front[..., 0] < 110) & (front[..., 1] > 140) & (front[..., 2] > 170)
    orange = (front[..., 0] > 200) & (abs(front[..., 1] - 122) < 50) & (front[..., 2] < 90)
    ys, xs = np.nonzero(yellow)
    cy, cx = np.nonzero(cyan)
    oy, ox = np.nonzero(orange)
    ok &= check("render: the knob shows on the viewer's right in the front view",
                len(xs) > 50 and xs.mean() > 300 + 40, f"knob at x = {xs.mean():.0f} of 600" if len(xs) else "no yellow")
    ok &= check("render: the fin shows above the arrow head in the front view",
                len(cy) > 50 and len(oy) > 50 and cy.mean() < oy.mean() - 20,
                f"fin y = {cy.mean():.0f}, head y = {oy.mean():.0f} (0 is the top)" if len(cy) and len(oy) else "missing")
    # side view (camera at the model's left): head toward the viewer's left, knob visible
    side = np.asarray(b.crop((602, 46, 1202, 46 + 450)), dtype=np.int32)
    orange_s = (side[..., 0] > 200) & (abs(side[..., 1] - 122) < 50) & (side[..., 2] < 90)
    yellow_s = (abs(side[..., 0] - 255) < 60) & (abs(side[..., 1] - 217) < 60) & (side[..., 2] < 110)
    cyan_s = (side[..., 0] < 110) & (side[..., 1] > 140) & (side[..., 2] > 170)
    _, osx = np.nonzero(orange_s)
    _, csx = np.nonzero(cyan_s)
    ok &= check("render: in the left-side view the head points to the viewer's left, fin to the right",
                len(osx) > 50 and len(csx) > 50 and osx.mean() < csx.mean() - 50,
                f"head x = {osx.mean():.0f}, fin x = {csx.mean():.0f}" if len(osx) and len(csx) else "missing")
    ok &= check("render: the knob is visible from the left side", yellow_s.sum() > 200, f"{int(yellow_s.sum())} px")
    print("\n" + ("ALL CONVENTION CHECKS PASSED" if ok else "CONVENTION CHECKS FAILED"))
    print("sheets:", os.path.relpath(sheet_scene, mb.REPO), os.path.relpath(sheet_file, mb.REPO))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
