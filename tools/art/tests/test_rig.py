"""Exercises everything a rigged model needs, on a crude box lizard.

Builds the full lizard node tree from docs/ASSETS.md out of boxes (pivots at joints, left
limbs mirrored to the right, anchors as empties, a glowing weak point), exports it to
/tmp/mb-scratch/art-tests/kaiju_lizard_s1.glb, validates it as a stage 1 lizard, then poses
it and renders a contact sheet with the first-person camera and a concept shot from the
file. It is a test and a pattern to copy, not art: the real lizard replaces every box.

    /opt/mbtools/venv/bin/python tools/art/tests/test_rig.py
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
import mb  # noqa: E402
import validation  # noqa: E402

OUT = "/tmp/mb-scratch/art-tests"
DOCS = os.path.join(mb.REPO, "docs", "art", "conventions")

BODY, BELLY, STRIPE = "gragnor_orange", "gragnor_cream", "gragnor_rust"


def build():
    """Stage 1 lizard blockout, 4.5 m tall. Authoring frame: +Z up, -Y forward, +X left."""
    mb.reset()
    root = mb.empty("root")

    # hips: pivot at the pelvis; everything hangs off it
    hips_p = (0, 0.3, 1.9)
    hips = mb.node("hips", mb.box((1.3, 1.3, 1.0), at=hips_p, color=BODY), pivot=hips_p, parent=root)

    # torso leans forward and up from the hips; pivot at the waist
    torso_g = mb.loft([mb.section(6, 1.3, 1.1, (0, 0.1, 2.3)), mb.section(6, 1.6, 1.5, (0, -0.4, 3.0)),
                       mb.section(6, 1.1, 1.0, (0, -0.8, 3.7))], color=BODY)
    torso_g.paint(BELLY, where=lambda c, n: n.y < -0.4)
    torso = mb.node("torso", torso_g, pivot=(0, 0.1, 2.3), parent=hips)

    neck = mb.node("neck", mb.beam((0, -0.8, 3.6), (0, -1.1, 4.0), (0.8, 0.7), (0.7, 0.6), color=BODY),
                   pivot=(0, -0.8, 3.6), parent=torso)
    head_g = mb.box((0.95, 0.75, 0.6), at=(0, -1.3, 4.2), color=BODY)                    # cranium
    head_g += mb.tapered_box((0.8, 0.35), (0.6, 0.25), 0.9, color=BODY).along((0, -1.6, 4.12), (0, -2.5, 4.05))
    head_g += mb.box((0.14, 0.05, 0.12), at=(0.3, -1.69, 4.36), color="glow_eye", mat="glow")
    head_g += mb.box((0.14, 0.05, 0.12), at=(-0.3, -1.69, 4.36), color="glow_eye", mat="glow")
    head = mb.node("head", head_g, pivot=(0, -1.1, 4.0), parent=neck)
    mb.node("jaw", mb.box((0.7, 1.3, 0.18), at=(0, -1.8, 3.85), color=BELLY), pivot=(0, -1.15, 3.9), parent=head)
    mb.empty("cam_fp", at=(0, -1.72, 4.42), parent=head)     # between the eyes, above the snout
    mb.empty("mouth", at=(0, -2.5, 3.98), parent=head)       # beam origin

    # left arm: build it, then mirror the whole chain
    arm = mb.node("arm_L", mb.beam((0.8, -0.6, 3.3), (1.0, -1.0, 2.7), (0.35, 0.35), color=BODY),
                  pivot=(0.8, -0.6, 3.3), parent=torso)
    fore = mb.node("forearm_L", mb.beam((1.0, -1.0, 2.7), (0.95, -1.9, 2.6), (0.3, 0.3), color=STRIPE),
                   pivot=(1.0, -1.0, 2.7), parent=arm)
    hand_g = mb.box((0.35, 0.3, 0.3), at=(0.95, -2.05, 2.6), color=BODY)
    for k in (-1, 0, 1):
        hand_g += mb.rod((0.95 + 0.11 * k, -2.2, 2.6), (0.95 + 0.13 * k, -2.5, 2.52), 0.05, 0, n=4, color="bone")
    mb.node("hand_L", hand_g, pivot=(0.95, -1.9, 2.6), parent=fore)
    mb.mirror(arm)                                            # arm_R, forearm_R, hand_R
    mb.empty("hold", at=(-0.95, -2.15, 2.5), parent="hand_R")

    mb.node("weak_point", mb.icosphere(0.22, at=(0, -1.05, 3.1), color="glow_weak", mat="glow"),
            pivot=(0, -1.05, 3.1), parent=torso)
    spines = mb.empty("spines", at=(0, 0.2, 3.4), parent=torso)
    for i in range(3):
        y = -0.2 + 0.45 * i
        z = 3.75 - 0.45 * i
        mb.node(f"spine_{i}", mb.rod((0, y, z), (0, y + 0.25, z + 0.55), 0.14, 0, n=4, color="bone"),
                pivot=(0, y, z), parent=spines)

    # left leg, mirrored
    leg = mb.node("leg_L", mb.beam((0.6, 0.3, 1.8), (0.75, -0.2, 1.0), (0.6, 0.6), (0.45, 0.45), color=BODY),
                  pivot=(0.6, 0.3, 1.8), parent=hips)
    shin = mb.node("shin_L", mb.beam((0.75, -0.2, 1.0), (0.75, 0.25, 0.25), (0.42, 0.42), (0.32, 0.32), color=STRIPE),
                   pivot=(0.75, -0.2, 1.0), parent=leg)
    mb.node("foot_L", mb.box((0.55, 1.0, 0.25), at=(0.75, -0.15, 0), color=BODY, anchor="bottom"),
            pivot=(0.75, 0.25, 0.25), parent=shin)
    mb.mirror(leg)

    # tail: five segments, each pivoting where it joins the previous one
    parent, y, z, w = hips, 0.9, 1.9, 0.9
    for i in range(1, 6):
        y2, z2, w2 = y + 0.75, z - 0.28, w * 0.72
        seg = mb.beam((0, y, z), (0, y2, z2), (w, w), (w2, w2), color=BODY if i % 2 else STRIPE)
        parent = mb.node(f"tail_{i}", seg, pivot=(0, y, z), parent=parent)
        y, z, w = y2, z2, w2


def main() -> int:
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, "kaiju_lizard_s1.glb")
    build()
    print("scene triangles:", mb.tri_count())
    mb.export_glb(path)
    rep = validation.validate_file(path)
    print(rep.format())
    ok = rep.ok

    # a pose in game axes, as the animation code would write it
    roar = {"jaw": {"x": 28}, "head": {"x": -18}, "neck": {"x": -10}, "torso": {"x": -6},
            "arm_L": {"x": -55, "z": 25}, "arm_R": {"x": -55, "z": -25},
            "tail_1": {"y": 14}, "tail_2": {"y": 14}, "tail_3": {"y": 14}, "tail_4": {"y": 14},
            "leg_L": {"x": -25}, "shin_L": {"x": 20}}
    fp_pose = {"arm_L": {"x": -50, "y": -12}, "arm_R": {"x": -50, "y": 12}}
    mb.load_glb(path)
    sheet = mb.contact_sheet("rig_test", out=os.path.join(DOCS, "rig_test_sheet.png"),
                             title="rig test (box lizard): rest pose, a roar pose, and the first-person camera",
                             extra=[mb.View("POSED (jaw, arms, tail, leg)", azimuth=60, elevation=12, pose=roar),
                                    mb.View("FIRST PERSON (cam_fp), arms raised", node="cam_fp", fov=85, pose=fp_pose)])
    # after rendering, the rest pose must be back, so exporting again gives the same file
    again = os.path.join(OUT, "kaiju_lizard_s1_again.glb")
    mb.export_glb(again)
    import glb
    a, b = glb.load(path), glb.load(again)
    same = (a.node_names() == b.node_names() and a.tris() == b.tris()
            and all(abs(x - y) < 1e-5 for x, y in zip(a.size(), b.size())))
    print(("PASS" if same else "FAIL") + "  load, pose, render, re-export gives the same model back")
    ok &= same
    shot = mb.concept("rig_test", out=os.path.join(DOCS, "rig_test_concept.png"), backdrop="sunset",
                      azimuth=38, elevation=4, pose=roar)
    try:
        mb.pose({"jaw": {"x": 20}})
        mb.export_glb(again)
        print("FAIL  export_glb accepted a posed scene")
        ok = False
    except RuntimeError as e:
        print("PASS  export_glb refuses a posed scene:", str(e).split(".")[0])
        mb.clear_pose()
    print("sheet:", os.path.relpath(sheet, mb.REPO), " concept:", os.path.relpath(shot, mb.REPO))
    print("RIG TEST PASSED" if ok else "RIG TEST FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
