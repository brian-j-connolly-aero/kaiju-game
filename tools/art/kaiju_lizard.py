#!/opt/mbtools/venv/bin/python
# mb-family: kaiju
"""Gragnor, the Lizard kaiju, at all three stages, plus the cocoon and the egg.

    /opt/mbtools/venv/bin/python tools/art/kaiju_lizard.py                 build, validate, preview
    /opt/mbtools/venv/bin/python tools/art/kaiju_lizard.py --no-previews   geometry only (fast)
    /opt/mbtools/venv/bin/python tools/art/kaiju_lizard.py --only kaiju_lizard_s2

Writes, per asset: client/public/assets/models/<id>.glb, docs/art/previews/<id>.png (contact
sheet) and docs/art/concept/<id>*.png (beauty shot; for the stages also mid-roar, mid-swipe,
first person and staggered). Then the family pictures: docs/art/concept/kaiju_lizard_lineup.png
(all stages to scale beside a bus and a ten-storey block) and
client/public/assets/ui/portrait_lizard.png. Manifest: manifest.kaiju.json, where each stage
also carries its pose targets ("poses", docs/ASSETS.md section 7).

The review pictures show the kaiju the way the game does, which the kit's defaults do not:
  - the weak point is hidden, as it is in play; only the stagger pictures show it (at 1.2
    times its size, the middle of the game's throb);
  - first person is drawn through the game's lens (the camera on cam_fp looking level,
    vertical field of view 72 degrees, 16:9, near plane 0.02 body heights, back faces
    culled), not through the kit's 80-degree node view. Check any change to the head or
    the arms there: a snout that looks fine from outside can be sliced by that near plane.
So this script renders its own previews instead of leaving them to mb.run_family().

The character lives in tools/art/kaiju/:
    lizard.py     the parametric builder: one function, one proportion table per stage, poses
    parts.py      faceted tubes with joint domes, spikes, claws, teeth, plates, the rig collector
    poses.py      the game's first-person lens, the checks on the pose targets, the pose solver
    brood.py      egg and cocoon
    showcase.py   line-up and portrait
"""
import argparse
import hashlib
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "lib"))
sys.path.insert(0, os.path.join(HERE, "kaiju"))
import mb  # noqa: E402
import mb_preview  # noqa: E402
import brood  # noqa: E402
import lizard  # noqa: E402
import poses  # noqa: E402
import showcase  # noqa: E402

V = mb.View
REVIEW = "r3"                       # bump to force this family's previews to re-render
# time of day follows the stage in the game: afternoon, sunset, night
BACKDROP = {1: "sky", 2: "sunset", 3: "sunset"}
STAGES = {aid: stage for stage, aid in showcase.STAGE_IDS.items()}
WEAK_SHOWN = 1.2                    # the game throbs the weak point between 0.95 and 1.45 times its size
EVERYTHING = ("root",)              # a view that names the root shows every node, the weak point included


def _stage(stage: int) -> None:
    rig = lizard.build(stage)
    rig.fit(lizard.HEIGHT[stage])
    rig.emit()


@mb.asset("kaiju_lizard_s1", kind="kaiju", rig="lizard")
def hatchling():
    """Stage 1, 4.5 m: big head, big paws, short legs. Almost cute. Budget 2500 triangles."""
    _stage(1)


@mb.asset("kaiju_lizard_s2", kind="kaiju", rig="lizard")
def juvenile():
    """Stage 2, 32 m: lean and mean, spines growing in. Budget 2500 triangles."""
    _stage(2)


@mb.asset("kaiju_lizard_s3", kind="kaiju", rig="lizard")
def titan():
    """Stage 3, 115 m: massive, plated, scarred, a crown of spines. Budget 4000 triangles."""
    _stage(3)


@mb.asset("kaiju_cocoon", kind="misc")
def cocoon():
    """The molting pod, 1 m tall (scaled in code). Budget 500 triangles."""
    brood.build_cocoon()


@mb.asset("kaiju_egg", kind="misc")
def egg():
    """The egg, 1 m tall (scaled in code). Budget 500 triangles."""
    brood.build_egg()


