"""Monster Battle 9001 palette: the anchors from docs/ASSETS.md section 2, extended into a
small set of named shades. Pure Python (no Blender needed).

All values are sRGB hex strings, exactly as a person would pick them in a paint program.
`mb.py` converts them to linear light when it writes vertex colors (glTF COLOR_0 is linear).

Use a name anywhere a color is accepted:  mb.box(..., color="kaiju_orange")
or the constant:                           mb.box(..., color=C.KAIJU_ORANGE)
Every base color also has a darker and a lighter shade: "kaiju_orange_dk", "kaiju_orange_lt".

Run this file to (re)draw the swatch sheet:  python tools/art/lib/palette.py
"""
from __future__ import annotations

import colorsys
import os

# ---- the binding anchors (docs/ASSETS.md section 2) -------------------------------------
ANCHORS = {
    "human_cyan": "#1ec8e0",     # humans, friendly markers, army identification stripes
    "kaiju_orange": "#ff7a1a",   # the kaiju color language
    "volley_yellow": "#ffd91a",  # charging volleys
    "rubble_grey": "#8d8d94",    # rubble, destroyed ground
    "road": "#2b3040",
    "sidewalk": "#b9bcc6",
    "grass": "#4fbf5f",
    "water": "#2f7fd6",
}

# ---- extensions -------------------------------------------------------------------------
_GROUPS: dict[str, dict[str, str]] = {
    "anchors": ANCHORS,
    # Buildings: saturated-but-light plaster tones, like a painted model city.
    "buildings": {
        "bld_cream": "#f3e3b3",
        "bld_salmon": "#f29b85",
        "bld_sky": "#8fc7f2",
        "bld_mint": "#9fe0c0",
        "bld_mustard": "#e3b23c",
        "bld_brick": "#c5553d",
        "bld_slate": "#6f7f96",
        "bld_white": "#f4f1ea",
        "bld_teal_glass": "#3fb7b0",
        "bld_peach": "#f7c59f",
        "bld_lilac": "#b9a6e0",
        "bld_terracotta": "#d9774a",   # roof tiles
        "bld_roof_dark": "#4a4f63",    # flat tar roofs
        "bld_concrete": "#a9a69e",
    },
    # Army: olive with cyan identification stripes (the stripe is human_cyan).
    "army": {
        "army_olive": "#6b7a3a",
        "army_khaki": "#a79a6a",
        "army_track": "#2e3138",       # tracks, tires, gun barrels
        "army_burnt": "#3a3531",       # wrecks
    },
    # Kaiju: each owns a warm scheme.
    "kaiju": {
        "gragnor_orange": "#d9661e",   # burnt orange body
        "gragnor_rust": "#9c3a14",     # stripes
        "gragnor_cream": "#f2dca8",    # belly
        "krabulon_crimson": "#d0213a",
        "krabulon_shell": "#f2b89a",   # pale underside
        "drillmaw_ochre": "#c9952c",
        "drillmaw_purple": "#5b3a4a",  # purple-brown plates
        "vespera_amber": "#ffb21e",
        "vespera_pink": "#ff6fa8",
        "bone": "#efe6cf",             # claws, teeth, spines
        "maw": "#7a1f2b",              # mouth interior
        "tongue": "#e06a7a",
        "scar": "#6e2a2a",
    },
    # Everyday materials for props and vehicles.
    "common": {
        "white": "#f5f5f0",
        "black": "#1b1d24",
        "grey_dark": "#4a4d57",
        "grey_light": "#c9ccd4",
        "red": "#e0372f",              # hydrants, tail lights, fire engines
        "blue": "#2f62c9",
        "taxi_yellow": "#f7c21a",
        "leaf": "#3fa652",             # tree crowns (grass anchor is the lawn color)
        "leaf_autumn": "#e39a2d",
        "trunk": "#7a5236",
        "wood": "#a8743f",
        "metal": "#9aa3ad",
        "chrome": "#d7dde3",
        "glass": "#7fd3e8",            # car and bus windows
        "tire": "#23252b",
        "scorch": "#2a2522",
        "sand": "#e2cf9a",
    },
    # Colors meant for the `glow` material (unlit): eyes, weak points, lights.
    "glow": {
        "glow_eye": "#ffe45a",
        "glow_weak": "#7ff4ff",        # weak point: cool against every warm kaiju scheme
        "glow_ember": "#ff5a1a",
        "glow_window": "#ffe9a6",
        "glow_lamp": "#fff2c4",
        "glow_red": "#ff3b30",
        "glow_green": "#4dff7a",
        "glow_amber": "#ffb000",
        "glow_cyan": "#5ff0ff",
        "glow_pink": "#ff7fd0",        # Vespera eyespots
    },
}

# Colors that get no automatic _dk / _lt shades (they are lights, or already extreme).
_NO_SHADES = {"white", "black", "scorch"}


def hex_to_rgb(h: str) -> tuple[float, float, float]:
    """'#rrggbb' or '#rgb' -> sRGB floats 0..1."""
    h = h.strip().lstrip("#")
    if len(h) == 3:
        h = "".join(ch * 2 for ch in h)
    if len(h) != 6:
        raise ValueError(f"bad hex color {h!r}")
    return tuple(int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))  # type: ignore[return-value]


def rgb_to_hex(rgb) -> str:
    return "#%02x%02x%02x" % tuple(max(0, min(255, round(c * 255))) for c in rgb[:3])


