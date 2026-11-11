#!/opt/mbtools/venv/bin/python
# mb-family: sprites order=10
"""Builds every pixel-art sprite sheet and small texture, their manifest and review pictures.

    tools/art/sprites/build.py                build everything, then verify it
    tools/art/sprites/build.py --no-previews  sheets, textures and manifest only (2 seconds)
    tools/art/sprites/build.py --check        verify the files on disk against the manifest

Writes (docs/ASSETS.md sections 3, 4 and 7):
    client/public/assets/sprites/army.png, civilians.png, fx.png
    client/public/assets/textures/ground_*.png, clouds_a.png, clouds_b.png
    client/public/assets/manifest.sprites.json      ("sprites" and "textures" sections)
    docs/art/previews/...                           contact sheets, strips, tiling tests

The layout tables below are the single source of truth: the sheets are assembled from them
and the manifest is written from them, so the two cannot drift apart. `verify` then reads
the written files back and checks every animation cell the manifest names.
See README.md in this folder for the conventions.
"""
from __future__ import annotations

import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

import characters as ch  # noqa: E402
import clouds  # noqa: E402
import fx  # noqa: E402
import ground  # noqa: E402
from pix import (ASSETS, PREVIEWS, SPRITES, TEXTURES, Img, Sheet, col, hstack, label,  # noqa: E402
                 on_backdrop, save_preview, strip, upscale, vstack)

MANIFEST = os.path.join(ASSETS, "manifest.sprites.json")

# ---- layout: the single source of truth --------------------------------------------------

CELL = (24, 32)                 # soldiers and civilians
FX_CELL = (64, 64)
ARMY_SHEET = (512, 128)         # 21 x 4 cells
CIV_SHEET = (512, 256)          # 21 x 8 cells
FX_SHEET = (512, 512)           # 8 x 8 cells; rows 6 and 7 are free

# The soles of a figure stand one pixel above the bottom of its cell. A soldier is 26 pixels
# from helmet to sole and stands 1.8 m tall, so the whole 32-pixel cell is 2.2 m high.
CHARACTER_WORLD_HEIGHT = 2.2
FACING_ROWS = [0, 1, 2, 3]      # front, left, back, right

# id, kind, first column of its 7-column block (idle, walk x 4, fire x 2), row of its die strip
SOLDIERS = [
    ("soldier_army_rocket", "rocket", 0, 0),
    ("soldier_army_rifle", "rifle", 7, 1),
]
DIE_COL = 14
SOLDIER_ANIMS = [("idle", 0, 1, 1), ("walk", 1, 4, 8), ("fire", 5, 2, 8)]      # name, column offset, frames, fps
DIE_FRAMES, DIE_FPS = 4, 6

# civilian i (0..5) -> first column, first row of its 4 x 4 block (run, 4 frames per facing)
CIVILIAN_BLOCKS = [(0, 0), (4, 0), (8, 0), (0, 4), (4, 4), (8, 4)]
RUN_FPS = 10

# id -> (row, first column, frames, fps)
FX_LAYOUT = {
    "fx_explosion": (0, 0, 8, 16),
    "fx_smoke": (1, 0, 6, 8),
    "fx_spark": (1, 6, 1, 1),
    "fx_glow": (1, 7, 1, 1),
    "fx_dust": (2, 0, 6, 8),
    "fx_laserdot": (2, 6, 1, 1),
    "fx_ring": (2, 7, 1, 1),
    "fx_fire": (3, 0, 6, 10),
    "fx_shadow": (3, 6, 1, 1),
    "fx_white": (3, 7, 1, 1),
    "fx_debris": (4, 0, 4, 1),
    "fx_flash": (4, 4, 3, 20),
    "fx_explosion_ground": (5, 0, 8, 16),      # not in the contract list: a bonus (see README)
}

GROUND_IDS = ["ground_asphalt", "ground_sidewalk", "ground_grass", "ground_water", "ground_rubble"]
CLOUD_IDS = ["clouds_a", "clouds_b"]


