"""Soldiers and civilians: 24 x 32 pixel figures, four facings, drawn part by part.

A figure is assembled from layers, back to front: far limbs, legs, torso, head, near arm
and weapon. Heads, torsos and weapons are ASCII pixel art (one character per pixel); limbs
are thick pixel lines between joints, so a pose is just a handful of joint positions.
Side views are authored facing RIGHT and mirrored for the left facing.

The camera is imagined slightly above the figure, as in the game: something that points at
the viewer runs down the picture, something that points away runs up it.

Cell layout: 24 x 32, soles on row 30, outline on row 31, the figure centered on x = 11.5.
"""
from __future__ import annotations

from pix import Img, OUTLINE, col, mix, shade

W, H = 24, 32         # the soles stand on row 30

FACINGS = ("front", "left", "back", "right")     # the row order of every character sheet


# ---- colors ---------------------------------------------------------------------------

def ramp(mid, dark=0.68, light=1.32):
    """(light, mid, dark) from one color."""
    return (shade(mid, light), col(mid), shade(mid, dark))


METAL = (col("#b4bcc8"), col("#737b8a"), col("#3a3e49"))     # light, mid, dark gun metal
WOOD = (col("#b9824a"), col("#8a5a33"))
ROCKET_WHITE = col("#f5f5f0")
ROCKET_GREY = col("#c9ccd4")
FLASH = (col("#ffffff"), col("#fff3a0"), col("#ffd91a"), col("#ff9a1a"))   # core to rim
SMOKE = (col("#f0f0f4"), col("#c2c5cf"))

SKINS = {
    "light": (col("#f8d8b4"), col("#e8b990"), col("#b98762")),
    "tan": (col("#eec08e"), col("#d39b68"), col("#a06c45")),
    "brown": (col("#c98f62"), col("#a36b43"), col("#74472c")),
    "dark": (col("#9a6a48"), col("#77492f"), col("#52301f")),
}


def army_style() -> dict:
    return {
        "hat": (col("#93a24e"), col("#62722f"), col("#3d4a22")),      # helmet: light, mid, dark
        "top": (col("#98a857"), col("#6b7a3a"), col("#465329")),      # jacket (army_olive in the middle)
        "legs": (col("#869648"), col("#5d6c33"), col("#3b4724")),     # trousers, a touch darker
        "skin": SKINS["light"],
        "boots": (col("#5a5e6b"), col("#2a2d35")),
        "web": (col("#cfc18e"), col("#a79a6a"), col("#6c6241")),      # belt, straps, pack (army_khaki)
        "band": (col("#a6f4ff"), col("#1ec8e0")),                     # the cyan armband (human_cyan)
        "eye": col("#2a2230"),
        "hair": (col("#6b4a33"), col("#4a3324"), col("#2f2019")),
    }


def legend(style: dict) -> dict:
    """Characters of the ASCII parts -> colors of this figure."""
    hat, top, legs, skin, web = style["hat"], style["top"], style["legs"], style["skin"], style["web"]
    hair = style["hair"]
    return {
        "G": hat[0], "H": hat[1], "h": hat[2],
        "O": top[0], "o": top[1], "d": top[2],
        "P": legs[0], "p": legs[1], "b": legs[2],
        "S": skin[0], "s": skin[1], "z": skin[2],
        "W": web[0], "w": web[1], "q": web[2],
        "A": hair[0], "a": hair[1], "r": hair[2],
        "K": style["boots"][0], "k": style["boots"][1],
        "C": style["band"][0], "c": style["band"][1],
        "e": style["eye"],
        "M": METAL[0], "m": METAL[1], "n": METAL[2],
        "U": WOOD[0], "u": WOOD[1],
        "X": col(OUTLINE),
        "T": ROCKET_WHITE, "t": ROCKET_GREY,
        "1": FLASH[0], "2": FLASH[1], "3": FLASH[2], "4": FLASH[3],
    }


# ---- ASCII parts: soldier ---------------------------------------------------------------
# Heads are placed with their left column at x = 7 and their top row at y = 5 (+ bob).

HELMET_FRONT = [
    "..GGGGGG..",
    ".GGGHHHHh.",
    "GGHHHHHHhh",
    "GHHHHHHHhh",
    "hhhhhhhhhh",
    ".SeSSSeSz.",
    ".SSSSSSsz.",
    "..zssssz..",
]
HELMET_SIDE = [           # facing right; the brim pokes out one pixel in front
    "..GGGGGG...",
    ".GGGHHHHh..",
    "GGHHHHHHHh.",
    "GHHHHHHHHhh",
    "hhhhhhhhhhh",
    ".hhsSSSeS..",
    "..zsSSSSSs.",
    "...zsSSs...",
]
HELMET_BACK = [
    "..GGGGGG..",
    ".GGGHHHHh.",
    "GGHHHHHHhh",
    "GHHHHHHHhh",
    "GHHHHHHHhh",
    "hHHHHHHhhh",
    ".hhhhhhhh.",
    "..zssssz..",
]

# Torsos: left column at x = 7, top row at y = 13 (+ bob).
TORSO_FRONT = [
    ".oOOOOOOd.",
    "oOOOOOOOod",
    "oOOwOOwOod",
    "oOOwOOwood",
    ".OOwOOwod.",
    ".qwwWwwwq.",
    ".oOOOoood.",
    ".oOOooodd.",
]
TORSO_BACK = [
    ".oOOOOOOd.",
    "oOqwwwwqod",
    "oOwWWWwqod",
    "oOwWwwwqod",
    ".OwwwwwqD.".replace("D", "d"),
    ".qqwwwwqq.",
    ".oOOOoood.",
    ".oOOooodd.",
]
TORSO_SIDE = [            # facing right, the pack on the back; left column at x = 6
    "...oOOOo.",
    ".wwOOOOod",
    "wWwOOOOod",
    "wWwOOOood",
    "wwwOOOood",
    ".qqwwwwq.",
    "..oOOood.",
    "..oOoood.",
]


