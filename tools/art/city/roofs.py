#!/opt/mbtools/venv/bin/python
"""Roof pictures: the roof mask of the ordinary buildings, checked and shown.

    tools/art/city/roofs.py               both pictures (about 30 s on 2 threads); a picture is
                                          redrawn only when a building, the atlas or the colors
                                          changed (--force to insist); tools/art/build_all.sh runs it
    tools/art/city/roofs.py --test        docs/art/previews/city_roofs_test.png only
    tools/art/city/roofs.py --districts   docs/art/previews/city_roofs_districts.png only
    --out DIR                             write into DIR instead (scratch, while iterating)

city_roofs_test.png        every ordinary building (intact, damaged, rubble, chunks) with every
                           face that carries the roof mask (COLOR_0 alpha 0.5) in a loud test
                           green and the rest as the file has it. A roof left grey is a missed
                           roof; green on a wall is a wall caught by mistake. Buildings that keep
                           their own roof colors say why (style.OWN_ROOFS).
city_roofs_districts.png   the same street in four districts' roof colors (District.roof in
                           shared/src/city/meridian/), then the industrial and the
                           downtown buildings in theirs: each building's roof in one of the
                           SHADES picked by its number, its walls in one of the model's tint
                           colors, as docs/art/client-notes-city.md section 2 asks the client to
                           draw them.
"""
from __future__ import annotations

import math
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if __name__ == "__main__":
    sys.path.insert(0, os.path.join(HERE, "..", "lib"))
    sys.path.insert(0, os.path.join(HERE, ".."))

import numpy as np  # noqa: E402

SHEET_VERSION = "r1"
TEST_GREEN = "#39ff14"           # loud: never a roof, a wall or a sky color
SHADES = (0.84, 0.92, 1.0, 1.1)  # roof color multipliers (linear) a building picks from by its number
MERIDIAN = os.path.join(HERE, "..", "..", "..", "shared", "src", "city", "meridian")   # the city data
# used when the city data has no roof colors yet
FALLBACK_ROOFS = {"Temple Hill": 0xcf7442, "Bellhaven": 0x55709a, "Hollowmere": 0x6b8a46, "Northgate": 0x45484f,
                  "The Cinder Works": 0x6a5c52, "Downtown": 0x7c8794}


def _lin(rgb):
    a = np.asarray(rgb, float)
    return np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)


def _hex_lin(h) -> np.ndarray:
    if isinstance(h, int):
        h = f"#{h:06x}"
    h = h.lstrip("#")
    return _lin([int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)])


def _hash(i: int) -> int:
    """A small integer hash (the picture's stand-in for the client's hash of the structure id)."""
    x = (i * 2654435761 + 0x9E3779B9) & 0xFFFFFFFF
    x ^= x >> 15
    return (x * 0x85EBCA6B) & 0xFFFFFFFF


def city_colors(name: str) -> dict:
    """{district: 0xRRGGBB} from a table of the city data (DISTRICT_ROOFS or DISTRICT_TINTS in
    shared/src/city/meridian/*.ts), or {} when there is none."""
    import glob
    for path in sorted(glob.glob(os.path.join(MERIDIAN, "*.ts"))):
        with open(path, encoding="utf-8") as f:
            text = f.read()
        m = re.search(r"export const " + name + r"\b[^{]*\{(.*?)\n\};", text, re.S)
        if not m:
            continue
        out = {}
        for key, val in re.findall(r"^\s*'?([A-Za-z][A-Za-z ]*?)'?\s*:\s*0x([0-9a-fA-F]{6})", m.group(1), re.M):
            out[key] = int(val, 16)
        return out
    return {}