# ---- sheets ------------------------------------------------------------------------------

def build_army() -> tuple:
    sheet = Sheet(*ARMY_SHEET, *CELL)
    frames = {}
    for sid, kind, col0, die_row in SOLDIERS:
        fr = ch.soldier_frames(kind)
        frames[sid] = fr
        for r, row in enumerate(fr["grid"]):
            for c, cell in enumerate(row):
                sheet.put(col0 + c, FACING_ROWS[r], cell)
        for c, cell in enumerate(fr["die"]):
            sheet.put(DIE_COL + c, die_row, cell)
    return sheet, frames


def build_civilians() -> tuple:
    sheet = Sheet(*CIV_SHEET, *CELL)
    frames = {}
    for i, (c0, r0) in enumerate(CIVILIAN_BLOCKS):
        grid = ch.civilian_frames(i)
        frames[f"civilian_{i + 1}"] = grid
        for r, row in enumerate(grid):
            for c, cell in enumerate(row):
                sheet.put(c0 + c, r0 + r, cell)
    return sheet, frames


def build_fx() -> tuple:
    sheet = Sheet(*FX_SHEET, *FX_CELL)
    frames = fx.build()
    for sid, (row, col0, n, _fps) in FX_LAYOUT.items():
        cells = frames[sid]
        if len(cells) != n:
            raise SystemExit(f"{sid}: the generator made {len(cells)} frames, the layout wants {n}")
        for c, cell in enumerate(cells):
            sheet.put(col0 + c, row, cell)
    return sheet, frames


def bleed_alpha(img: Img) -> np.ndarray:
    """Give fully transparent pixels the color of the nearest cloud pixel (alpha stays 0), so
    smaller mipmap levels do not pick up a dark fringe around the clouds."""
    from scipy import ndimage
    a = img.a.copy()
    solid = a[..., 3] > 0
    wide = np.concatenate([solid, solid, solid], axis=1)
    idx = ndimage.distance_transform_edt(~wide, return_distances=False, return_indices=True)
    w = a.shape[1]
    iy, ix = idx[0][:, w:2 * w], idx[1][:, w:2 * w] % w
    rgb = a[iy, ix, :3]
    a[..., :3] = np.where(solid[..., None], a[..., :3], rgb)
    return a


# ---- manifest ----------------------------------------------------------------------------

def make_manifest() -> dict:
    sprites = {}
    for sid, _kind, col0, die_row in SOLDIERS:
        anims = {name: {"rows": FACING_ROWS, "col": col0 + off, "frames": n, "fps": fps}
                 for name, off, n, fps in SOLDIER_ANIMS}
        anims["die"] = {"rows": [die_row], "col": DIE_COL, "frames": DIE_FRAMES, "fps": DIE_FPS}
        sprites[sid] = {"file": "sprites/army.png", "frame": list(CELL),
                        "worldHeight": CHARACTER_WORLD_HEIGHT, "anims": anims}
    for i, (c0, r0) in enumerate(CIVILIAN_BLOCKS):
        sprites[f"civilian_{i + 1}"] = {
            "file": "sprites/civilians.png", "frame": list(CELL), "worldHeight": CHARACTER_WORLD_HEIGHT,
            "anims": {"run": {"rows": [r0, r0 + 1, r0 + 2, r0 + 3], "col": c0, "frames": 4, "fps": RUN_FPS}},
        }
    for sid, (row, col0, n, fps) in FX_LAYOUT.items():
        sprites[sid] = {"file": "sprites/fx.png", "frame": list(FX_CELL), "worldHeight": 1,
                        "anims": {"play": {"rows": [row], "col": col0, "frames": n, "fps": fps}}}
    textures = {}
    for tid in GROUND_IDS + CLOUD_IDS:
        textures[tid] = {"file": f"textures/{tid}.png", "tile": True}
    return {"sprites": sprites, "textures": textures}


