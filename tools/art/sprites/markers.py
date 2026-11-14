"""World markers: the game's shape language laid on the ground and over heads (DESIGN.md
section 8): a circle for humans, a triangle for the kaiju, a diamond for a charging volley,
plus a chevron, a cross and a dot. 32 x 32 pixel cells.

They are white: the game tints each copy (cyan for humans, orange for the kaiju, yellow for a
volley), so the picture only carries the shape. Each shape is a solid white rim three pixels
wide around a see-through white inside, with a one-pixel dark edge outside the rim so that a
pale marker still reads on pale paving. The sizes match the client's own stand-ins
(client/src/assets/procedural/sprites.ts, markerSheet), so nothing moves when the art lands.
"""
from __future__ import annotations

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

from pix import OUTLINE, Img, col

S = 32                      # cell size in pixels
SS = 8                      # supersampling while drawing the shapes
RIM = 3.0                   # rim width in pixels
INSIDE_ALPHA = 90           # the see-through inside (about 35 percent, as the stand-in)
EDGE_ALPHA = 190            # the dark edge outside the rim
IDS = ["mk_circle", "mk_triangle", "mk_diamond", "mk_chevron", "mk_cross", "mk_dot"]


def _canvas():
    return Image.new("L", (S * SS, S * SS), 0)


def _poly(points):
    m = _canvas()
    ImageDraw.Draw(m).polygon([((x + 0.5) * SS, (y + 0.5) * SS) for x, y in points], fill=255)
    return np.asarray(m) > 0


def _disc(cx, cy, r):
    m = _canvas()
    ImageDraw.Draw(m).ellipse([((cx + 0.5 - r) * SS, (cy + 0.5 - r) * SS), ((cx + 0.5 + r) * SS, (cy + 0.5 + r) * SS)],
                              fill=255)
    return np.asarray(m) > 0


def _strokes(lines, width):
    m = _canvas()
    d = ImageDraw.Draw(m)
    w = width * SS
    for pts in lines:
        p = [((x + 0.5) * SS, (y + 0.5) * SS) for x, y in pts]
        d.line(p, fill=255, width=int(w), joint="curve")
        for x, y in p:                       # round ends
            d.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=255)
    return np.asarray(m) > 0


def _down(mask: np.ndarray) -> np.ndarray:
    """Coverage 0..1 per pixel of a supersampled mask."""
    return mask.reshape(S, SS, S, SS).mean(axis=(1, 3))


def _shape(sid: str):
    """(solid mask, inside mask) at the supersampled size. The inside is the see-through part;
    shapes drawn as strokes have none."""
    c = (S - 1) / 2
    if sid == "mk_circle":
        solid = _disc(c, c, 12.2)
    elif sid == "mk_triangle":                       # pointing down, as the stand-in
        solid = _poly([(c, c + 13), (c - 13, c - 10.5), (c + 13, c - 10.5)])
    elif sid == "mk_diamond":
        solid = _poly([(c, c - 14), (c + 12, c), (c, c + 14), (c - 12, c)])
    elif sid == "mk_chevron":
        return _strokes([[(c - 11, c + 5), (c, c - 7), (c + 11, c + 5)]], 5.0), None
    elif sid == "mk_cross":
        return _strokes([[(c - 10, c - 10), (c + 10, c + 10)], [(c + 10, c - 10), (c - 10, c + 10)]], 5.0), None
    else:                                            # mk_dot: a small solid disc
        return _disc(c, c, 5.5), None
    inside = ndimage.binary_erosion(solid, iterations=int(RIM * SS))
    return solid, inside


def marker(sid: str) -> Img:
    solid, inside = _shape(sid)
    cover = _down(solid)
    inner = _down(inside) if inside is not None else np.zeros_like(cover)
    rim = cover - inner
    out = np.zeros((S, S, 4), np.uint8)
    white = np.array(col("#ffffff")[:3], np.uint8)
    rim_px = rim >= 0.5
    in_px = (inner >= 0.5) & ~rim_px
    out[in_px, :3] = white
    out[in_px, 3] = INSIDE_ALPHA
    out[rim_px, :3] = white
    out[rim_px, 3] = 255
    # the dark edge: pixels just outside the rim (four neighbors), never on the cell border
    body = rim_px | in_px
    edge = ndimage.binary_dilation(body) & ~body
    edge[0, :] = edge[-1, :] = edge[:, 0] = edge[:, -1] = False
    out[edge, :3] = np.array(col(OUTLINE)[:3], np.uint8)
    out[edge, 3] = EDGE_ALPHA
    return Img.from_array(out)


def build() -> dict:
    return {sid: marker(sid) for sid in IDS}