def _stamp(kind: str) -> str:
    """What a picture was drawn from: the ordinary buildings' files, the atlas and, for the
    district picture, the colors and the merged manifest. Unchanged inputs: no redraw."""
    import hashlib
    import contract
    h = hashlib.sha1(f"{SHEET_VERSION}|{kind}|{TEST_GREEN}|{SHADES}".encode())
    paths = [contract.model_path(m) for m in ordinary_models()]
    paths.append(os.path.join(contract.TEXTURES, "city_atlas.png"))
    if kind == "districts":
        paths.append(os.path.join(contract.ASSETS, "manifest.json"))
        h.update(repr(sorted(city_colors("DISTRICT_ROOFS").items())).encode())
        h.update(repr(sorted(city_colors("DISTRICT_TINTS").items())).encode())
    for p in paths:
        h.update(os.path.basename(p).encode())
        if os.path.exists(p):
            with open(p, "rb") as f:
                h.update(hashlib.sha1(f.read()).digest())
    return f"{SHEET_VERSION}|{h.hexdigest()}"


def _save(img, out: str, stamp: str) -> str:
    from PIL.PngImagePlugin import PngInfo
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    meta = PngInfo()
    meta.add_text("mb_stamp", stamp)
    img.save(out, optimize=True, pnginfo=meta)
    return out


# ---- the scene ------------------------------------------------------------------------------
def _float_colors(ob) -> np.ndarray:
    """The object's corner colors as a float attribute (so a paint can go above 1), returned
    as an (n, 4) array of linear RGBA."""
    import mb
    me = ob.data
    attr = me.color_attributes.get(mb.COLOR_ATTR) or me.color_attributes[0]
    n = len(attr.data)
    buf = np.empty(n * 4, dtype=np.float32)
    attr.data.foreach_get("color", buf)
    if attr.data_type != "FLOAT_COLOR" or attr.domain != "CORNER" or attr.name != mb.COLOR_ATTR:
        me.color_attributes.remove(attr)
        attr = me.color_attributes.new(mb.COLOR_ATTR, "FLOAT_COLOR", "CORNER")
        attr.data.foreach_set("color", buf)
    me.color_attributes.active_color = attr
    me.color_attributes.render_color_index = me.color_attributes.find(mb.COLOR_ATTR)
    return buf.reshape(-1, 4).copy()


def _set_colors(ob, rgba: np.ndarray) -> None:
    import mb
    ob.data.color_attributes[mb.COLOR_ATTR].data.foreach_set("color", rgba.astype(np.float32).reshape(-1))


def _import(path: str, x=0.0, y=0.0, yaw=0.0, keep=("intact",), tag=""):
    """Import a model into the scene at (x, y), turned by yaw degrees; keep only the `keep`
    nodes, renamed <tag>_<node>. Returns the kept mesh objects."""
    import bpy
    import mb_preview as P
    before = set(bpy.context.scene.objects)
    with P._quiet():
        bpy.ops.import_scene.gltf(filepath=path, import_shading="NORMALS", merge_vertices=False)
    new = [o for o in bpy.context.scene.objects if o not in before]
    kept = []
    for o in new:
        base = o.name.split(".")[0]
        if keep and base not in keep:
            bpy.data.objects.remove(o, do_unlink=True)
            continue
        o.name = f"{tag}_{base}" if tag else base
        o.rotation_mode = "XYZ"
        o.rotation_euler = (0.0, 0.0, math.radians(yaw))
        o.location = (o.location[0] + x, o.location[1] + y, o.location[2])
        kept.append(o)
    bpy.context.view_layer.update()
    return [o for o in kept if o.type == "MESH"]


def _street(x0, x1, y0, y1, road=7.0):
    """A plain ground: asphalt across the middle (y = 0), pavements, then grass (vertex colors)."""
    import mb
    g = mb.Geo()

    def quad(a, b, c, d, z, col):
        g.face([(a, c, z), (b, c, z), (b, d, z), (a, d, z)], color=col)
    quad(x0, x1, -road, road, 0.01, "#4a4d55")
    quad(x0, x1, road, road + 3.0, 0.03, "#b9b5ac")
    quad(x0, x1, -road - 3.0, -road, 0.03, "#b9b5ac")
    quad(x0, x1, road + 3.0, y1, 0.02, "#6f9f62")
    quad(x0, x1, y0, -road - 3.0, 0.02, "#6f9f62")
    for k in range(int((x1 - x0) / 6.0)):
        xa = x0 + 1.5 + k * 6.0
        quad(xa, xa + 3.0, -0.12, 0.12, 0.02, "#e8e4da")
    ob = mb.node("street", g)
    return ob


