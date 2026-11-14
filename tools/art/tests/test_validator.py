"""Proves the validator catches what it claims to catch.

Builds deliberately broken models in /tmp/mb-scratch/art-tests/bad/ (each breaks exactly one
rule of docs/ASSETS.md) and checks that validate reports that rule as FAIL, and that
good models pass.

    /opt/mbtools/venv/bin/python tools/art/tests/test_validator.py
"""
import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
import bpy  # noqa: E402

import mb  # noqa: E402
import validation  # noqa: E402

OUT = "/tmp/mb-scratch/art-tests/bad"
CASES = []


def case(asset, rule, **validate_args):
    """Register a builder whose exported file must FAIL `rule` (None: must pass everything)."""
    def deco(fn):
        CASES.append((asset, rule, fn, validate_args))
        return fn
    return deco


def crate(color="wood"):
    return mb.box((1, 1, 1), at=(0, 0, 0), color=color, anchor="bottom")


def raw_export(path, **kw):
    for ob in bpy.context.scene.objects:
        ob.select_set(True)
    with mb.quiet():
        bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, **kw)


@case("prop_good", None)
def good(path):
    mb.node("prop_good", crate())
    mb.export_glb(path)


@case("prop_smooth", "flat-shading")
def smooth(path):
    # mb's own builders cannot make a smooth mesh (faces never share corners), so this one
    # is made the plain Blender way: shared corners, smooth shading switched on.
    ob = mb.node("prop_smooth", crate())
    me = bpy.data.meshes.new("smooth")
    v = [(-.5, -.5, 0), (.5, -.5, 0), (.5, .5, 0), (-.5, .5, 0), (-.5, -.5, 1), (.5, -.5, 1), (.5, .5, 1), (-.5, .5, 1)]
    f = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    me.from_pydata(v, [], f)
    me.shade_smooth()
    me.color_attributes.new(mb.COLOR_ATTR, "FLOAT_COLOR", "CORNER")
    me.materials.append(mb.get_material("vcol"))
    ob.data = me
    mb.export_glb(path)


@case("prop_textured", "no-textures")
def textured(path):
    ob = mb.node("prop_textured", crate())
    mat = ob.data.materials[0]
    img = bpy.data.images.new("tex", 8, 8)
    img.filepath_raw = os.path.join(OUT, "tex.png")
    img.file_format = "PNG"
    img.save()
    tex = mat.node_tree.nodes.new("ShaderNodeTexImage")
    tex.image = img
    bsdf = next(n for n in mat.node_tree.nodes if n.bl_idname == "ShaderNodeBsdfPrincipled")
    mat.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    ob.data.uv_layers.new(name="UVMap")
    raw_export(path, export_animations=False)


@case("prop_badmat", "materials")
def badmat(path):
    ob = mb.node("prop_badmat", crate())
    ob.data.materials[0] = bpy.data.materials.new("Plaster")
    mb.export_glb(path, check=False)


@case("prop_rotated", "transforms")
def rotated(path):
    ob = mb.node("prop_rotated", crate())
    ob.rotation_euler = (0, 0, math.radians(30))
    mb.export_glb(path, check=False)


@case("prop_scaled", "transforms")
def scaled(path):
    ob = mb.node("prop_scaled", crate())
    ob.scale = (2, 2, 2)
    mb.export_glb(path, check=False)


@case("prop_insideout", "inside-out")
def insideout(path):
    mb.node("prop_insideout", crate().flip())
    mb.export_glb(path)


@case("prop_floating", "origin")
def floating(path):
    mb.node("prop_floating", crate().move(0, 0, 0.4))
    mb.export_glb(path)


@case("prop_sunk", "origin")
def sunk(path):
    mb.node("prop_sunk", crate().move(0, 0, -0.4))
    mb.export_glb(path)


@case("prop_offcenter", "origin")
def offcenter(path):
    mb.node("prop_offcenter", crate().move(3, 0, 0))
    mb.export_glb(path)


@case("prop_heavy", "budget")
def heavy(path):
    mb.node("prop_heavy", mb.sphere(0.5, 12, 8, at=(0, 0, 0.5)))      # 168 triangles, budget 80
    mb.export_glb(path)


@case("prop_huge", "size")
def huge(path):
    mb.node("prop_huge", crate().scale(80))                            # centimeters mistaken for meters
    mb.export_glb(path)


@case("prop_gripped", None)
def gripped(path):
    a = mb.node("prop_gripped", crate())                               # a city weapon: one mesh plus its grip anchor
    mb.empty("grip", at=(0, 0, 1.0), parent=a)
    mb.export_glb(path)