def srgb_to_linear(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def linear_to_srgb(c: float) -> float:
    c = max(0.0, min(1.0, c))
    return c * 12.92 if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055


def shade(color, amount: float) -> str:
    """Darken (amount < 1) or lighten (amount > 1) a color, returns hex.

    Darkening lowers brightness and nudges the hue toward cool and the saturation up a
    little, so shadows look painted rather than dirty. Lightening blends toward warm white.
    shade("grass", 0.7) is a good shadow tone; shade("grass", 1.3) a highlight.
    """
    r, g, b = rgb(color)
    if amount <= 1.0:
        h, s, v = colorsys.rgb_to_hsv(r, g, b)
        k = max(0.0, amount)
        if s > 0.05:
            # pull hue a few degrees toward blue-violet (0.72) as it darkens
            dh = ((0.72 - h + 0.5) % 1.0) - 0.5
            h = (h + dh * 0.10 * (1 - k)) % 1.0
        s = min(1.0, s * (1 + 0.25 * (1 - k)))
        return rgb_to_hex(colorsys.hsv_to_rgb(h, s, v * k))
    t = min(1.0, (amount - 1.0))
    warm = (1.0, 0.98, 0.93)
    return rgb_to_hex(tuple(c + (w - c) * t for c, w in zip((r, g, b), warm)))


def mix(a, b, t: float) -> str:
    """Blend two colors in sRGB space; t = 0 gives a, t = 1 gives b. Returns hex."""
    ra, rb = rgb(a), rgb(b)
    return rgb_to_hex(tuple(x + (y - x) * t for x, y in zip(ra, rb)))


PALETTE: dict[str, str] = {}
GROUPS: dict[str, list[str]] = {}
for _group, _colors in _GROUPS.items():
    GROUPS[_group] = []
    for _name, _hex in _colors.items():
        PALETTE[_name] = _hex
        GROUPS[_group].append(_name)


def rgb(color) -> tuple[float, float, float]:
    """Resolve a palette name, a hex string or an (r, g, b) tuple to sRGB floats 0..1."""
    if isinstance(color, str):
        key = color.strip().lower()
        if key.startswith("#"):
            return hex_to_rgb(key)
        if key in PALETTE:
            return hex_to_rgb(PALETTE[key])
        raise KeyError(f"unknown color {color!r}; use a palette name (see tools/art/lib/palette.py), "
                       f"a '#rrggbb' hex string or an (r, g, b) tuple")
    if len(color) >= 3:
        return (float(color[0]), float(color[1]), float(color[2]))
    raise ValueError(f"bad color {color!r}")


def linear(color) -> tuple[float, float, float]:
    """Resolve a color to linear-light floats (what glTF COLOR_0 stores)."""
    return tuple(srgb_to_linear(c) for c in rgb(color))  # type: ignore[return-value]


# automatic shades for every base color
for _group, _names in list(GROUPS.items()):
    if _group == "glow":
        continue
    for _name in list(_names):
        if _name in _NO_SHADES:
            continue
        PALETTE[_name + "_dk"] = shade(_name, 0.68)
        PALETTE[_name + "_lt"] = shade(_name, 1.38)


class C:
    """Palette as constants: C.KAIJU_ORANGE, C.BLD_CREAM_DK, ... (hex strings)."""


for _name, _hex in PALETTE.items():
    setattr(C, _name.upper(), _hex)


def draw_swatches(path: str) -> str:
    """Draw every palette color with its name to a PNG, for review."""
    from PIL import Image, ImageDraw, ImageFont

    font = ImageFont.load_default(size=13)
    head = ImageFont.load_default(size=18)
    cell_w, cell_h, pad = 150, 74, 10
    cols = 7
    rows_total = 0
    layout = []
    for group, names in GROUPS.items():
        n_rows = (len(names) + cols - 1) // cols
        layout.append((group, names, rows_total, n_rows))
        rows_total += n_rows
    height = pad + sum(30 + r * (cell_h + pad) for _, _, _, r in layout) + pad
    img = Image.new("RGB", (pad + cols * (cell_w + pad), height), "#22252d")
    d = ImageDraw.Draw(img)
    y = pad
    for group, names, _, n_rows in layout:
        d.text((pad, y + 4), group.upper(), font=head, fill="#f5f5f0")
        y += 30
        for i, name in enumerate(names):
            cx = pad + (i % cols) * (cell_w + pad)
            cy = y + (i // cols) * (cell_h + pad)
            has_shades = (name + "_dk") in PALETTE
            if has_shades:
                third = cell_w // 4
                d.rectangle([cx, cy, cx + third, cy + 44], fill=PALETTE[name + "_dk"])
                d.rectangle([cx + third, cy, cx + cell_w - third, cy + 44], fill=PALETTE[name])
                d.rectangle([cx + cell_w - third, cy, cx + cell_w, cy + 44], fill=PALETTE[name + "_lt"])
            else:
                d.rectangle([cx, cy, cx + cell_w, cy + 44], fill=PALETTE[name])
            d.text((cx, cy + 46), name, font=font, fill="#f5f5f0")
            d.text((cx, cy + 60), PALETTE[name] + ("   _dk  _lt" if has_shades else ""), font=font,
                   fill="#9aa3ad")
        y += n_rows * (cell_h + pad)
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    img.save(path)
    return path


if __name__ == "__main__":
    _repo = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
    print(draw_swatches(os.path.join(_repo, "docs", "art", "palette.png")))