# ---- the test sheet ---------------------------------------------------------------------------
def ordinary_models() -> list[str]:
    """Every ordinary building in the models folder: not a landmark, not a bridge (in the
    archetypes' order), with the special buildings left out."""
    import contract
    from . import style
    out = []
    for aid, a in contract.archetypes().items():
        if a.get("landmark") or a.get("class") == "bridge" or aid in style.SPECIAL:
            continue
        mid = a.get("model") or f"bld_{aid}"
        if os.path.exists(contract.model_path(mid)):
            out.append(mid)
    return out


def test_sheet(out: str, force: bool = False) -> str:
    import mb
    import mb_preview as P
    stamp = _stamp("test")
    if not force and mb._stamp_ok(out, stamp):
        return out
    from PIL import Image, ImageDraw
    from . import sheet, style
    V = P.View
    cell = (300, 225)
    green = _hex_lin(TEST_GREEN)
    views = [V("INTACT", azimuth=35, elevation=40, fov=28, show=("intact",)),
             V("DAMAGED", azimuth=215, elevation=40, fov=28, show=("damaged",), frame=("intact",)),
             V("RUBBLE", azimuth=35, elevation=45, fov=28, show=("rubble",), frame=("rubble",)),
             V("CHUNKS", azimuth=35, elevation=30, fov=28, show=("chunk_*",), explode=0.45)]
    blocks = []
    for mid in ordinary_models():
        objs = P.load_glb(mid)
        roof_tris = 0
        for ob in objs:
            if ob.type != "MESH":
                continue
            rgba = _float_colors(ob)
            roof = (rgba[:, 3] >= 0.25) & (rgba[:, 3] <= 0.75)
            lum = rgba[:, :3] @ np.array([0.2126, 0.7152, 0.0722])
            rgba[roof, :3] = green[None, :] * np.clip(lum[roof] / 0.75, 0.3, 1.0)[:, None]
            _set_colors(ob, rgba)
            if ob.name.split(".")[0] == "intact":
                roof_tris += int(roof.sum()) // 3
        cells = []
        for v in views:
            img, cam = sheet._render(v, cell, False, None)
            cells.append(P._decorate_cell(img, v, cam, cell))
        aid = mid.split("_", 1)[1]
        note = style.OWN_ROOFS.get(aid)
        blocks.append((mid, cells, note))
        print(f"  {mid}: {'keeps its own roof colors: ' + note if note else 'roof marked'}", flush=True)
    per_row = 2
    head, label_h, gap = 64, 26, 14
    bw = 4 * cell[0] + 3 * 2
    rows = math.ceil(len(blocks) / per_row)
    W = per_row * bw + (per_row - 1) * gap + 16
    H = head + rows * (label_h + cell[1] + gap)
    img = Image.new("RGB", (W, H), (24, 26, 33))
    d = ImageDraw.Draw(img)
    d.text((12, 8), "Roof mask test: faces that take the district's roof color are painted loud green",
           font=P._font(22), fill=(236, 238, 242))
    d.text((12, 36), "Grey on a roof = a missed roof. Green on a wall = a wall caught by mistake. "
                     "Intact, damaged (from the back), rubble (the roof piece on the heap), chunks.",
           font=P._font(14), fill=(160, 168, 182))
    for i, (mid, cells, note) in enumerate(blocks):
        bx = 8 + (i % per_row) * (bw + gap)
        by = head + (i // per_row) * (label_h + cell[1] + gap)
        label = mid + (f"   keeps its own roof colors: {note}" if note else "")
        d.text((bx + 2, by + 3), label, font=P._font(16), fill=(255, 217, 26) if note else (236, 238, 242))
        for k, c in enumerate(cells):
            img.paste(c.convert("RGB"), (bx + k * (cell[0] + 2), by + label_h))
    return _save(img, out, stamp)


# ---- the district sheet -------------------------------------------------------------------------
STREET_NORTH = ["bld_house_a", "bld_house_b", "bld_house_c", "bld_rowhouse_a", "bld_rowhouse_a", "bld_rowhouse_a",
                "bld_shop_c", "bld_shop_b"]
STREET_SOUTH = ["bld_shop_a", "bld_shrine_a", "bld_pavilion_a", "bld_apartment_a", "bld_campus_a"]
WORKS = (["bld_factory_a", "bld_tank_a", "bld_warehouse_a"], ["bld_rowhouse_a"] * 4 + ["bld_factory_b"])
DOWNTOWN = (["bld_office_a", "bld_tower_a", "bld_office_c", "bld_apartment_c"],
            ["bld_apartment_b", "bld_office_b", "bld_tower_b", "bld_tower_c"])


def _place_rows(north, south, gap=3.0, setback=2.0, road=7.0):
    """Two rows of buildings facing a street along x (north row at +y, front to the street; the
    south row turned round). Returns [(objects, model id, index)] and the scene extent."""
    import contract
    arch = contract.archetypes()
    placed, ext = [], []
    idx = 0
    for row, sign in ((north, 1.0), (south, -1.0)):
        sizes = [arch[m.split("_", 1)[1]]["footprint"] for m in row]
        total = sum(w for w, _ in sizes) + gap * (len(row) - 1)
        x = -total / 2
        for mid, (w, dd) in zip(row, sizes):
            y = sign * (road + 3.0 + setback + dd / 2)
            cx = x + w / 2 if sign > 0 else -(x + w / 2)
            objs = _import(contract.model_path(mid), cx, y, yaw=0.0 if sign > 0 else 180.0, tag=f"bld_{idx:02d}")
            placed.append((objs, mid, idx))
            ext.append((abs(x) + w, abs(y) + dd / 2))
            x += w + gap
            idx += 1
    half_x = max(e[0] for e in ext) + 4.0
    half_y = max(e[1] for e in ext) + 4.0
    return placed, (half_x, half_y)


def _paint(placed, manifest, roof_hex, district_tint=0xffffff, roof_base="#d9d9d9", shades=SHADES):
    """Recolor the placed buildings as the client should: walls (alpha above 0.75) to one of the
    model's tint colors times the district tint, divided by the model's base wall color; roofs
    (alpha 0.25 to 0.75) to the roof color in one of `shades`, divided by the roof base."""
    roof = _hex_lin(roof_hex) / _hex_lin(roof_base)
    dt = _hex_lin(district_tint)
    for objs, mid, idx in placed:
        entry = manifest.get(mid, {})
        tint = entry.get("tint") or {}
        cols = tint.get("colors") or []
        base = _hex_lin(tint.get("base", "#ffffff"))
        wall = (_hex_lin(cols[_hash(idx * 7 + 1) % len(cols)]) * dt / np.maximum(base, 0.02)) if cols else dt
        k = shades[_hash(idx * 13 + 5) % len(shades)]
        for ob in objs:
            orig = ob.get("mb_orig")
            rgba = np.array(orig, dtype=np.float32).reshape(-1, 4) if orig is not None else _float_colors(ob)
            if orig is None:
                ob["mb_orig"] = rgba.reshape(-1).tolist()
            a = rgba[:, 3]
            out = rgba.copy()
            is_wall = a > 0.75
            is_roof = (a >= 0.25) & (a <= 0.75)
            out[is_wall, :3] *= wall[None, :]
            out[is_roof, :3] *= (roof * k)[None, :]
            _set_colors(ob, out)


def districts_sheet(out: str, force: bool = False) -> str:
    import json
    import contract
    import mb
    import mb_preview as P
    stamp = _stamp("districts")
    if not force and mb._stamp_ok(out, stamp):
        return out
    from PIL import Image, ImageDraw
    from . import atlas, sheet
    with open(os.path.join(contract.ASSETS, "manifest.json"), encoding="utf-8") as f:
        manifest = json.load(f).get("models", {})
    roofs = city_colors("DISTRICT_ROOFS") or FALLBACK_ROOFS
    tints = city_colors("DISTRICT_TINTS")
    V = P.View
    cell = (960, 540)
    scenes = [
        ("street", ["Temple Hill", "Bellhaven", "Hollowmere", "Northgate"],
         V("", azimuth=24, elevation=36, fov=30, zoom=1.08)),
        ("works", ["The Cinder Works"], V("", azimuth=24, elevation=34, fov=30, zoom=1.05)),
        ("downtown", ["Downtown"], V("", azimuth=24, elevation=58, fov=30, zoom=1.0)),
    ]
    cells = []
    for name, districts, view in scenes:
        mb.reset()
        if name == "street":
            placed, (hx, hy) = _place_rows(STREET_NORTH, STREET_SOUTH)
        elif name == "works":
            placed, (hx, hy) = _place_rows(*WORKS, gap=6.0, road=8.0)
        else:
            placed, (hx, hy) = _place_rows(*DOWNTOWN, gap=8.0, road=11.0)
        _street(-hx, hx, -hy, hy, road=11.0 if name == "downtown" else (8.0 if name == "works" else 7.0))
        frame = tuple(f"bld_{i:02d}_*" for _o, _m, i in placed)
        for dist in districts:
            color = roofs.get(dist, FALLBACK_ROOFS.get(dist, 0x888888))
            _paint(placed, manifest, color, tints.get(dist, 0xffffff), atlas.ROOF_BASE)
            v = V(f"{dist}: roofs #{color:06x}", azimuth=view.azimuth, elevation=view.elevation, fov=view.fov,
                  zoom=view.zoom, frame=frame)
            img, cam = sheet._render(v, cell, False, None)
            c = P._decorate_cell(img, v, cam, cell)
            dd = ImageDraw.Draw(c)
            dd.rectangle([cell[0] - 58, 10, cell[0] - 12, 34], fill=f"#{color:06x}", outline=(236, 238, 242))
            cells.append(c)
            print(f"  {dist}: #{color:06x}", flush=True)
    cols = 2
    rows = math.ceil(len(cells) / cols)
    head = 64
    img = Image.new("RGB", (cols * cell[0] + (cols - 1) * 4, head + rows * (cell[1] + 4)), (24, 26, 33))
    d = ImageDraw.Draw(img)
    d.text((12, 8), "Roofs colored by district: the same street in four districts, then the Cinder Works and Downtown",
           font=P._font(22), fill=(236, 238, 242))
    d.text((12, 36), f"Each roof: its district's color (District.roof) in one of {len(SHADES)} shades picked by the "
                     "building's number; walls in the model's own tint colors. Landmarks keep their own colors.",
           font=P._font(14), fill=(160, 168, 182))
    for i, c in enumerate(cells):
        img.paste(c.convert("RGB"), ((i % cols) * (cell[0] + 4), head + (i // cols) * (cell[1] + 4)))
    return _save(img, out, stamp)


def main(argv=None) -> int:
    import contract
    args = list(sys.argv[1:] if argv is None else argv)
    out_dir = contract.PREVIEWS
    if "--out" in args:
        out_dir = args[args.index("--out") + 1]
    force = "--force" in args or bool(os.environ.get("MB_FORCE"))
    both = not ({"--test", "--districts"} & set(args))
    if both or "--test" in args:
        print(test_sheet(os.path.join(out_dir, "city_roofs_test.png"), force=force))
    if both or "--districts" in args:
        print(districts_sheet(os.path.join(out_dir, "city_roofs_districts.png"), force=force))
    return 0


if __name__ == "__main__":
    from city import roofs as _r
    raise SystemExit(_r.main())