# ---- limbs --------------------------------------------------------------------------------

def boot_front(img: Img, x: int, y: int, lg: dict, big: bool = True) -> None:
    """Front or back view boot under a 3-wide leg whose left column is x; y is its top row."""
    if big:
        img.art(["kkk", "kkK", "kkk"], x, y, lg)
    else:
        img.art(["kkk", "kkk"], x, y, lg)


# Side-view legs, facing right, one leg per drawing: (rows, column of the hip's left pixel).
# P p = thigh (light, mid), I i = shin, k K = boot. The same drawing serves as the near leg
# (lit) and as the far leg (dark); a frame is two of them laid over each other at the hip.
LEG_STAND = (["PPp.", "PPp.", "PPp.", "PPp.", "IIi.", "IIi.", "IIi.", "kkk.", "kkkK", "kkkk"], 0)
LEG_FWD = ([              # walk, contact: the heel strikes in front
    "PPp.....",
    ".PPp....",
    ".PPp....",
    "..IIi...",
    "..IIi...",
    "...IIi..",
    "...kkk.K",
    "...kkkkk",
    "...kkkk.",
], 0)
LEG_BACK = ([             # walk, contact: the rear foot pushes off, heel up
    ".....PPp",
    "....PPp.",
    "...PPp..",
    "...IIi..",
    "..IIi...",
    ".kkIi...",
    ".kkk....",
    "..kkk...",
    "..kkK...",
], 5)
LEG_SWING = ([            # walk, passing: knee forward, foot off the ground
    "PPp....",
    "PPPp...",
    ".PPPp..",
    "..PPPp.",
    "...IIi.",
    "..IIi..",
    ".kkIi..",
    ".kkkK..",
], 0)
RUN_LAND = ([             # run, contact: the front leg lands bent
    "PPp......",
    ".PPPp....",
    "..PPPp...",
    "...PPPp..",
    "....IIi..",
    "....IIi..",
    ".....kkk.",
    ".....kkkK",
    ".....kkkk",
], 0)
RUN_KICK = ([             # run, contact: the rear leg kicked up behind
    "......PPp",
    "....PPPp.",
    "...PPPp..",
    "..IIPp...",
    ".kIIi....",
    "kkki.....",
    "kk.......",
], 6)
RUN_KNEE = ([             # run, flight: knee driven forward
    "PPp.....",
    "PPPp....",
    ".PPPPp..",
    "...PPPp.",
    "...IIi..",
    "..IIi...",
    "..kkk...",
    "..kkkK..",
], 0)
RUN_PUSH = ([             # run, flight: the rear leg stretched back
    ".....PPp",
    "....PPp.",
    "...PPp..",
    "..PPp...",
    ".IIi....",
    "IIi.....",
    "kkk.....",
    "kkK.....",
], 5)


def leg_side(img: Img, leg, hip_x: int, hip_y: int, style: dict, near: bool = True,
             bare_from: str | None = None) -> None:
    """Stamp one side-view leg drawing with its hip's left pixel at (hip_x, hip_y).
    The near leg is the mid tone with a lit leading pixel in every row; the far leg is all
    dark. bare_from: 'knee' = shorts (skin shins), 'hip' = bare legs (under a skirt)."""
    rows, ox = leg
    cloth, skin, boots = style["legs"], style["skin"], style["boots"]
    far_skin = mix(skin[1], skin[2], 0.55)
    for j, row in enumerate(rows):
        first = True
        for i, ch in enumerate(row):
            if ch == ".":
                continue
            x, y = hip_x - ox + i, hip_y + j
            if ch in "kK":
                img.px(x, y, boots[0] if (ch == "K" and near) else boots[1])
                continue
            bare = bare_from == "hip" or (bare_from == "knee" and ch in "Ii")
            if not near:
                c = far_skin if bare else cloth[2]
            elif bare:
                c = skin[0] if first else skin[1]
            else:
                c = cloth[0] if first else cloth[1]
            img.px(x, y, c)
            first = False