def dump_manifest(data: dict) -> str:
    """JSON with one line per animation, so the file reads like a table."""
    lines = ["{"]
    sections = list(data.items())
    for si, (section, entries) in enumerate(sections):
        lines.append(f'  "{section}": {{')
        items = sorted(entries.items())
        for ei, (key, entry) in enumerate(items):
            tail = "," if ei < len(items) - 1 else ""
            if "anims" not in entry:
                lines.append(f'    "{key}": {json.dumps(entry)}{tail}')
                continue
            lines.append(f'    "{key}": {{')
            lines.append(f'      "file": {json.dumps(entry["file"])},')
            lines.append(f'      "frame": {json.dumps(entry["frame"])},')
            lines.append(f'      "worldHeight": {json.dumps(entry["worldHeight"])},')
            lines.append('      "anims": {')
            anims = list(entry["anims"].items())
            for ai, (name, anim) in enumerate(anims):
                lines.append(f'        "{name}": {json.dumps(anim)}{"," if ai < len(anims) - 1 else ""}')
            lines.append("      }")
            lines.append(f"    }}{tail}")
        lines.append("  }" + ("," if si < len(sections) - 1 else ""))
    lines.append("}")
    return "\n".join(lines) + "\n"


# ---- verification ------------------------------------------------------------------------

def verify(quiet: bool = False) -> int:
    """Read the written files back and check them against the manifest. Returns the number
    of problems."""
    problems = []
    notes = []
    if not os.path.exists(MANIFEST):
        print(f"FAIL  {MANIFEST} does not exist")
        return 1
    with open(MANIFEST, encoding="utf-8") as f:
        data = json.load(f)
    expected = make_manifest()
    if data != expected:
        problems.append("manifest.sprites.json differs from the layout tables in build.py (rebuild)")
    used = {}        # file -> set of (col, row) cells named by an animation
    images = {}
    for sid, entry in sorted(data.get("sprites", {}).items()):
        path = os.path.join(ASSETS, entry["file"])
        if not os.path.exists(path):
            problems.append(f"{sid}: {entry['file']} does not exist")
            continue
        if entry["file"] not in images:
            images[entry["file"]] = np.asarray(Image.open(path).convert("RGBA"))
        arr = images[entry["file"]]
        fw, fh = entry["frame"]
        h, w = arr.shape[:2]
        if h % fh:
            problems.append(f"{sid}: sheet height {h} is not a whole number of {fh}-pixel rows")
        if not entry.get("worldHeight", 0) > 0:
            problems.append(f"{sid}: worldHeight must be positive")
        for name, anim in entry["anims"].items():
            if len(anim["rows"]) not in (1, 4):
                problems.append(f"{sid}.{name}: rows must list 1 or 4 rows")
            for row in anim["rows"]:
                for k in range(anim["frames"]):
                    c = anim.get("col", 0) + k
                    x0, y0 = c * fw, row * fh
                    if x0 + fw > w or y0 + fh > h:
                        problems.append(f"{sid}.{name}: cell ({c}, {row}) is outside the {w}x{h} sheet")
                        continue
                    if (c, row) in used.setdefault(entry["file"], {}):
                        problems.append(f"{sid}.{name}: cell ({c}, {row}) is also used by {used[entry['file']][(c, row)]}")
                    used[entry["file"]][(c, row)] = f"{sid}.{name}"
                    cell = arr[y0:y0 + fh, x0:x0 + fw]
                    if not (cell[..., 3] > 0).any():
                        problems.append(f"{sid}.{name}: cell ({c}, {row}) is empty")
    # nothing may be drawn outside the cells the manifest names
    for file, arr in images.items():
        entry = next(e for e in data["sprites"].values() if e["file"] == file)
        fw, fh = entry["frame"]
        h, w = arr.shape[:2]
        mask = np.zeros((h, w), bool)
        for (c, row) in used.get(file, {}):
            mask[row * fh:(row + 1) * fh, c * fw:(c + 1) * fw] = True
        stray = int(((arr[..., 3] > 0) & ~mask).sum())
        if stray:
            problems.append(f"{file}: {stray} pixels are drawn outside every animation cell")
        colors = len({tuple(p) for p in arr[arr[..., 3] > 0][:, :3]})
        notes.append(f"{file}: {w}x{h}, {len(used.get(file, {}))} cells, {colors} colors, "
                     f"{os.path.getsize(os.path.join(ASSETS, file))} bytes")
    for tid, entry in sorted(data.get("textures", {}).items()):
        path = os.path.join(ASSETS, entry["file"])
        if not os.path.exists(path):
            problems.append(f"{tid}: {entry['file']} does not exist")
            continue
        arr = np.asarray(Image.open(path).convert("RGBA"))
        h, w = arr.shape[:2]
        img = Img.from_array(arr)
        if (w & (w - 1)) or (h & (h - 1)):
            problems.append(f"{tid}: {w}x{h} is not a power-of-two size (tiling textures get mipmaps)")
        if tid.startswith("ground_"):
            if (w, h) != (64, 64):
                problems.append(f"{tid}: is {w}x{h}, the contract says 64x64")
            if (arr[..., 3] < 255).any():
                problems.append(f"{tid}: a ground tile must be fully opaque")
            seam = ground.seam_error(img)
            if seam > 1.05:
                problems.append(f"{tid}: the tile does not wrap cleanly (seam {seam:.2f}, limit 1.05)")
            notes.append(f"{entry['file']}: {w}x{h}, seam {seam:.2f}, {len(img.colors())} colors, {os.path.getsize(path)} bytes")
        else:
            if not (arr[..., 3] == 0).any() or not (arr[..., 3] == 255).any():
                problems.append(f"{tid}: clouds need both clear sky (alpha 0) and solid cloud (alpha 255)")
            if (arr[0, :, 3] > 0).any() or (arr[-1, :, 3] > 0).any():
                problems.append(f"{tid}: the top and bottom rows must be transparent so it can repeat vertically")
            solid = Img.from_array(np.where(arr[..., 3:4] > 0, arr, 0))
            seam = clouds.wrap_error(solid)
            if seam > 1.5:
                problems.append(f"{tid}: does not wrap left to right (seam {seam:.2f})")
            notes.append(f"{entry['file']}: {w}x{h}, wrap {seam:.2f}, {len(solid.colors())} colors, {os.path.getsize(path)} bytes")
    if not quiet:
        for n in notes:
            print("      " + n)
    for p in problems:
        print("FAIL  " + p)
    n_s, n_t = len(data.get("sprites", {})), len(data.get("textures", {}))
    print(f"{'FAIL' if problems else 'PASS'}  sprites family: {n_s} sprites, {n_t} textures, {len(problems)} problem(s)")
    return len(problems)


