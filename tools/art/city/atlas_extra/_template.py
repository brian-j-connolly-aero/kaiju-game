"""Template for a family's atlas painter. Copy to tools/art/city/atlas_extra/<family>.py
(homes, blocks, industry or landmarks); files starting with "_" are ignored.

Your regions must lie inside your family's block (atlas.BLOCKS), and their names must be new.
Give a facade or plain wall a damaged twin of the same size with twin=(x, y): the kit paints
the twin for you (broken glass, soot, cracks, fires at night) from the windows your painter
reports. After editing, run tools/art/city_kit.py and look at
docs/art/previews/city_kit_atlas.png.
"""
from city import atlas

FAMILY = "homes"            # homes | blocks | industry | landmarks

REGIONS = [
    # a 4-bay x 2-storey facade with its damaged twin right below it
    dict(name="homes_example_sash", x=0, y=256, w=64, h=32, kind="facade", tint=True,
         twin=(0, 288), note="example: plaster with arched windows"),
]


def paint(cv, r, rng):
    """Paint region r into cv.col (daylight, 0..255 floats) and cv.emi (night glow).
    Return an atlas.Windows with the panes, so the twin and the night lights find them."""
    c, e = cv.view(r)
    atlas.fill(c, atlas.WALL_TINT, rng, 5)
    win = atlas.Windows(c.shape)
    for by in range(r.storeys):
        for bx in range(r.bays):
            atlas.sash_window(c, win, by * 16 + 2, bx * 16 + 4, rng)
    atlas.light_windows(e, win, rng, 0.55, atlas.LIGHTS_HOME)
    return win