# =========================================================================================
# pose targets: checked on the exported files, then written into the manifest
# =========================================================================================
def _check_poses() -> list[str]:
    problems = []
    for stage, aid in showcase.STAGE_IDS.items():
        if os.path.exists(mb.contract.model_path(aid)):
            problems += poses.check(aid, lizard.POSE_TARGETS[stage])
    return problems


def _manifest_json(obj, indent: int = 0, key: str = "") -> str:
    """The kit's manifest layout (one entry per line group), with each pose on a line of its own."""
    pad = "  " * indent
    if isinstance(obj, dict) and obj and (indent < 3 or key == "poses"):
        items = [f"{pad}  {json.dumps(k)}: {_manifest_json(v, indent + 1, k)}" for k, v in obj.items()]
        return "{\n" + ",\n".join(items) + "\n" + pad + "}" + ("\n" if indent == 0 else "")
    return json.dumps(obj, ensure_ascii=False)


def _write_poses() -> None:
    """Add "poses" to the manifest entry of every stage (mb.run_family rewrites the entries)."""
    man = mb.Manifest("kaiju")
    for stage, aid in showcase.STAGE_IDS.items():
        entry = man.data.get("models", {}).get(aid)
        if entry is not None:
            entry["poses"] = {name: {node: [int(a) if float(a).is_integer() else float(a) for a in v] for node, v in target.items()}
                              for name, target in lizard.POSE_TARGETS[stage].items()}
    ordered = {sec: dict(sorted(man.data[sec].items())) for sec in sorted(man.data)}
    with open(man.path, "w", encoding="utf-8") as f:
        f.write(_manifest_json(ordered))


# =========================================================================================
# review pictures
# =========================================================================================
def _fp_view(aid: str, target: dict, label: str = "") -> mb.View:
    """The game's first-person camera for a pose target, as a kit view (which works in the
    authoring frame and clips at 1% of the distance from the eye to its target)."""
    body = poses.Body(aid)
    eye, _, _, fwd = body.lens(body.world(target))
    near = max(0.08, poses.NEAR * body.height)
    e = (eye[0], -eye[2], eye[1])
    d = (fwd[0], -fwd[2], fwd[1])
    return V(label, eye=e, target=tuple(a + b * near * 100.0 for a, b in zip(e, d)), fov=poses.HFOV,
             pose=lizard.as_pose(target), cull_backfaces=True)


def _shots(aid: str) -> tuple[dict, list]:
    """(contact sheet options, concept shots) for one asset."""
    if aid == "kaiju_cocoon":
        return {}, [dict(backdrop="sunset", azimuth=28, elevation=10)]
    if aid == "kaiju_egg":
        return {}, [dict(backdrop="sky", azimuth=28, elevation=10)]
    stage = STAGES[aid]
    targets = lizard.POSE_TARGETS[stage]
    stagger = lizard.as_pose(targets["stagger"])
    low = {1: 11, 2: 6, 3: 3}[stage]                 # the bigger it is, the lower the camera
    day = BACKDROP[stage]
    whole = mb.measure(aid)                           # the sheet's own count leaves out what is hidden
    title = (f"{aid}   as in play: weak point hidden outside the STAGGER cells "
             f"(the file has {whole['tris']} triangles, {len(whole['nodes'])} nodes)")
    sheet = dict(cell=(672, 378), title=title, extra=[     # 16:9 cells: the first-person ones are the game's frame
        _fp_view(aid, {}, "FIRST PERSON, the game's lens: at rest"),
        _fp_view(aid, targets["fp_claws"], "FIRST PERSON, the game's lens: pose target fp_claws"),
        V("STAGGER (pose target), weak point shown", azimuth=28, elevation=8, fov=30, pose=stagger, show=EVERYTHING),
        V("STAGGER from behind: the vents on the back", azimuth=152, elevation=24, fov=30, pose=stagger,
          show=EVERYTHING),
        V("ROAR (joints turned in game axes)", azimuth=42, elevation=8, fov=30, pose=lizard.POSES["roar"]),
    ])
    concept = [
        dict(backdrop=day, azimuth=36, elevation=low),
        dict(name="roar", backdrop="night" if stage == 3 else day, azimuth=30, elevation=low - 2,
             pose=lizard.POSES["roar"]),
        dict(name="swipe", backdrop=day, azimuth=-28, elevation=low, pose=lizard.POSES["swipe"]),
        dict(name="fp", backdrop=day, view=_fp_view(aid, targets["fp_claws"]), size=(960, 540)),
        dict(name="stagger", backdrop="night" if stage == 3 else day, azimuth=24, elevation=low, pose=stagger,
             show=EVERYTHING),
    ]
    if stage == 3:                                   # the titan's own light at night: embers at the spine roots
        concept.append(dict(name="embers", backdrop="night", azimuth=150, elevation=16))
    return sheet, concept