# ---- review pictures ---------------------------------------------------------------------

GROUND_COLORS = ("#2b3040", "#b9bcc6", "#4fbf5f", "#8d8d94")


def side_label(text: str, height: int, width: int = 64) -> Image.Image:
    from PIL import ImageDraw
    from pix import _font
    im = Image.new("RGBA", (width, height), col("#20222c"))
    ImageDraw.Draw(im).text((6, height // 2 - 8), text, fill=col("#e8eaf2"), font=_font(14))
    return im


def native_rows(frames: list, scale: int = 1) -> Image.Image:
    """The frames at native size on the four ground colors: the readability test."""
    bands = []
    for bg in GROUND_COLORS:
        w = sum(f.w for f in frames) + 4 * (len(frames) + 1)
        band = Image.new("RGBA", (w, frames[0].h + 6), col(bg))
        x = 4
        for f in frames:
            band.alpha_composite(f.pil(), (x, 3))
            x += f.w + 4
        bands.append(upscale(band, scale) if scale > 1 else band)
    return vstack(bands)


def preview_soldier(sid: str, fr: dict) -> str:
    k = 8
    rows = []
    for facing, row in zip(ch.FACINGS, fr["grid"]):
        rows.append(hstack([side_label(facing, CELL[1] * k), strip(row, k)]))
    rows.append(hstack([side_label("die", CELL[1] * k), strip(fr["die"], k)]))
    width = rows[0].width
    head = label(f"{sid}   24 x 32 px cells, shown 8x   columns: idle | walk 1-4 | fire 1-2   last row: die 1-4", width)
    flat = [f for row in fr["grid"] for f in row] + fr["die"]
    foot = label("native size and 2x on asphalt, sidewalk, grass, rubble", width)
    pic = vstack([head] + rows + [foot, native_rows(flat[:28]), native_rows(flat[:14] + fr["die"], 2)])
    return save_preview(pic, os.path.join(PREVIEWS, f"{sid}.png"))


def preview_civilian(sid: str, grid: list, name: str) -> str:
    k = 8
    rows = [hstack([side_label(facing, CELL[1] * k), strip(row, k)]) for facing, row in zip(ch.FACINGS, grid)]
    width = rows[0].width
    head = label(f"{sid} ({name})   24 x 32 px cells, shown 8x   run 1-4 per facing", width)
    flat = [f for row in grid for f in row]
    pic = vstack([head] + rows + [label("native size and 2x", width), native_rows(flat), native_rows(flat[:10], 2)])
    return save_preview(pic, os.path.join(PREVIEWS, f"{sid}.png"))


def preview_fx(frames: dict) -> list:
    out = []
    k = 4
    blocks = []
    for bg, title in (("#2b3040", "on asphalt"), ("#a8d4f5", "on sky"), ("#8d8d94", "on rubble")):
        rows = []
        for sid, (row, col0, n, fps) in sorted(FX_LAYOUT.items(), key=lambda kv: (kv[1][0], kv[1][1])):
            cells = hstack([on_backdrop(f, bg, k) for f in frames[sid]])
            rows.append(vstack([label(f"{sid}   {n} frame{'s' if n > 1 else ''}, {fps} fps   ({title}, 4x)", 64 * 8 * k), cells]))
        blocks.append(vstack(rows))
    out.append(save_preview(blocks[0], os.path.join(PREVIEWS, "fx.png")))
    out.append(save_preview(blocks[1], os.path.join(PREVIEWS, "fx_on_sky.png")))
    out.append(save_preview(blocks[2], os.path.join(PREVIEWS, "fx_on_rubble.png")))
    # the hero: the explosion, 8x, two rows of four
    for sid in ("fx_explosion", "fx_explosion_ground"):
        ex = frames[sid]
        pic = vstack([label(f"{sid}   8 frames at 16 fps, shown 8x", 64 * 4 * 8),
                      strip(ex[:4], 8, "#2b3040"), strip(ex[4:], 8, "#2b3040")])
        out.append(save_preview(pic, os.path.join(PREVIEWS, f"{sid}.png")))
    fire = frames["fx_fire"]
    pic = vstack([label("fx_fire   6 frames at 10 fps (loops), shown 6x", 64 * 6 * 6), strip(fire, 6, "#2b3040")])
    out.append(save_preview(pic, os.path.join(PREVIEWS, "fx_fire.png")))
    return out


def preview_ground(tid: str, img: Img) -> str:
    t3 = Img.from_array(np.tile(img.a, (3, 3, 1)))
    left = upscale(t3, 4)
    right = upscale(img, 12)
    width = left.width + 8 + right.width
    head = label(f"{tid}   64 x 64 px   left: 3 x 3 tiling test (4x)   right: one tile (12x)   "
                 f"{len(img.colors())} colors", width)
    return save_preview(vstack([head, hstack([left, right], gap=8)]), os.path.join(PREVIEWS, f"{tid}.png"))


def sky_gradient(w: int, h: int, top, bottom) -> Image.Image:
    t = np.linspace(0, 1, h, dtype=np.float32)[:, None, None]
    a = np.array(col(top), np.float32)[None, None, :]
    b = np.array(col(bottom), np.float32)[None, None, :]
    arr = np.clip(a * (1 - t) + b * t, 0, 255).astype(np.uint8) * np.ones((1, w, 1), np.uint8)
    return Image.fromarray(arr, "RGBA")


def tinted(img: Img, tint) -> Img:
    a = img.a.astype(np.float32)
    a[..., :3] *= np.array(tint, np.float32)
    return Img.from_array(np.clip(np.round(a), 0, 255).astype(np.uint8))


SKIES = (
    ("afternoon", "#2f6fd0", "#a8d4f5", (1.0, 1.0, 1.0)),
    ("sunset", "#3b4f9a", "#ff9a5c", (1.0, 0.74, 0.60)),
    ("night", "#070b1c", "#1c2a52", (0.30, 0.36, 0.56)),
)


def preview_clouds(tid: str, img: Img) -> str:
    wide = Img.from_array(np.concatenate([img.a, img.a[:, :256]], axis=1))       # one and a half wraps
    k = 2
    panels = []
    for name, top, bottom, tint in SKIES:
        bg = sky_gradient(wide.w * k, wide.h * k, top, bottom)
        bg.alpha_composite(upscale(tinted(wide, tint), k))
        panels.append(vstack([label(f"{tid}   512 x 256 px, wraps left to right; shown 2x, one and a half wraps   "
                                    f"{name} (tint {tint[0]:.2f}, {tint[1]:.2f}, {tint[2]:.2f})", bg.width), bg]))
    return save_preview(vstack(panels), os.path.join(PREVIEWS, f"{tid}.png"))


def preview_sheet(name: str, sheet: Sheet, k: int) -> str:
    """The whole sheet enlarged, with cell lines and column / row numbers: the picture to
    check manifest rows and columns against."""
    from PIL import ImageDraw
    from pix import _font
    big = on_backdrop(sheet.img, "checker", k, cell=4)
    line = col("#000000", 90)
    overlay = Image.new("RGBA", big.size, (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    for c in range(sheet.cols + 1):
        od.line([(c * sheet.cw * k, 0), (c * sheet.cw * k, sheet.rows * sheet.ch * k)], fill=line)
    for r in range(sheet.rows + 1):
        od.line([(0, r * sheet.ch * k), (sheet.cols * sheet.cw * k, r * sheet.ch * k)], fill=line)
    big.alpha_composite(overlay)
    d = ImageDraw.Draw(big)
    for c in range(sheet.cols):
        d.text((c * sheet.cw * k + 3, 1), str(c), fill=col("#ffffff", 200), font=_font(11))
    for r in range(1, sheet.rows):
        d.text((3, r * sheet.ch * k + 1), str(r), fill=col("#ffffff", 200), font=_font(11))
    head = label(f"sprites/{name}.png   {sheet.img.w} x {sheet.img.h} px, cells {sheet.cw} x {sheet.ch}, shown {k}x   "
                 f"numbers: column (top), row (left)", big.width)
    return save_preview(vstack([head, big]), os.path.join(PREVIEWS, f"sheet_{name}.png"))


def preview_scene(army: dict, civs: dict, fxf: dict, tiles: dict, sky: dict) -> str:
    """A flat mock street: every sprite family together over the real tiles, to judge how the
    palettes sit with each other. Native size, then enlarged three times."""
    rng = np.random.default_rng(9001)
    w, h = 448, 256
    scene = sky_gradient(w, h, "#2f6fd0", "#a8d4f5")
    cl = Img.from_array(sky["clouds_a"].a[40:232, 40:40 + w].copy())
    scene.alpha_composite(cl.pil(), (0, -70))

    def band(tile: Img, y0: int, y1: int) -> None:
        reps = np.tile(tile.a, ((y1 - y0) // 64 + 2, w // 64 + 2, 1))[:y1 - y0, :w]
        scene.paste(Image.fromarray(reps, "RGBA"), (0, y0))

    band(tiles["ground_grass"], 104, 136)
    band(tiles["ground_sidewalk"], 136, 156)
    band(tiles["ground_asphalt"], 156, 220)
    band(tiles["ground_sidewalk"], 220, 236)
    band(tiles["ground_water"], 236, 256)
    rub = np.tile(tiles["ground_rubble"].a, (2, 3, 1))[:84, :150]
    scene.paste(Image.fromarray(rub, "RGBA"), (298, 104))

    shadow = tinted(fxf["fx_shadow"][0], (0, 0, 0))

    def put(img: Img, x: int, y: int, shadowed: bool = True) -> None:
        """Paste a figure with its feet at (x, y)."""
        if shadowed:
            sh = shadow.pil().resize((18, 6), Image.NEAREST)
            sh.putalpha(sh.getchannel("A").point(lambda v: v * 0.5))
            scene.alpha_composite(sh, (x - 9, y - 4))
        scene.alpha_composite(img.pil(), (x - img.w // 2, y - img.h + 1))

    def put_fx(img: Img, x: int, y: int, size: int = 64, tint=None) -> None:
        im = (tinted(img, tint) if tint else img).pil()
        if size != 64:
            im = im.resize((size, size), Image.NEAREST)
        scene.alpha_composite(im, (x - size // 2, y - size // 2))

    things = []      # (feet y, callable) so nearer things are drawn later
    rocket, rifle = army["soldier_army_rocket"], army["soldier_army_rifle"]
    # a section marching right along the road, three launchers in front
    for i in range(10):
        fr = rocket if i < 3 else rifle
        x = 150 - (i % 5) * 22 - (i // 5) * 9
        y = 176 + (i // 5) * 22 + (i % 2) * 3
        cell = fr["grid"][3][1 + (i * 3) % 4]
        things.append((y, lambda c=cell, x=x, y=y: put(c, x, y)))
    # a firing line facing the rubble
    for i in range(6):
        fr = rocket if i % 2 == 0 else rifle
        x, y = 232 + (i % 2) * 14, 164 + i * 9
        cell = fr["grid"][3][5 + (i % 2)]
        things.append((y, lambda c=cell, x=x, y=y: put(c, x, y)))
    for i, (sid, facing, x, y) in enumerate([("soldier_army_rifle", 0, 196, 214), ("soldier_army_rocket", 0, 60, 218),
                                             ("soldier_army_rocket", 2, 180, 160), ("soldier_army_rifle", 2, 92, 160)]):
        cell = army[sid]["grid"][facing][0]
        things.append((y, lambda c=cell, x=x, y=y: put(c, x, y)))
    things.append((204, lambda: put(rocket["die"][3], 262, 216, False)))
    things.append((190, lambda: put(rifle["die"][2], 284, 198, False)))
    # civilians fleeing left along the sidewalk and across the grass
    for i in range(14):
        grid = civs[f"civilian_{i % 6 + 1}"]
        facing = 1 if i % 4 else (0 if i % 8 == 0 else 2)
        x = 20 + int(rng.integers(0, 250))
        y = 122 + int(rng.integers(0, 30))
        cell = grid[facing][int(rng.integers(0, 4))]
        things.append((y, lambda c=cell, x=x, y=y: put(c, x, y)))
    for _y, draw in sorted(things, key=lambda t: t[0]):
        draw()
    # effects on the rubble side
    put_fx(fxf["fx_smoke"][3], 392, 96, 64, (0.42, 0.42, 0.47))
    put_fx(fxf["fx_smoke"][2], 372, 116, 48, (0.36, 0.36, 0.40))
    put_fx(fxf["fx_fire"][1], 384, 136, 48)
    put_fx(fxf["fx_fire"][4], 330, 150, 32)
    put_fx(fxf["fx_dust"][2], 322, 178, 64)
    put_fx(fxf["fx_debris"][0], 356, 168, 16, (0.95, 0.89, 0.70))
    put_fx(fxf["fx_debris"][2], 404, 172, 16, (0.77, 0.33, 0.24))
    put_fx(fxf["fx_debris"][3], 378, 182, 24, (0.56, 0.78, 0.95))
    put_fx(fxf["fx_explosion"][2], 300, 128, 64)
    put_fx(fxf["fx_explosion"][4], 420, 150, 48)
    put_fx(fxf["fx_ring"][0], 300, 128, 96, (1.0, 0.95, 0.8))
    put_fx(fxf["fx_laserdot"][0], 352, 112, 32, (0.12, 0.78, 0.88))
    put_fx(fxf["fx_flash"][0], 258, 148, 24)
    head = label("mock street: sprites, effects, ground tiles and clouds together   top: native size, bottom: 3x", w * 3)
    native = Image.new("RGBA", (w * 3, h), col("#20222c"))
    native.paste(scene, (0, 0))
    native.paste(scene.resize((w * 2, h * 2), Image.NEAREST).crop((0, h, w * 2, h * 2)), (w + 8, 0))
    pic = vstack([head, native, upscale(scene, 3)])
    return save_preview(pic, os.path.join(PREVIEWS, "sprites_scene.png"))


# ---- main --------------------------------------------------------------------------------

def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Build the pixel-art sprites, effects, ground tiles and clouds.")
    ap.add_argument("--no-previews", action="store_true", help="skip the review pictures")
    ap.add_argument("--check", action="store_true", help="only verify the files on disk")
    ap.add_argument("-q", "--quiet", action="store_true")
    ap.add_argument("--no-concept", action="store_true", help="accepted for build_all.sh; no effect here")
    ap.add_argument("--force", action="store_true", help="accepted for build_all.sh; everything is always rebuilt")
    args = ap.parse_args(argv)
    if args.check:
        return 1 if verify(args.quiet) else 0
    no_previews = args.no_previews or bool(os.environ.get("MB_NO_PREVIEWS"))

    army_sheet, army_frames = build_army()
    civ_sheet, civ_frames = build_civilians()
    fx_sheet, fx_frames = build_fx()
    army_sheet.save(os.path.join(SPRITES, "army.png"))
    civ_sheet.save(os.path.join(SPRITES, "civilians.png"))
    fx_sheet.save(os.path.join(SPRITES, "fx.png"))

    tiles = ground.build()
    os.makedirs(TEXTURES, exist_ok=True)
    for tid in GROUND_IDS:
        Image.fromarray(tiles[tid].a[..., :3], "RGB").save(os.path.join(TEXTURES, f"{tid}.png"), optimize=True)
    sky = clouds.build()
    for tid in CLOUD_IDS:
        Image.fromarray(bleed_alpha(sky[tid]), "RGBA").save(os.path.join(TEXTURES, f"{tid}.png"), optimize=True)

    with open(MANIFEST, "w", encoding="utf-8") as f:
        f.write(dump_manifest(make_manifest()))
    if not args.quiet:
        print(f"wrote 3 sheets, {len(GROUND_IDS)} ground tiles, {len(CLOUD_IDS)} cloud textures and {os.path.relpath(MANIFEST)}")

    if not no_previews:
        made = []
        for sid, _kind, _c, _r in SOLDIERS:
            made.append(preview_soldier(sid, army_frames[sid]))
        styles = ch.civilian_styles()
        for i in range(len(CIVILIAN_BLOCKS)):
            made.append(preview_civilian(f"civilian_{i + 1}", civ_frames[f"civilian_{i + 1}"], styles[i]["name"]))
        made += preview_fx(fx_frames)
        for tid in GROUND_IDS:
            made.append(preview_ground(tid, tiles[tid]))
        for tid in CLOUD_IDS:
            made.append(preview_clouds(tid, sky[tid]))
        made.append(preview_sheet("army", army_sheet, 4))
        made.append(preview_sheet("civilians", civ_sheet, 4))
        made.append(preview_sheet("fx", fx_sheet, 2))
        made.append(preview_scene(army_frames, civ_frames, fx_frames, tiles, sky))
        if not args.quiet:
            print(f"wrote {len(made)} review pictures to {os.path.relpath(PREVIEWS)}")
    return 1 if verify(args.quiet) else 0


if __name__ == "__main__":
    raise SystemExit(main())