@case("prop_strayempty", "single-mesh")
def strayempty(path):
    a = mb.node("prop_strayempty", crate())
    mb.empty("handle", at=(0, 0, 1.0), parent=a)                       # only `grip` is allowed beside the mesh
    mb.export_glb(path)


@case("prop_gripmesh", "anchors")
def gripmesh(path):
    a = mb.node("prop_gripmesh", crate())
    mb.node("grip", mb.box((0.1, 0.1, 0.1), at=(0, 0, 1.05)), pivot=(0, 0, 1.0), parent=a)   # a grip must be an empty
    mb.export_glb(path)


@case("prop_propane", "required-nodes")
def nogrip(path):
    mb.node("prop_propane", crate())                                   # the six city weapons must carry a grip
    mb.export_glb(path)


@case("prop_twomesh", "single-mesh")
def twomesh(path):
    a = mb.node("prop_twomesh", crate())
    mb.node("lid", mb.box((1, 1, 0.1), at=(0, 0, 1.05)), pivot=(0, 0.5, 1.0), parent=a)
    mb.export_glb(path)


@case("prop_badname", "node-names")
def badname(path):
    ob = mb.node("prop_badname", crate())
    ob.name = "prop badname.001"
    mb.export_glb(path, check=False)


@case("prop_animated", "no-animation")
def animated(path):
    ob = mb.node("prop_animated", crate())
    ob.keyframe_insert("location", frame=1)
    ob.location.z = 1
    ob.keyframe_insert("location", frame=20)
    ob.location.z = 0
    bpy.context.scene.frame_set(1)
    raw_export(path, export_animations=True, export_vertex_color="ACTIVE", export_image_format="NONE")


@case("army_tank", "required-nodes")
def tank_missing(path):
    hull = mb.node("hull", mb.box((3, 6, 1.6), at=(0, 0, 0), anchor="bottom", color="army_olive"))
    mb.node("turret", mb.box((2, 2.5, 0.8), at=(0, 0, 1.6), anchor="bottom", color="army_olive"),
            pivot=(0, 0, 1.6), parent=hull)
    mb.export_glb(path)


def _tank(muzzle_y, left_x):
    hull = mb.node("hull", mb.box((3, 6, 1.2), at=(0, 0, 0.4), anchor="bottom", color="army_olive"))
    turret = mb.node("turret", mb.box((2, 2.5, 0.8), at=(0, 0, 1.6), anchor="bottom", color="army_olive"),
                     pivot=(0, 0, 1.6), parent=hull)
    barrel = mb.node("barrel", mb.rod((0, math.copysign(1.2, muzzle_y), 2.0), (0, muzzle_y, 2.0), 0.12, color="army_track"),
                     pivot=(0, math.copysign(1.2, muzzle_y), 2.0), parent=turret)
    mb.empty("muzzle", at=(0, muzzle_y, 2.0), parent=barrel)
    mb.node("track_L", mb.box((0.6, 6.2, 0.9), at=(left_x, 0, 0), anchor="bottom", color="army_track"),
            pivot=(left_x, 0, 0.45), parent=hull)
    mb.node("track_R", mb.box((0.6, 6.2, 0.9), at=(-left_x, 0, 0), anchor="bottom", color="army_track"),
            pivot=(-left_x, 0, 0.45), parent=hull)


@case("army_tank", None)
def tank_good(path):
    _tank(muzzle_y=-4.5, left_x=1.5)
    mb.export_glb(path)


@case("army_tank", "facing")
def tank_backward(path):
    _tank(muzzle_y=4.5, left_x=1.5)            # gun points to authoring +Y: the model faces backward
    mb.export_glb(path)


@case("army_tank", "left-right")
def tank_mirrored(path):
    _tank(muzzle_y=-4.5, left_x=-1.5)          # track_L on the model's right
    mb.export_glb(path)


@case("army_tank", "anchors")
def tank_muzzle_mesh(path):
    _tank(muzzle_y=-4.5, left_x=1.5)
    bpy.data.objects.remove(bpy.data.objects["muzzle"])
    mb.node("muzzle", mb.box((0.1, 0.1, 0.1), at=(0, -4.5, 2.0)), pivot=(0, -4.5, 2.0), parent="barrel")
    mb.export_glb(path)