def arm(img: Img, shoulder, elbow, hand, sleeve, skin, width: int = 2, bare: bool = False,
        hand_px: bool = True) -> None:
    """Upper arm and forearm as thick pixel lines, then a 2 x 2 hand. bare: the forearm
    is skin (short sleeves)."""
    img.limb(shoulder[0], shoulder[1], elbow[0], elbow[1], width, sleeve)
    img.limb(elbow[0], elbow[1], hand[0], hand[1], width, skin if bare else sleeve)
    if hand_px:
        hx, hy = int(round(hand[0])), int(round(hand[1]))
        img.rect(hx - (width - 1) // 2, hy - (width - 1) // 2, hx + width // 2, hy + width // 2, skin)


def band(img: Img, x: int, y: int, style: dict, w: int = 2) -> None:
    """The cyan armband: two rows on the upper arm."""
    img.rect(x, y, x + w - 1, y + 1, style["band"][1])
    img.px(x, y, style["band"][0])


# ---- weapons ------------------------------------------------------------------------------

TUBE_SIDE = [
    "nMMMMMMMMMMMMM....",
    "nmmmmmnmmmmmmmcTTT",
    "nnnnnnnnnnnnnnctt.",
]


def tube_side(img: Img, x0: int, y: int, lg: dict, tail_down: bool = False) -> None:
    """The launcher seen from the side, pointing right. x0 is the rear end, y the top row of
    the three-pixel tube. A loaded rocket (white nose, cyan band) sticks out in front.
    tail_down: the rear third hangs one pixel lower (carried, not aimed)."""
    for j, row in enumerate(TUBE_SIDE):
        for i, ch in enumerate(row):
            if ch == ".":
                continue
            img.px(x0 + i, y + j + (1 if tail_down and i < 6 else 0), lg[ch])
    d = 1 if tail_down else 0
    img.px(x0 - 1, y + d, lg["n"]).px(x0 - 1, y + 2 + d, lg["n"])      # flared rear end


def tube_front(img: Img, x: int, y: int, lg: dict) -> None:
    """The launcher pointing at the viewer: it runs down the picture, rocket nose lowest.
    (x, y) is the top left of the four-pixel-wide tube."""
    img.art([
        ".nn.",
        "nmMn",
        "nmMn",
        "nmMn",
        "nmMn",
        "nmMn",
        "nmMn",
        "cCCc",
        "TTTt",
        "TTTt",
        ".Tt.",
    ], x, y, lg)


def tube_back(img: Img, x: int, y: int, lg: dict) -> None:
    """The launcher pointing away from the viewer: it runs up the picture, rocket nose on top."""
    img.art([
        ".Tt.",
        "TTTt",
        "cCCc",
        "mMMn",
        "mMmn",
        "mMmn",
        "mMmn",
        "mMmn",
        "mMmn",
        "nnnn",
        "n..n",
    ], x, y, lg)


RIFLE_SIDE = [             # pointing right, 12 long
    "....MMMMMMMM",
    "UUmmmmmnnnn.",
    "Uu..n.......",
]
RIFLE_DIAG = [             # held across the chest, muzzle up at the right
    ".........mM",
    "........mn.",
    ".......mn..",
    "......Mm...",
    ".....Mmn...",
    "....Mm.....",
    "...Uu......",
    "..Uu.......",
    ".Uu........",
]


def flash(img: Img, cx: int, cy: int, size: int = 2) -> None:
    """A small star-shaped muzzle flash centered on (cx, cy)."""
    c0, c1, c2, c3 = FLASH
    for d in range(1, size + 2):
        for dx, dy in ((d, 0), (-d, 0), (0, d), (0, -d)):
            img.px(cx + dx, cy + dy, c2 if d <= size else c3)
    for dx, dy in ((1, 1), (-1, 1), (1, -1), (-1, -1)):
        img.px(cx + dx, cy + dy, c2)
        if size >= 2:
            img.px(cx + 2 * dx, cy + 2 * dy, c3)
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        img.px(cx + dx, cy + dy, c1)
    img.px(cx, cy, c0)


def puff(img: Img, cx: float, cy: float, r: float = 2) -> None:
    """A tiny smoke puff."""
    img.disc(cx, cy, r, SMOKE[1])
    img.disc(cx - 0.5, cy - 0.5, max(0.6, r - 1), SMOKE[0])


# ---- the soldier --------------------------------------------------------------------------

def _legs_front(body: Img, lift, style: dict, lg: dict, bare_from=None, shoes_big=True) -> None:
    """Front or back view legs: columns 8..10 and 13..15. lift = pixels each foot is raised."""
    legs_c, skin = style["legs"], style["skin"]
    for i, x in enumerate((8, 13)):
        up = lift[i]
        bottom = 27 - up
        ramp_ = legs_c
        body.rect(x, 21, x + 2, bottom, ramp_[1])
        body.vline(x, 21, bottom, ramp_[0] if i == 0 else ramp_[1])
        body.vline(x + 2, 21, bottom, ramp_[2])
        if bare_from is not None:
            y0 = 22 if bare_from == "hip" else 25
            if y0 <= bottom:
                body.rect(x, y0, x + 2, bottom, skin[1])
                body.vline(x + 2, y0, bottom, skin[2])
                body.vline(x, y0, bottom, skin[0] if i == 0 else skin[1])
        if up >= 2:
            boot_front(body, x, 28 - up, lg, big=False)
        else:
            boot_front(body, x, 28 - up, lg, big=True)
            if up == 0 and shoes_big:
                body.px(x + (-1 if i == 0 else 3), 30, lg["k"])      # toes turned out
                body.px(x + (-1 if i == 0 else 3), 29, lg["k"])


def soldier(kind: str, facing: str, pose: str) -> Img:
    """One soldier frame. kind: 'rocket' | 'rifle'. facing: front | left | back | right.
    pose: idle, walk0..walk3, fire0, fire1."""
    if facing == "left":
        return soldier(kind, "right", pose).flipped()
    style = army_style()
    lg = legend(style)
    body = Img(W, H)           # everything that gets the dark silhouette outline
    glow = Img(W, H)           # flashes and smoke: drawn on top, no outline
    step = int(pose[4]) if pose.startswith("walk") else -1
    firing = pose.startswith("fire")
    recoil = pose == "fire1"
    bob = 1 if step in (0, 2) else 0
    legs_c = style["legs"]

    if facing in ("front", "back"):
        lift = {0: (0, 2), 1: (0, 1), 2: (2, 0), 3: (1, 0)}.get(step, (0, 0))
        if facing == "back":
            lift = (lift[1], lift[0])
        _legs_front(body, lift, style, lg)
        body.rect(8, 21, 15, 22, legs_c[1])                 # hips
        body.hline(8, 15, 21, legs_c[2])
        body.art(TORSO_FRONT if facing == "front" else TORSO_BACK, 7, 13 + bob, lg)
        body.art(HELMET_FRONT if facing == "front" else HELMET_BACK, 7, 5 + bob, lg)
        sy = 14 + bob           # shoulder row
        if kind == "rifle":
            _rifle_front_back(body, glow, facing, firing, recoil, sy, style, lg)
        else:
            _rocket_front_back(body, glow, facing, firing, recoil, sy, style, lg)
    else:
        # --- side view, facing right
        hy = 21 + bob                               # hip row
        if step in (0, 2):
            far, near = (LEG_BACK, LEG_FWD) if step == 0 else (LEG_FWD, LEG_BACK)
        elif step in (1, 3):
            far, near = (LEG_SWING, LEG_STAND) if step == 1 else (LEG_STAND, LEG_SWING)
        else:
            far, near = None, None
        if far is None:
            leg_side(body, LEG_STAND, 11, hy, style, near=False)
            leg_side(body, LEG_STAND, 9, hy, style, near=True)
        else:
            leg_side(body, far, 11 if step == 1 else 10, hy, style, near=False)
            leg_side(body, near, 10, hy, style, near=True)
        lean = -1 if recoil else 0
        body.art(TORSO_SIDE, 6 + lean, 13 + bob, lg)
        body.art(HELMET_SIDE, 7 + lean, 5 + bob, lg)
        sy = 14 + bob
        if kind == "rifle":
            _rifle_side(body, glow, firing, recoil, sy, lean, style, lg)
        else:
            _rocket_side(body, glow, firing, recoil, sy, lean, style, lg)

    body.outline(OUTLINE)
    body.blit(glow)
    return body


def _rifle_front_back(body, glow, facing, firing, recoil, sy, style, lg) -> None:
    top, skin = style["top"], style["skin"]
    arms = Img(W, H)
    gun = Img(W, H)
    if facing == "front":
        if not firing:
            # port arms: the rifle crosses the chest, muzzle up at the viewer's right
            gun.art(RIFLE_DIAG, 6, sy - 3, lg)
            arm(arms, (6.5, sy), (6, sy + 4), (9, sy + 4.5), top[1], skin[1])
            arm(arms, (16.5, sy), (17, sy + 3), (14, sy + 1.5), top[2], skin[1])
        else:
            # aiming at the viewer: the rifle is a short dark shape below the chin
            arm(arms, (6.5, sy), (7, sy + 3), (10, sy + 2), top[1], skin[1])
            arm(arms, (16.5, sy), (16, sy + 3), (13, sy + 2), top[2], skin[1])
            gun.rect(11, sy, 12, sy + 2, lg["m"])
            gun.vline(11, sy, sy + 2, lg["M"])
            gun.rect(10, sy + 3, 13, sy + 4, lg["m"])
            gun.hline(10, 13, sy + 3, lg["M"])
            gun.px(11, sy + 4, lg["n"]).px(12, sy + 4, lg["n"])
            if not recoil:
                flash(glow, 11, sy + 5, 2)
                glow.px(12, sy + 5, FLASH[0])
            else:
                puff(glow, 11.5, sy + 6, 1.2)
        band(arms, 6, sy + 1, style)
        band(arms, 16, sy + 1, style)
        body.stamp(arms, sep=top[2])
        body.stamp(gun, sep=lg["n"])
    else:
        if not firing:
            # from behind only the muzzle shows over the right shoulder
            arm(arms, (6.5, sy), (6, sy + 4), (8, sy + 5), top[1], skin[1], hand_px=False)
            arm(arms, (16.5, sy), (17, sy + 4), (15, sy + 5), top[2], skin[1], hand_px=False)
            gun.limb(16, sy - 1, 18, sy - 6, 2, lg["m"], lg["M"])
        else:
            r = 1 if recoil else 0
            arm(arms, (6.5, sy), (6, sy + 3), (8, sy + 2), top[1], skin[1], hand_px=False)
            arm(arms, (16.5, sy), (17, sy + 3), (15, sy + 2), top[2], skin[1], hand_px=False)
            gun.limb(16, sy - 1 + r, 16, sy - 7 + r, 2, lg["m"], lg["M"])
            if not recoil:
                flash(glow, 16, sy - 9, 2)
        band(arms, 6, sy + 1, style)
        band(arms, 16, sy + 1, style)
        back = Img(W, H)
        back.blit(gun)
        back.blit(body)                     # the gun is beyond the body
        body.a[:] = back.a
        body.stamp(arms, sep=top[2])


def _rifle_side(body, glow, firing, recoil, sy, lean, style, lg) -> None:
    top, skin = style["top"], style["skin"]
    arms = Img(W, H)
    gun = Img(W, H)
    far = Img(W, H)
    x = lean
    if not firing:
        # at the ready: held level at the waist, muzzle forward
        gun.art(RIFLE_SIDE, 10, sy + 2, lg)
        arm(arms, (10.5, sy), (10, sy + 3), (13, sy + 3.5), top[1], skin[1])
        arm(far, (12, sy), (15, sy + 2), (18, sy + 3), top[2], skin[2])
    else:
        gun.art(RIFLE_SIDE, 10 + x, sy - 1, lg)
        arm(arms, (10.5 + x, sy), (11 + x, sy + 3), (14 + x, sy + 1), top[1], skin[1])
        arm(far, (12 + x, sy), (15 + x, sy + 2), (18 + x, sy + 1), top[2], skin[2])
        if not recoil:
            flash(glow, 22, sy, 1)
            glow.px(21, sy, FLASH[0])
        else:
            puff(glow, 22.5, sy - 0.5, 1.2)
    band(arms, 10 + x, sy + 1, style)
    body.stamp(far, sep=top[2])
    body.stamp(gun, sep=lg["n"])
    body.stamp(arms, sep=top[2])


def _rocket_front_back(body, glow, facing, firing, recoil, sy, style, lg) -> None:
    top, skin = style["top"], style["skin"]
    arms = Img(W, H)
    gun = Img(W, H)
    r = 1 if recoil else 0
    if facing == "front":
        # tube on the soldier's right shoulder = the viewer's left
        arm(arms, (16.5, sy), (17, sy + 3), (16.5, sy + 6), top[2], skin[1])
        band(arms, 16, sy + 1, style)
        body.stamp(arms, sep=top[2])
        tube_front(gun, 3, sy - 6 - r, lg)
        body.stamp(gun, sep=lg["n"])
        grip = Img(W, H)
        arm(grip, (7.5, sy), (8.5, sy + 3), (6.5, sy + 2), top[1], skin[1])
        band(grip, 7, sy, style, 2)
        body.stamp(grip, sep=top[2])
        if firing and not recoil:
            flash(glow, 4, sy + 5, 2)
            glow.px(5, sy + 5, FLASH[0])
        elif recoil:
            puff(glow, 4.5, sy + 6, 2)
    else:
        arm(arms, (6.5, sy), (6, sy + 3), (6.5, sy + 6), top[1], skin[1])
        band(arms, 6, sy + 1, style)
        body.stamp(arms, sep=top[2])
        tube_back(gun, 16, sy - 9 + r, lg)
        body.stamp(gun, sep=lg["n"])
        grip = Img(W, H)
        arm(grip, (15.5, sy), (14.5, sy + 3), (16.5, sy + 2), top[2], skin[1])
        band(grip, 15, sy, style, 2)
        body.stamp(grip, sep=top[2])
        if firing and not recoil:
            flash(glow, 17, sy - 10, 2)
            glow.px(18, sy - 10, FLASH[0])
            puff(glow, 17.5, sy + 4, 1.2)
        elif recoil:
            puff(glow, 17.5, sy - 10, 2)
            puff(glow, 17.5, sy + 5, 2)


def _rocket_side(body, glow, firing, recoil, sy, lean, style, lg) -> None:
    top, skin = style["top"], style["skin"]
    gun = Img(W, H)
    arms = Img(W, H)
    x = lean
    ty = sy - 1                                 # tube rows: on the shoulder, under the chin
    tube_side(gun, 3 + x, ty, lg)
    body.blit(gun)
    # near arm reaches up to the grip under the tube
    arm(arms, (10.5 + x, sy + 3), (12 + x, sy + 5), (14 + x, sy + 3), top[1], skin[1])
    band(arms, 10 + x, sy + 3, style)
    body.stamp(arms, sep=top[2])
    if firing and not recoil:
        flash(glow, 22, ty + 1, 1)
        glow.px(21, ty + 1, FLASH[0])
        flash(glow, 1, ty + 1, 1)                       # back blast
    elif recoil:
        puff(glow, 21.5, ty + 0.5, 2)
        puff(glow, 1.5, ty + 1.5, 2)


# ---- dying (side view, falls backward; no gore) ---------------------------------------------

FALLING = [
    "...GGG.....sS...........",
    "..GHHHh....so...........",
    ".GHHHHhs...oo...........",
    ".GHHhhSSs.oo............",
    "..hhzSSsoOO.............",
    "....zssOOOOo............",
    ".....wwOOOOOo...........",
    ".....wWwOOOOod..........",
    "......wwwOOoodd.........",
    ".......qqwwwwqp.........",
    "........bpPPppPp........",
    ".........bppPppPp.......",
    "..........bpp.bpPp......",
    "...........bpp.bpPp.....",
    "............bpp.bppp....",
    ".............kkk.bpp....",
    ".............kkkK.kkk...",
    "..............kkk.kkkK..",
]
DOWN = [                   # on the back, head at the left, knees still up (22 wide, at x = 1)
    "................pp....",
    "...............pPPp...",
    "..hGGh........pPPppp..",
    ".hGHHHh..oOOo.pPPp.bpp",
    "hGHHHHhSsOOOOOoPPp.bpp",
    "hHHHHhhSSOOOOOOwPp.bpk",
    "hHHHhhzSsoOOOOowwp.kkK",
    ".hhhhzzzoodddoodqq.kkk",
]
FLAT = [                   # flat out; the helmet has rolled off to the left (22 wide, at x = 1)
    ".........oOOOo........",
    ".GG..AaSsOOOOOo....kk.",
    "GHHh.AaSSOOOOOOwwPPkkK",
    "GHHh.aSsoOOOOOowwppkkk",
    "hhh..rzzoodddoodqqbkkk",
]


def soldier_die(kind: str, frame: int) -> Img:
    """Four frames: hit and reeling, falling, down, flat with the helmet rolled off."""
    style = army_style()
    lg = legend(style)
    body = Img(W, H)
    top, legs_c, skin = style["top"], style["legs"], style["skin"]
    if frame == 0:
        # knocked back: the body leans away, arms fly up, the weapon leaves the hands
        leg_side(body, LEG_SWING, 9, 21, style, near=False)
        leg_side(body, LEG_STAND, 8, 21, style, near=True)
        body.art(TORSO_SIDE, 4, 13, lg)
        body.art(HELMET_SIDE, 4, 5, lg)
        far = Img(W, H)
        arm(far, (10, 15), (13, 13), (16, 11), top[2], skin[2])
        body.stamp(far, sep=top[2])
        near = Img(W, H)
        arm(near, (8.5, 14), (11, 11), (12.5, 7), top[1], skin[1])
        band(near, 9, 13, style)
        body.stamp(near, sep=top[2])
        gun = Img(W, H)
        if kind == "rocket":
            gun.limb(14, 21, 20, 15, 3, lg["m"], lg["M"])
            gun.limb(14, 22, 20, 16, 1, lg["n"])
            gun.px(21, 14, lg["c"]).px(21, 15, lg["c"]).px(22, 13, lg["T"]).px(22, 14, lg["T"])
        else:
            gun.limb(16, 21, 21, 16, 2, lg["m"], lg["M"])
            gun.limb(14, 22, 16, 21, 2, lg["u"], lg["U"])
        body.blit(gun)
    elif frame == 1:
        body.art(FALLING, 0, 13, lg)
        gun = Img(W, H)
        if kind == "rocket":
            gun.art(TUBE_SIDE, 5, 27, lg)
        else:
            gun.art(RIFLE_SIDE, 1, 27, lg)
        back = Img(W, H)
        back.blit(gun).blit(body)
        body = back
    else:
        if frame == 2:
            body.art(DOWN, 1, 23, lg)
        else:
            body.art(FLAT, 1, 26, lg)
    body.outline(OUTLINE)
    return body


SOLDIER_POSES = ["idle", "walk0", "walk1", "walk2", "walk3", "fire0", "fire1"]


def soldier_frames(kind: str) -> dict:
    """{'grid': rows of 7 frames per facing (idle, walk x 4, fire x 2), 'die': 4 frames}."""
    grid = [[soldier(kind, facing, pose) for pose in SOLDIER_POSES] for facing in FACINGS]
    die = [soldier_die(kind, f) for f in range(4)]
    return {"grid": grid, "die": die}


# =============================================================================================
# Civilians: six people in bright clothes, running with their arms in the air.
# =============================================================================================
# Heads: left column at x = 8, top row at y = 6 (+ bob); 8 wide unless noted.

HAIR_SHORT = {
    "front": [
        ".AAAAAA.",
        "AAaaaaar",
        "AaSSSSar",
        "aSeSSeSr",
        ".SSSSSSz",
        ".zSSSSz.",
        "..zssz..",
    ],
    "side": [
        ".AAAAAA..",
        "AAaaaaaA.",
        "aaaaaSSS.",
        "raaSSSeS.",
        "rrzSSSSSs",
        ".rzSSSSs.",
        "..zzsss..",
    ],
    "back": [
        ".AAAAAA.",
        "AAaaaaar",
        "Aaaaaaar",
        "aaaaaarr",
        ".aaaarr.",
        ".zarrrz.",
        "..zssz..",
    ],
}
HAIR_LONG = {             # long hair down to the shoulders; 10 wide, left column at x = 7
    "front": [
        "..AAAAAA..",
        ".AAaaaaar.",
        ".AaSSSSar.",
        "AaSeSSeSar",
        "Aa.SSSSzar",
        "Aa.zSSz.ar",
        "aa..zs..ar",
        "ar......rr",
    ],
    "side": [
        "..AAAAAA..",
        ".AAaaaaaA.",
        "AaaaaaSSS.",
        "AaaaSSSeS.",
        "aaarzSSSSs",
        "aaarzSSSs.",
        "aarr.zss..",
        "arr.......",
        "rr........",
    ],
    "back": [
        "..AAAAAA..",
        ".AAaaaaar.",
        ".Aaaaaaar.",
        "AAaaaaaarr",
        "Aaaaaaaarr",
        "Aaaaaaarrr",
        "aaaaaaarrr",
        ".aaaarrrr.",
        "..aa.rrr..",
    ],
}
HAIR_BALD = {             # a bald man with side hair and glasses
    "front": [
        "..SSSS..",
        ".SSSSSz.",
        "aSSSSSza",
        "aeeSSeea",
        ".SSSSSSz",
        ".zSAASz.",
        "..zssz..",
    ],
    "side": [
        "..SSSSS..",
        ".SSSSSSz.",
        "aaSSSSSS.",
        "raaSSeeS.",
        "rrzSSSSSs",
        ".rzSSAAs.",
        "..zzsss..",
    ],
    "back": [
        "..SSSS..",
        ".SSSSSz.",
        "aSSSSSza",
        "aaSSSzar",
        ".aaaarr.",
        ".zssssz.",
        "..zssz..",
    ],
}
HAIR_CAP = {              # a baseball cap, brim forward; colors from the hat ramp
    "front": [
        ".GGGGGG.",
        "GGHHHHHh",
        "GHHHHHHh",
        "hhhhhhhh",
        ".SeSSeSz",
        ".zSSSSz.",
        "..zssz..",
    ],
    "side": [
        ".GGGGGG...",
        "GGHHHHHh..",
        "GHHHHHHhhh",
        "raaSSSeS..",
        "rrzSSSSSs.",
        ".rzSSSSs..",
        "..zzsss...",
    ],
    "back": [
        ".GGGGGG.",
        "GGHHHHHh",
        "GHHHHHHh",
        "hHHhhHhh",
        ".aaaarr.",
        ".zarrrz.",
        "..zssz..",
    ],
}
HAIR_PONY = {             # hair tied back in a ponytail
    "front": [
        ".AAAAAA.",
        "AAaaaaar",
        "AaaSSaar",
        "aSeSSeSr",
        ".SSSSSSz",
        ".zSSSSz.",
        "..zssz..",
    ],
    "side": [              # 11 wide, left column at x = 6: the tail swings behind
        "...AAAAAA..",
        "..AAaaaaaA.",
        ".AaaaaaSSS.",
        "AArraSSSeS.",
        "Aa.rzSSSSSs",
        "aa..zSSSSs.",
        ".ar..zsss..",
        ".rr........",
    ],
    "back": [
        ".AAAAAA.",
        "AAaaaaar",
        "AaaAAaar",
        "aaaAaarr",
        ".aaAarr.",
        ".zaAarz.",
        "..zAaz..",
        "...Aa...",
        "...ar...",
    ],
}
HAIR_HAT = {              # a wide straw sun hat; 12 wide, left column at x = 6
    "front": [
        "...GGGGGG...",
        "..GGHHHHHh..",
        "..ccccccCc..".replace("c", "q").replace("C", "w"),
        "GGGHHHHHHHhh",
        ".hhhhhhhhhh.",
        "...SeSSeSz..",
        "...zSSSSz...",
        "....zssz....",
    ],
    "side": [
        "...GGGGGG...",
        "..GGHHHHHh..",
        "..qqqqqqwq..",
        "GGGHHHHHHHhh",
        ".hhhhhhhhhh.",
        "...aSSSeS...",
        "...zSSSSSs..",
        "....zSSs....",
    ],
    "back": [
        "...GGGGGG...",
        "..GGHHHHHh..",
        "..qqqqqqwq..",
        "GGGHHHHHHHhh",
        ".hhhhhhhhhh.",
        "...aaaarr...",
        "...zarrrz...",
        "....zssz....",
    ],
}
HEADS = {
    #            art        x offsets (front, side, back)  rows above the face line
    "short": (HAIR_SHORT, (8, 7, 8)),
    "long": (HAIR_LONG, (7, 6, 7)),
    "bald": (HAIR_BALD, (8, 7, 8)),
    "cap": (HAIR_CAP, (8, 7, 8)),
    "pony": (HAIR_PONY, (8, 5, 8)),
    "hat": (HAIR_HAT, (6, 5, 6)),
}

SHIRT_FRONT = [            # left column at x = 8, top row at y = 13 (+ bob)
    ".OOOOOO.",
    "OOOOOOod",
    "OOOOOOod",
    "OOOOOood",
    ".OOOOod.",
    ".OOOood.",
]
SHIRT_SIDE = [             # left column at x = 8
    ".OOOOo.",
    "OOOOOod",
    "OOOOOod",
    "OOOOood",
    ".OOOod.",
    ".OOood.",
]
HIPS_FRONT = [             # rows 19, 20
    ".PppppB.".replace("B", "b"),
    ".PppppB.".replace("B", "b"),
]
HIPS_SIDE = [
    ".Ppppb.",
    ".Ppppb.",
]
SKIRT_FRONT = [            # a dress flares from the waist: rows 19..24, left column at x = 7
    "..OOOOod..",
    ".OOOOOood.",
    ".OOOOOood.",
    "OOOOOOoodd",
    "OOOOOOoodd",
    "OoOOoOoodd",
]
SKIRT_SIDE = [             # left column at x = 7
    "..OOOod..",
    ".OOOOood.",
    ".OOOOood.",
    "OOOOOoodd",
    "OOOOOoodd",
    "OoOOooddd",
]


def civilian_styles() -> list:
    """The six civilians. Bright clothes, none of them cyan or kaiju orange."""
    white = (col("#ffffff"), col("#eef0f4"), col("#b9bcc6"))
    return [
        {   # 1: red T-shirt, blue jeans, short brown hair
            "name": "red shirt", "head": "short", "skin": SKINS["light"],
            "hair": (col("#8a5a3a"), col("#5e3b26"), col("#3b2418")),
            "top": ramp("#e0372f"), "legs": ramp("#3b5fc0"), "boots": (col("#ffffff"), col("#d7dbe4")),
            "bare_arms": True, "bottom": "pants",
        },
        {   # 2: yellow dress, long black hair
            "name": "yellow dress", "head": "long", "skin": SKINS["brown"],
            "hair": (col("#4a4458"), col("#2c2836"), col("#1b1924")),
            "top": ramp("#ffd23a", 0.72, 1.25), "legs": ramp("#ffd23a", 0.72, 1.25),
            "boots": (col("#f0564a"), col("#c2332c")),
            "bare_arms": True, "bottom": "skirt",
        },
        {   # 3: office worker: white shirt, magenta tie, navy trousers, bald with glasses
            "name": "office", "head": "bald", "skin": SKINS["tan"],
            "hair": (col("#d9d9de"), col("#a9abb5"), col("#7d7f8c")),
            "top": white, "legs": ramp("#34407a"), "boots": (col("#4a4d57"), col("#23252b")),
            "bare_arms": False, "bottom": "pants", "tie": col("#d62f8a"),
        },
        {   # 4: purple hoodie, khaki shorts, white cap
            "name": "purple hoodie", "head": "cap", "skin": SKINS["dark"],
            "hair": (col("#3a3440"), col("#2a2530"), col("#1b1820")),
            "hat": white,
            "top": ramp("#8f5fd6"), "legs": ramp("#c9b27a"), "boots": (col("#ffffff"), col("#d7dbe4")),
            "bare_arms": False, "bottom": "shorts",
        },
        {   # 5: pink top, white skirt, blonde ponytail
            "name": "pink top", "head": "pony", "skin": SKINS["light"],
            "hair": (col("#ffe07a"), col("#e6b23c"), col("#b07f22")),
            "top": ramp("#ff5fa2"), "legs": white, "boots": (col("#8f5fd6"), col("#6a40ad")),
            "bare_arms": True, "bottom": "skirt2",
        },
        {   # 6: tourist: blue shirt, straw hat, green shorts
            "name": "tourist", "head": "hat", "skin": SKINS["tan"],
            "hair": (col("#6b4a33"), col("#4a3324"), col("#2f2019")),
            "hat": (col("#f7e3a1"), col("#e2c56e"), col("#b3954a")),
            "top": ramp("#2f62c9", 0.7, 1.3), "legs": ramp("#4fbf5f", 0.7, 1.2),
            "boots": (col("#a8743f"), col("#7a5236")),
            "bare_arms": True, "bottom": "shorts",
        },
    ]


def _civ_style(s: dict) -> dict:
    out = dict(s)
    out.setdefault("hat", s["hair"])
    out.setdefault("web", (col("#e8c56a"), col("#c9a24a"), col("#96742f")))
    out.setdefault("band", (col("#ffffff"), col("#ffffff")))
    out.setdefault("eye", col("#2a2230"))
    return out


def civilian(variant: int, facing: str, frame: int) -> Img:
    """One frame of the panic run: variant 0..5, facing front | left | back | right, frame 0..3."""
    if facing == "left":
        return civilian(variant, "right", frame).flipped()
    style = _civ_style(civilian_styles()[variant])
    lg = legend(style)
    body = Img(W, H)
    top, legs_c, skin = style["top"], style["legs"], style["skin"]
    bottom = style["bottom"]
    skirt = bottom in ("skirt", "skirt2")
    bare_from = {"pants": None, "shorts": "knee", "skirt": "hip", "skirt2": "hip"}[bottom]
    bare = style["bare_arms"]
    art, offs = HEADS[style["head"]]
    air = frame in (1, 3)                    # both feet off the ground
    bob = -1 if air else 1
    hy = 6 + bob                             # top row of the head

    if facing in ("front", "back"):
        lift = {0: (0, 4), 1: (1, 2), 2: (4, 0), 3: (2, 1)}[frame]
        if facing == "back":
            lift = (lift[1], lift[0])
        _legs_front(body, lift, style, lg, bare_from=bare_from, shoes_big=False)
        if skirt:
            sk = SKIRT_FRONT if bottom == "skirt" else SKIRT_FRONT[:4]
            body.art(sk, 7, 19 + bob, lg if bottom == "skirt" else {**lg, "O": legs_c[0], "o": legs_c[1], "d": legs_c[2]})
        else:
            body.art(HIPS_FRONT, 8, 19 + bob, lg)
            body.rect(9, 21 + bob, 14, 21 + max(bob, 0), legs_c[1])
        body.art(SHIRT_FRONT, 8, 13 + bob, lg)
        if style.get("tie") and facing == "front":
            body.vline(11, 14 + bob, 17 + bob, style["tie"])
            body.px(12, 14 + bob, style["tie"])
        if facing == "front" and bare:
            body.hline(10, 13, 13 + bob, skin[1])                # neckline
        # arms up, waving: each frame tilts the pair a little
        wave = [(-1, 0, 1, 2), (0, 0, 0, 0), (1, 2, -1, 0), (0, 1, 0, 1)][frame]
        sy = 14 + bob
        arms = Img(W, H)
        arm(arms, (8, sy), (5.5, sy - 3 + wave[1]), (5 + wave[0], sy - 8 + wave[1]), top[1], skin[1], bare=bare)
        arm(arms, (15, sy), (17.5, sy - 3 + wave[3]), (18 + wave[2], sy - 8 + wave[3]), top[2], skin[1], bare=bare)
        body.blit(arms)
        key = "front" if facing == "front" else "back"
        body.art(art[key], offs[0 if facing == "front" else 2], hy, lg)
    else:
        lean = 1
        hip_y = 21 + bob
        # run: contact frames with a long stride, flight frames with both feet in the air
        far, near = [(RUN_KICK, RUN_LAND), (RUN_KNEE, RUN_PUSH), (RUN_LAND, RUN_KICK), (RUN_PUSH, RUN_KNEE)][frame]
        leg_side(body, far, 10, hip_y, style, near=False, bare_from=bare_from)
        leg_side(body, near, 10, hip_y, style, near=True, bare_from=bare_from)
        sy = 14 + bob
        wave = [(0, 0), (1, -1), (0, 1), (-1, 0)][frame]
        # both arms are thrown up like goalposts, one behind the back and one in front of
        # the face, so the head stays clear between them
        far_skin = mix(skin[1], skin[2], 0.55)
        arms = Img(W, H)
        arm(arms, (14 + lean, sy), (18 + lean, sy - 1), (19 + lean + wave[0], sy - 7 + wave[1]),
            top[2], far_skin, bare=bare)
        body.blit(arms)
        if skirt:
            sk = SKIRT_SIDE if bottom == "skirt" else SKIRT_SIDE[:4]
            body.art(sk, 7, 19 + bob, lg if bottom == "skirt" else {**lg, "O": legs_c[0], "o": legs_c[1], "d": legs_c[2]})
        else:
            body.art(HIPS_SIDE, 8, 19 + bob, lg)
        body.art(SHIRT_SIDE[3:], 8 + lean, 16 + bob, lg)
        body.art(SHIRT_SIDE[:3], 9 + lean, 13 + bob, lg)
        if style.get("tie"):
            body.vline(15 + lean, 14 + bob, 15 + bob, style["tie"])
            body.vline(14 + lean, 16 + bob, 17 + bob, style["tie"])
        body.art(art["side"], offs[1] + lean + 1, hy, lg)
        near_arm = Img(W, H)
        arm(near_arm, (10 + lean, sy), (6.5 + lean, sy - 1), (5.5 + lean - wave[0], sy - 7 - wave[1]),
            top[1], skin[1], bare=bare)
        body.stamp(near_arm, sep=top[2])
    body.outline(OUTLINE)
    return body


def civilian_frames(variant: int) -> list:
    """Rows of 4 run frames, one row per facing."""
    return [[civilian(variant, facing, f) for f in range(4)] for facing in FACINGS]
