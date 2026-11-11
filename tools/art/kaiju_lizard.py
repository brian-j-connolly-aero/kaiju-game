#!/opt/mbtools/venv/bin/python
# mb-family: kaiju
"""Gragnor, the Lizard kaiju, at all three stages, plus the cocoon and the egg.

    /opt/mbtools/venv/bin/python tools/art/kaiju_lizard.py                 build, validate, preview
    /opt/mbtools/venv/bin/python tools/art/kaiju_lizard.py --no-previews   geometry only (fast)
    /opt/mbtools/venv/bin/python tools/art/kaiju_lizard.py --only kaiju_lizard_s2

Writes, per asset: client/public/assets/models/<id>.glb, docs/art/previews/<id>.png (contact
sheet with the first-person view and a posed view) and docs/art/concept/<id>*.png (beauty
shot, mid-roar, mid-swipe, first person). Then the family pictures:
docs/art/concept/kaiju_lizard_lineup.png (all stages to scale beside a bus and a ten-storey
block) and client/public/assets/ui/portrait_lizard.png. Manifest: manifest.kaiju.json.

The character lives in tools/art/kaiju/:
    lizard.py     the parametric builder: one function, one proportion table per stage, poses
    parts.py      faceted tubes with joint domes, spikes, claws, teeth, stripes, the rig collector
    brood.py      egg and cocoon
    showcase.py   line-up and portrait
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "lib"))
sys.path.insert(0, os.path.join(HERE, "kaiju"))
import mb  # noqa: E402
import brood  # noqa: E402
import lizard  # noqa: E402
import showcase  # noqa: E402

V = mb.View
# time of day follows the stage in the game: afternoon, sunset, night
BACKDROP = {1: "sky", 2: "sunset", 3: "sunset"}


def _stage(stage: int) -> dict:
    """Build one stage into the scene and say how to photograph it."""
    rig = lizard.build(stage)
    rig.fit(lizard.HEIGHT[stage])
    rig.emit()
    fp = lizard.FP_POSE[stage]
    low = {1: 11, 2: 6, 3: 3}[stage]                 # the bigger it is, the lower the camera
    return dict(
        sheet=dict(extra=[
            V("FIRST PERSON (cam_fp), claws up", node="cam_fp", fov=80, pose=fp),
            V("POSED: roar (joints turned in game axes)", azimuth=42, elevation=8, fov=30, pose=lizard.POSES["roar"]),
        ]),
        concept=[
            dict(backdrop=BACKDROP[stage], azimuth=36, elevation=low),
            dict(name="roar", backdrop="night" if stage == 3 else BACKDROP[stage], azimuth=30, elevation=low - 2,
                 pose=lizard.POSES["roar"]),
            dict(name="swipe", backdrop=BACKDROP[stage], azimuth=-28, elevation=low, pose=lizard.POSES["swipe"]),
            dict(name="fp", backdrop=BACKDROP[stage], view=V("", node="cam_fp", fov=80, pose=fp)),
        ],
    )


@mb.asset("kaiju_lizard_s1", kind="kaiju", rig="lizard")
def hatchling():
    """Stage 1, 4.5 m: big head, big paws, short legs. Almost cute. Budget 2500 triangles."""
    return _stage(1)


@mb.asset("kaiju_lizard_s2", kind="kaiju", rig="lizard")
def juvenile():
    """Stage 2, 32 m: lean and mean, spines growing in. Budget 2500 triangles."""
    return _stage(2)


@mb.asset("kaiju_lizard_s3", kind="kaiju", rig="lizard")
def titan():
    """Stage 3, 115 m: massive, armored, scarred, a crown of spines. Budget 4000 triangles."""
    return _stage(3)


@mb.asset("kaiju_cocoon", kind="misc", concept=dict(backdrop="sunset", azimuth=28, elevation=10))
def cocoon():
    """The molting pod, 1 m tall (scaled in code). Budget 500 triangles."""
    brood.build_cocoon()


@mb.asset("kaiju_egg", kind="misc", concept=dict(backdrop="sky", azimuth=28, elevation=10))
def egg():
    """The egg, 1 m tall (scaled in code). Budget 500 triangles."""
    brood.build_egg()


def main(argv=None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    code = mb.run_family("kaiju", argv)
    skip = "--list" in argv or "--no-previews" in argv or os.environ.get("MB_NO_PREVIEWS")
    have_all = all(os.path.exists(mb.contract.model_path(a)) for a in showcase.STAGE_IDS.values())
    if code == 0 and not skip and have_all:
        force = "--force" in argv or bool(os.environ.get("MB_FORCE"))
        for fn in (showcase.lineup, showcase.portrait):
            print("  " + os.path.relpath(fn(force=force), mb.REPO))
    return code


if __name__ == "__main__":
    raise SystemExit(main())