def _building(n_chunks=12, centered=True, rubble_shift=0.0):
    w, d, h = 10.0, 8.0, 12.0
    mb.node("intact", mb.box((w, d, h), at=(0, 0, 0), color="bld_cream", anchor="bottom"))
    mb.node("damaged", mb.box((w, d, h), at=(0, 0, 0), color="bld_cream_dk", anchor="bottom"))
    mb.node("rubble", mb.box((w * 0.8, d * 0.8, 1.0), at=(rubble_shift, 0, 0), color="rubble_grey", anchor="bottom"))
    geos = mb.shatter_box((-w / 2, -d / 2, 0), (w / 2, d / 2, h), cuts=(2, 2, 3))[:n_chunks]
    if centered:
        mb.chunk_nodes(geos)
    else:
        for i, g in enumerate(geos):
            mb.node(f"chunk_{i:02d}", g)       # origin left at the building's origin: wrong


@case("bld_good", None, size_class="small")
def building_good(path):
    _building()
    mb.export_glb(path)


@case("bld_fewchunks", "chunks", size_class="small")
def building_fewchunks(path):
    _building(n_chunks=3)
    mb.export_glb(path)


@case("bld_chunkorigin", "chunks", size_class="small")
def building_chunkorigin(path):
    _building(centered=False)
    mb.export_glb(path)


@case("bld_spill", "states", size_class="small")
def building_spill(path):
    _building(rubble_shift=4.0)
    mb.export_glb(path)


@case("bld_nostates", "required-nodes", size_class="small")
def building_nostates(path):
    mb.node("intact", mb.box((10, 8, 12), at=(0, 0, 0), color="bld_cream", anchor="bottom"))
    mb.export_glb(path)


@case("kaiju_egg", "true-size")
def egg_big(path):
    mb.node("kaiju_egg", mb.sphere((0.5, 0.5, 0.9), 8, 4, at=(0, 0, 0.9), color="bone"))   # 1.8 m, must be 1 m
    mb.export_glb(path)


@case("kaiju_crab_s1", "anchors")
def crab_weak_not_glow(path):
    root = mb.empty("root")
    body = mb.node("body", mb.box((3, 2, 1.5), at=(0, 0, 0), anchor="bottom", color="krabulon_crimson"), parent=root)
    mb.empty("cam_fp", at=(0, -1.0, 1.4), parent=body)
    mb.empty("mouth", at=(0, -1.1, 0.9), parent=body)
    mb.empty("hold", at=(-1.6, -1.2, 0.8), parent=body)
    mb.node("weak_point", mb.icosphere(0.2, at=(0, 0, 1.6), color="glow_weak"), pivot=(0, 0, 1.6), parent=body)  # vcol!
    mb.export_glb(path)


def main() -> int:
    os.makedirs(OUT, exist_ok=True)
    bad = 0
    for i, (asset, rule, fn, vargs) in enumerate(CASES):
        folder = os.path.join(OUT, f"{i:02d}_{fn.__name__}")
        os.makedirs(folder, exist_ok=True)
        path = os.path.join(folder, asset + ".glb")
        mb.reset()
        fn(path)
        rep = validation.validate_file(path, **vargs)
        failed = sorted({r for lv, r, _ in rep.lines if lv == validation.FAIL})
        if rule is None:
            ok = rep.ok
            want = "passes every rule"
        else:
            ok = rule in failed
            want = f"fails '{rule}'"
        bad += not ok
        print(f"{'PASS' if ok else 'FAIL'}  {fn.__name__:<22} {want:<26} failed rules: {failed or 'none'}")
        if not ok:
            print(rep.format())

    # a stale manifest entry and a file that is not a .glb at all
    import json
    good_path = os.path.join(OUT, "00_good", "prop_good.glb")
    rep = validation.validate_file(good_path, entry={"file": "models/prop_good.glb", "kind": "prop",
                                                     "nodes": ["prop_good"], "size": [1, 1, 1], "tris": 99})
    ok = any(lv == validation.FAIL and r == "manifest" for lv, r, _ in rep.lines)
    bad += not ok
    print(f"{'PASS' if ok else 'FAIL'}  stale manifest entry     fails 'manifest'")
    junk = os.path.join(OUT, "junk.glb")
    with open(junk, "w") as f:
        json.dump({"not": "a glb"}, f)
    rep = validation.validate_file(junk)
    ok = any(lv == validation.FAIL and r == "container" for lv, r, _ in rep.lines)
    bad += not ok
    print(f"{'PASS' if ok else 'FAIL'}  not a .glb file          fails 'container'")
    print("VALIDATOR TEST PASSED" if not bad else f"VALIDATOR TEST FAILED ({bad} case(s))")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