def _review(only: set, force: bool, no_concept: bool) -> None:
    """Contact sheet and concept shots of every asset, rendered from the exported files and
    skipped when neither the file nor the options changed."""
    import bpy

    for aid in ("kaiju_lizard_s1", "kaiju_lizard_s2", "kaiju_lizard_s3", "kaiju_cocoon", "kaiju_egg"):
        path = mb.contract.model_path(aid)
        if (only and aid not in only) or not os.path.exists(path):
            continue
        with open(path, "rb") as f:
            sha = hashlib.sha1(f.read()).hexdigest()
        sheet, concept = _shots(aid)
        jobs = [(os.path.join(mb.PREVIEWS, aid + ".png"), None, sheet)]
        if not no_concept:
            for shot in concept:
                shot = dict(shot)
                name = shot.pop("name", None)
                jobs.append((os.path.join(mb.CONCEPT, aid + (f"_{name}" if name else "") + ".png"), name or "", shot))
        loaded = False
        for png, name, opts in jobs:
            stamp = f"{mb_preview.PREVIEW_VERSION}|{REVIEW}|{sha}|{opts!r}"
            if not force and showcase._fresh(png, stamp):
                continue
            if not loaded:
                mb.load_glb(path)          # previews show the exported file: what ships is what is reviewed
                loaded = True
                weak = bpy.data.objects.get("weak_point")
                if weak is not None:       # hidden as in play; the stagger views show everything
                    weak.hide_render = True
                    weak.scale = (WEAK_SHOWN,) * 3
            if name is None:
                mb.contact_sheet(aid, stamp=stamp, **opts)
            else:
                mb.concept(aid, out=png, stamp=stamp, **opts)
            print("  " + os.path.relpath(png, mb.REPO))


def main(argv=None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    ap = argparse.ArgumentParser(add_help=False)
    ap.add_argument("--only", default="")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--no-previews", action="store_true")
    ap.add_argument("--no-concept", action="store_true")
    ap.add_argument("--force", action="store_true")
    args, _ = ap.parse_known_args(argv)
    if args.list:
        return mb.run_family("kaiju", argv)
    # build, validate and write the manifest with the kit; the pictures are made here (see above)
    before = os.environ.get("MB_NO_PREVIEWS")
    no_previews = args.no_previews or bool(before)
    os.environ["MB_NO_PREVIEWS"] = "1"
    try:
        code = mb.run_family("kaiju", argv)
    finally:
        if before is None:
            del os.environ["MB_NO_PREVIEWS"]
        else:
            os.environ["MB_NO_PREVIEWS"] = before
    _write_poses()
    print("  pose targets (first person through the game's lens):")
    problems = _check_poses()
    for line in problems:
        print("  FAIL  pose  " + line)
    if problems:
        print(f"  POSE TARGETS FAILED: {len(problems)} problem(s). Re-solve them: tools/art/kaiju/poses.py")
        code = code or 1
    if code == 0 and not no_previews:
        only = {s.strip() for s in args.only.split(",") if s.strip()}
        force = args.force or bool(os.environ.get("MB_FORCE"))
        _review(only, force, args.no_concept or bool(os.environ.get("MB_NO_CONCEPT")))
        if all(os.path.exists(mb.contract.model_path(a)) for a in showcase.STAGE_IDS.values()):
            for fn in (showcase.lineup, showcase.portrait):
                print("  " + os.path.relpath(fn(force=force), mb.REPO))
    return code


if __name__ == "__main__":
    raise SystemExit(main())
