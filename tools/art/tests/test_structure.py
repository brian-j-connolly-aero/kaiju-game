"""Exercises the building workflow: three states, collapse chunks, and atlas UVs.

Builds a small test building in /tmp/mb-scratch/art-tests/bld_test.glb with nodes intact,
damaged, rubble and chunk_00.., walls mapped into a made-up 4 x 4 atlas of numbered tiles,
validates it as a structure, checks the UVs in the file numerically, and renders a sheet
to docs/art/conventions/structure_test_sheet.png where each tile's number must read the
right way up and unmirrored. A test and a pattern to copy, not art.

    /opt/mbtools/venv/bin/python tools/art/tests/test_structure.py
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
import numpy as np  # noqa: E402

import glb  # noqa: E402
import mb  # noqa: E402
import validation  # noqa: E402

OUT = "/tmp/mb-scratch/art-tests"
DOCS = os.path.join(mb.REPO, "docs", "art", "conventions")
GRID = (4, 4)


def make_test_atlas(path):
    """16 numbered tiles, each with a different tint and a dark strip along its bottom."""
    from PIL import Image, ImageDraw, ImageFont
    cell = 32
    img = Image.new("RGB", (cell * GRID[0], cell * GRID[1]))
    d = ImageDraw.Draw(img)
    font = ImageFont.load_default(size=22)
    tints = ["bld_cream", "bld_salmon", "bld_sky", "bld_mint", "bld_mustard", "bld_peach", "bld_lilac", "bld_white"]
    for row in range(GRID[1]):
        for col in range(GRID[0]):
            i = row * GRID[0] + col
            x, y = col * cell, row * cell
            d.rectangle([x, y, x + cell - 1, y + cell - 1], fill=mb.PALETTE[tints[i % len(tints)]])
            d.rectangle([x, y + cell - 5, x + cell - 1, y + cell - 1], fill=mb.PALETTE["bld_slate"])   # bottom strip
            d.text((x + 5, y + 1), str(i), font=font, fill=mb.PALETTE["road"])
    img.save(path)


def build():
    mb.reset()
    w, d, h = 10.0, 8.0, 12.0

    def cell(col, row):
        return mb.atlas_rect(col, row, GRID)

    # intact: a plaster block. Each wall gets its own numbered tile; the roof is vertex color.
    body = mb.box((w, d, h), at=(0, 0, 0), color="bld_cream", anchor="bottom")
    body.uv_fit(cell(1, 0), where="front")       # tile 1
    body.uv_fit(cell(2, 0), where="left")        # tile 2
    body.uv_fit(cell(3, 0), where="back")        # tile 3
    body.uv_fit(cell(0, 1), where="right")       # tile 4
    body.paint("bld_roof_dark", where="top")
    body += mb.box((3, 3, 1.2), at=(-2, 1, h), color="bld_concrete", anchor="bottom")   # roof hut
    mb.node("intact", body)

    # damaged: same silhouette, a corner bitten off and scorched
    dmg = mb.box((w, d, h * 0.6), at=(0, 0, 0), color="bld_cream", anchor="bottom")
    dmg.uv_fit(cell(1, 1), where="front").uv_fit(cell(2, 1), where="left")
    dmg.uv_fit(cell(3, 1), where="back").uv_fit(cell(0, 2), where="right")
    dmg.paint("scorch", where="top")
    upper = mb.wedge((w * 0.6, d, h * 0.4), at=(-w * 0.2, 0, h * 0.6), high="right", color="bld_cream")
    upper.paint("scorch", where=lambda c, n: n.z > 0.2)
    dmg += upper
    dmg += mb.box((3, 3, 1.2), at=(-2, 1, h * 0.6), color="bld_concrete", anchor="bottom")
    mb.node("damaged", dmg)

    # rubble: a low grey pile inside the footprint
    rub = mb.Geo()
    for i, (x, y, s) in enumerate([(-2.5, -1.5, 3.2), (2.2, 1.0, 3.6), (0.5, -2.0, 2.4), (-1.0, 2.2, 2.8)]):
        rub += mb.tapered_box((s, s), (s * 0.45, s * 0.5), 0.5 + 0.25 * i, at=(x, y, 0),
                              color="rubble_grey" if i % 2 else "rubble_grey_dk", cap_bottom=False).rz(17 * i, about=(x, y, 0))
    mb.node("rubble", rub)

    # chunks: the intact volume broken into blocks, each its own node with a centered origin
    mb.chunk_nodes(mb.shatter_box((-w / 2, -d / 2, 0), (w / 2, d / 2, h), cuts=(2, 2, 3),
                                  colors=["bld_cream", "bld_cream_dk"], seed=4))


def check(label, ok, detail=""):
    print(("PASS  " if ok else "FAIL  ") + label + (f"  ({detail})" if detail else ""))
    return bool(ok)


def main() -> int:
    os.makedirs(OUT, exist_ok=True)
    atlas = os.path.join(OUT, "test_atlas.png")
    make_test_atlas(atlas)
    path = os.path.join(OUT, "bld_test.glb")
    build()
    mb.export_glb(path)
    rep = validation.validate_file(path, kind="structure", size_class="medium")
    print(rep.format())
    ok = rep.ok

    g = glb.load(path)
    intact = g.node("intact")
    prims = {p.material: p for p in g.meshes[intact.mesh]}
    ok &= check("intact has one city_atlas and one vcol primitive", set(prims) == {"city_atlas", "vcol"})
    p = prims["city_atlas"]
    front = np.nonzero(p.normals[:, 2] > 0.9)[0]            # the wall facing +Z (the model's front)
    pos, uv = p.positions[front], p.uvs[front]
    # seen from in front, the viewer's left is -X: the wall's top-left corner is (min x, max y)
    tl = int(np.argmin(pos[:, 0] - pos[:, 1]))
    br = int(np.argmax(pos[:, 0] - pos[:, 1]))
    u0, v0 = 1 / GRID[0], 0.0                                # tile 1 = column 1, row 0 (from the top)
    inset = 0.02 / GRID[0]
    ok &= check("front wall top-left corner maps to the tile's top-left (glTF v runs down)",
                np.allclose(uv[tl], [u0 + inset, v0 + inset], atol=1e-5), f"uv = {np.round(uv[tl], 4).tolist()}")
    ok &= check("front wall bottom-right corner maps to the tile's bottom-right",
                np.allclose(uv[br], [u0 + 0.25 - inset, v0 + 0.25 - inset], atol=1e-5), f"uv = {np.round(uv[br], 4).tolist()}")
    ok &= check("no textures travel inside the file", not g.json.get("images") and not g.json.get("textures"))
    chunks = [n for n in g.node_names() if n.startswith("chunk_")]
    ok &= check("12 chunks, each 12 triangles, pivots at their centers", len(chunks) == 12
                and all(g.node_tris(c) == 12 for c in chunks))

    man_entry_scope = g.size(g.subtree("intact"))
    ok &= check("size is measured on the intact state", man_entry_scope == [10.0, 13.2, 8.0], str(man_entry_scope))

    mb.set_preview_atlas(atlas)
    mb.load_glb(path)
    # all states share one file and one spot: each view picks the nodes it shows
    sheet = mb.contact_sheet("structure_test", out=os.path.join(DOCS, "structure_test_sheet.png"),
                             title="structure test: numbered atlas tiles must read upright and unmirrored",
                             show=("intact",), views=("front", "side", "back", "right", "three_quarter"),
                             extra=mb.STRUCTURE_STATE_VIEWS)
    mb.set_preview_atlas(None)
    print("sheet:", os.path.relpath(sheet, mb.REPO))
    print("STRUCTURE TEST PASSED" if ok else "STRUCTURE TEST FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
