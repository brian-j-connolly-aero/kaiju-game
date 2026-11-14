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


# The human color: light, human_cyan, shaded. Every soldier frame carries at least CYAN_MIN
# pixels of it (helmet band, armbands, a strip on the pack), so a section reads as "ours" from
# a kaiju's eye 80 m away and from behind, where the olive alone is camouflage.
CYAN = (col("#9af0fb"), col("#1ec8e0"), col("#1593ab"))
CYAN_MIN = 25
CYAN_MIN_DOWN = 15         # the die frames: a body on the ground shows less of everything

# rifle: light skin, brown hair; rocket: brown skin, black hair
SOLDIER_LOOKS = {
    "rifle": ("light", (col("#6b4a33"), col("#4a3324"), col("#2f2019"))),
    "rocket": ("brown", (col("#4a4458"), col("#2c2836"), col("#1b1924"))),
}


def army_style(kind: str = "rifle") -> dict:
    skin, hair = SOLDIER_LOOKS[kind]
    return {
        "hat": (col("#7c8a40"), col("#4f5c27"), col("#303a1b")),      # helmet: one shade darker than the jacket,
                                                                      # so the head separates from the body
        "top": (col("#98a857"), col("#6b7a3a"), col("#465329")),      # jacket (army_olive in the middle)
        "legs": (col("#869648"), col("#5d6c33"), col("#3b4724")),     # trousers, a touch darker
        "skin": SKINS[skin],
        "boots": (col("#5a5e6b"), col("#2a2d35")),
        "web": (col("#cfc18e"), col("#a79a6a"), col("#6c6241")),      # belt, straps, pack (army_khaki)
        "band": CYAN,                                                 # helmet band, armbands, pack strip
        "eye": col("#2a2230"),
        "hair": hair,
    }


def cyan_pixels(arr) -> int:
    """How many pixels of an RGBA array carry one of the three cyan tones."""
    import numpy as np
    a = np.asarray(arr)
    m = np.zeros(a.shape[:2], bool)
    for c in CYAN:
        m |= (a[..., 0] == c[0]) & (a[..., 1] == c[1]) & (a[..., 2] == c[2])
    return int((m & (a[..., 3] > 0)).sum())


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
        "C": style["band"][0], "c": style["band"][1], "x": style["band"][-1],
        "e": style["eye"],
        "M": METAL[0], "m": METAL[1], "n": METAL[2],
        "U": WOOD[0], "u": WOOD[1],
        "X": col(OUTLINE),
        "T": ROCKET_WHITE, "t": ROCKET_GREY,
        "1": FLASH[0], "2": FLASH[1], "3": FLASH[2], "4": FLASH[3],
    }


# ---- ASCII parts: soldier ---------------------------------------------------------------
# Heads are placed with their left column at x = 7 and their top row at y = 5 (+ bob).

# The two rows above the brim are the cyan band (C lit, c human cyan, x shaded side).
HELMET_FRONT = [
    "..GGGGGG..",
    ".GGGHHHHh.",
    "CCccccccxx",
    "ccccccccxx",
    "hhhhhhhhhh",
    ".SeSSSeSz.",
    ".SSSSSSsz.",
    "..zssssz..",
]
HELMET_SIDE = [           # facing right; the brim pokes out one pixel in front
    "..GGGGGG...",
    ".GGGHHHHh..",
    "CCcccccccx.",
    "cccccccccxx",
    "hhhhhhhhhhh",
    ".hhsSSSeS..",
    "..zsSSSSSs.",
    "...zsSSs...",
]
HELMET_BACK = [
    "..GGGGGG..",
    ".GGGHHHHh.",
    "CCccccccxx",
    "ccccccccxx",
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
TORSO_BACK = [             # the top two rows of the pack are a cyan strip
    ".oOOOOOOd.",
    "oOCcccccod",
    "oOcccccxod",
    "oOwWwwwqod",
    ".OwwwwwqD.".replace("D", "d"),
    ".qqwwwwqq.",
    ".oOOOoood.",
    ".oOOooodd.",
]
TORSO_SIDE = [            # facing right, the pack on the back; left column at x = 6
    "...oOOOo.",
    ".CcOOOOod",
    "ccxOOOOod",
    "wWwOOOood",
    "wwwOOOood",
    ".qqwwwwq.",
    "..oOOood.",
    "..oOoood.",
]


# ---- limbs --------------------------------------------------------------------------------

def boot_front(img: Img, x: int, y: int, lg: dict, big: bool = True, w: int = 3) -> None:
    """Front or back view boot under a leg `w` pixels wide whose left column is x; y is its top row."""
    rows = ["k" * w, "k" * (w - 1) + "K", "k" * w] if big else ["k" * w, "k" * w]
    img.art(rows, x, y, lg)


# Side-view legs, facing right, one leg per drawing: (rows, column of the hip's left pixel).
# P p = thigh (light, mid), I i = shin, k K = boot. The same drawing serves as the near leg
# (lit) and as the far leg (dark); a frame is two of them laid over each other at the hip.
LEG_STAND = (["PPp.", "PPp.", "PPp.", "PPp.", "IIi.", "IIi.", "IIi.", "kkk.", "kkkK", "kkkk"], 0)
LEG_FWD = ([              # walk, contact: the heel strikes well in front (a running stride)
    "PPp......",
    ".PPp.....",
    "..PPp....",
    "..IIi....",
    "...IIi...",
    "....IIi..",
    "....kkk.K",
    "....kkkkk",
    "....kkkk.",
], 0)
LEG_BACK = ([             # walk, contact: the rear foot pushes off, heel up
    "......PPp",
    ".....PPp.",
    "....PPp..",
    "...IIi...",
    "..IIi....",
    ".kkIi....",
    ".kkk.....",
    "..kkk....",
    "..kkK....",
], 6)
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
    """The cyan armband: three rows on the upper arm."""
    img.rect(x, y, x + w - 1, y + 2, style["band"][1])
    img.px(x, y, style["band"][0])
    img.px(x + w - 1, y + 2, style["band"][-1])


# ---- weapons ------------------------------------------------------------------------------

TUBE_SIDE = [
    "nMMMMMMMMMMMMM....",
    "nmmmmmnmmmmmmmcTTT",
    "nnnnnnnnnnnnnnctt.",
]
TUBE_SIDE_EMPTY = [        # just fired: the rocket is gone, the mouth is a dark hole
    "nMMMMMMMMMMMMn....",
    "nmmmmmnmmmmmmX....",
    "nnnnnnnnnnnnnn....",
]


def tube_side(img: Img, x0: int, y: int, lg: dict, tail_down: bool = False, loaded: bool = True) -> None:
    """The launcher seen from the side, pointing right. x0 is the rear end, y the top row of
    the three-pixel tube. A loaded rocket (white nose, cyan band) sticks out in front.
    tail_down: the rear third hangs one pixel lower (carried, not aimed)."""
    for j, row in enumerate(TUBE_SIDE if loaded else TUBE_SIDE_EMPTY):
        for i, ch in enumerate(row):
            if ch == ".":
                continue
            img.px(x0 + i, y + j + (1 if tail_down and i < 6 else 0), lg[ch])
    d = 1 if tail_down else 0
    img.px(x0 - 1, y + d, lg["n"]).px(x0 - 1, y + 2 + d, lg["n"])      # flared rear end


def tube_front(img: Img, x: int, y: int, lg: dict, loaded: bool = True) -> None:
    """The launcher on the shoulder, pointing at the viewer, strongly foreshortened: what
    shows is the round mouth (a 5 x 5 ring with a dark rim) and three pixels of tube rising
    behind it. Loaded, the ring holds the white nose of the rocket with a cyan dot; fired,
    it is an empty dark bore. (x, y) is the top left of the tube; the ring's middle is at
    (x + 2, y + 5)."""
    img.art([
        "nMMmn",
        "nMMmn",
        "nMmmn",
        ".nnn.",
        "nTTTn" if loaded else "nXXXn",
        "nTcTn" if loaded else "nXXXn",
        "nTTtn" if loaded else "nXXnn",
        ".nnn.",
    ], x, y, lg)


def tube_back(img: Img, x: int, y: int, lg: dict, loaded: bool = True) -> None:
    """The launcher pointing away from the viewer: it runs up the picture, rocket nose on top
    (or, just fired, the empty mouth three pixels lower)."""
    img.art([
        ".Tt." if loaded else "....",
        "TTTt" if loaded else "....",
        "cCCc" if loaded else ".nn.",
        "mMMn",
        "mMmn",
        "mMmn",
        "mMmn",
        "mMmn",
        "mMmn",
        "nnnn",
        "n..n",
    ], x, y, lg)


RIFLE_SIDE = [             # pointing right, 12 long: wooden stock, receiver, magazine, barrel with a front sight
    "..........m.",
    "UUUmmmmMMMMM",
    "Uu.nmmnUu...",
    "....nn......",
    "....nn......",
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
    """A star-shaped muzzle flash centered on (cx, cy): arms of `size` + 1 pixels, shorter
    diagonals, a white-hot middle that grows with the size."""
    c0, c1, c2, c3 = FLASH
    for d in range(1, size + 2):
        for dx, dy in ((d, 0), (-d, 0), (0, d), (0, -d)):
            img.px(cx + dx, cy + dy, c2 if d <= size else c3)
    for d in range(1, max(2, size)):
        for dx, dy in ((d, d), (-d, d), (d, -d), (-d, -d)):
            img.px(cx + dx, cy + dy, c2 if d < size - 1 or size < 2 else c3)
    core = max(1, size - 1)
    for d in range(1, core + 1):
        for dx, dy in ((d, 0), (-d, 0), (0, d), (0, -d)):
            img.px(cx + dx, cy + dy, c1 if d == core else c0)
    if size >= 3:
        for dx, dy in ((1, 1), (-1, 1), (1, -1), (-1, -1)):
            img.px(cx + dx, cy + dy, c1)
    img.px(cx, cy, c0)


def puff(img: Img, cx: float, cy: float, r: float = 2) -> None:
    """A tiny smoke puff."""
    img.disc(cx, cy, r, SMOKE[1])
    img.disc(cx - 0.5, cy - 0.5, max(0.6, r - 1), SMOKE[0])


# ---- the soldier --------------------------------------------------------------------------

def _legs_front(body: Img, lift, style: dict, lg: dict, bare_from=None, shoes_big=True,
                top: int = 21, xs=(8, 13), w: int = 3) -> None:
    """Front or back view legs: two columns `w` wide starting at `xs`, from row `top` down
    to the boots. lift = pixels each foot is raised."""
    legs_c, skin = style["legs"], style["skin"]
    for i, x in enumerate(xs):
        up = lift[i]
        bottom = 27 - up
        if bottom >= top:
            body.rect(x, top, x + w - 1, bottom, legs_c[1])
            body.vline(x, top, bottom, legs_c[0] if i == 0 else legs_c[1])
            body.vline(x + w - 1, top, bottom, legs_c[2])
        if bare_from is not None:
            y0 = top + 1 if bare_from == "hip" else top + max(1, (28 - top) // 2)
            if y0 <= bottom:
                body.rect(x, y0, x + w - 1, bottom, skin[1])
                body.vline(x + w - 1, y0, bottom, skin[2])
                body.vline(x, y0, bottom, skin[0] if i == 0 else skin[1])
        if up >= 2:
            boot_front(body, x, 28 - up, lg, big=False, w=w)
        else:
            boot_front(body, x, 28 - up, lg, big=True, w=w)
            if up == 0 and shoes_big:
                body.px(x + (-1 if i == 0 else w), 30, lg["k"])      # toes turned out
                body.px(x + (-1 if i == 0 else w), 29, lg["k"])


def soldier(kind: str, facing: str, pose: str) -> Img:
    """One soldier frame. kind: 'rocket' | 'rifle'. facing: front | left | back | right.
    pose: idle, walk0..walk3, fire0, fire1."""
    if facing == "left":
        return soldier(kind, "right", pose).flipped()
    style = army_style(kind)
    lg = legend(style)
    body = Img(W, H)           # everything that gets the dark silhouette outline
    glow = Img(W, H)           # flashes and smoke: drawn on top, no outline
    step = int(pose[4]) if pose.startswith("walk") else -1
    firing = pose.startswith("fire")
    recoil = pose == "fire1"
    bob = 1 if step in (0, 2) else 0
    legs_c = style["legs"]

    if facing in ("front", "back"):
        if recoil and kind == "rifle" and facing == "front":
            bob = -1            # the shot pushes the body back: away from the viewer is up the picture
        lift = {0: (0, 2), 1: (0, 1), 2: (2, 0), 3: (1, 0)}.get(step, (0, 0))
        if facing == "back":
            lift = (lift[1], lift[0])
        _legs_front(body, lift, style, lg)
        body.rect(8, 21 + min(bob, 0), 15, 22, legs_c[1])   # hips
        body.hline(8, 15, 21 + min(bob, 0), legs_c[2])
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
            # aiming at the viewer: the rifle is foreshortened to its muzzle, a dark 2 x 2
            # hole at chest height with two pixels of barrel behind (above) it. The stock is
            # hidden behind the hands. Nothing here may read as a cross or a blade.
            arm(arms, (6.5, sy), (7, sy + 3), (9.5, sy + 2), top[1], skin[1])
            arm(arms, (16.5, sy), (16, sy + 3), (13.5, sy + 2), top[2], skin[1])
            gun.rect(11, sy, 12, sy + 1, lg["m"])
            gun.vline(11, sy, sy + 1, lg["M"])
            gun.rect(11, sy + 2, 12, sy + 3, lg["X"])
            if not recoil:
                flash(glow, 11, sy + 2, 3)
                glow.px(12, sy + 2, FLASH[0]).px(12, sy + 3, FLASH[0]).px(11, sy + 3, FLASH[0])
            else:
                glow.px(12, sy + 4, SMOKE[0]).px(13, sy + 5, SMOKE[1])      # a two-pixel wisp of smoke
        band(arms, 6, sy + 1, style)
        band(arms, 16, sy + 1, style)
        body.stamp(arms, sep=top[2])
        body.stamp(gun, sep=lg["n"])
    else:
        # from behind only the muzzle shows, over the soldier's left shoulder (screen left),
        # the same shoulder it leans on in the front view
        if not firing:
            arm(arms, (6.5, sy), (6, sy + 4), (8, sy + 5), top[1], skin[1], hand_px=False)
            arm(arms, (16.5, sy), (17, sy + 4), (15, sy + 5), top[2], skin[1], hand_px=False)
            gun.limb(6, sy - 1, 4, sy - 6, 2, lg["m"], lg["M"])
        else:
            r = 1 if recoil else 0
            arm(arms, (6.5, sy), (6, sy + 3), (8, sy + 2), top[1], skin[1], hand_px=False)
            arm(arms, (16.5, sy), (17, sy + 3), (15, sy + 2), top[2], skin[1], hand_px=False)
            gun.limb(6, sy - 1 + r, 6, sy - 7 + r, 2, lg["m"], lg["M"])
            if not recoil:
                flash(glow, 6, sy - 9, 2)
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
        # at the ready: held level at chest height, butt at the armpit, the far hand under
        # the handguard
        gy = sy                                   # top row of the rifle drawing (its front sight)
        gun.art(RIFLE_SIDE, 10, gy, lg)
        arm(arms, (10.5, sy), (10, sy + 3), (13, sy + 3), top[1], skin[1])
        arm(far, (12, sy), (15, sy + 3), (17.5, sy + 3), top[2], skin[2])
    else:
        gy = sy - 2                               # raised to the eye
        gun.art(RIFLE_SIDE, 10 + x, gy, lg)
        arm(arms, (10.5 + x, sy), (11 + x, sy + 3), (13 + x, sy + 1), top[1], skin[1])
        arm(far, (12 + x, sy), (15 + x, sy + 2), (17.5 + x, sy + 1), top[2], skin[2])
        if not recoil:
            flash(glow, 22, gy + 1, 1)
            glow.px(21, gy + 1, FLASH[0])
        else:
            puff(glow, 22.5, gy + 0.5, 1.2)
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
        # tube on the soldier's right shoulder = the viewer's left, its mouth beside the chin
        arm(arms, (16.5, sy), (17, sy + 3), (16.5, sy + 6), top[2], skin[1])
        band(arms, 16, sy + 1, style)
        body.stamp(arms, sep=top[2])
        tube_front(gun, 2, sy - 6 - r, lg, loaded=not recoil)
        body.stamp(gun, sep=lg["n"])
        grip = Img(W, H)
        arm(grip, (7.5, sy + 1), (8.5, sy + 4), (7, sy + 2.5), top[1], skin[1])
        band(grip, 8, sy + 2, style, 2)
        body.stamp(grip, sep=top[2])
        if firing and not recoil:
            flash(glow, 4, sy - 1, 4)                       # centered on the mouth of the tube
        elif recoil:
            puff(glow, 3.5, sy + 1.5, 1.6)
    else:
        arm(arms, (6.5, sy), (6, sy + 3), (6.5, sy + 6), top[1], skin[1])
        band(arms, 6, sy + 1, style)
        body.stamp(arms, sep=top[2])
        tube_back(gun, 16, sy - 9 + r, lg, loaded=not recoil)
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
            puff(glow, 17.5, sy - 8, 2)
            puff(glow, 17.5, sy + 5, 2)


def _rocket_side(body, glow, firing, recoil, sy, lean, style, lg) -> None:
    top, skin = style["top"], style["skin"]
    gun = Img(W, H)
    arms = Img(W, H)
    x = lean
    ty = sy - 1                                 # tube rows: on the shoulder, under the chin
    tube_side(gun, 3 + x, ty, lg, loaded=not recoil)
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
        puff(glow, 19.5, ty + 0.5, 2)
        puff(glow, 1.5, ty + 1.5, 2)


# ---- dying (side view, falls backward; no gore) ---------------------------------------------

FALLING = [
    "...GGG.....sS...........",
    "..CccHh....so...........",
    ".Ccccchs...oo...........",
    ".ccccxSSs.oo............",
    "..hhzSSsoCc.............",
    "....zssOccxo............",
    ".....ccOcccOo...........",
    ".....ccxOOOOod..........",
    "......wwwOOoodd.........",
    ".......qqwwwwqp.........",
    "........bpPPppPp........",
    ".........bppPppPp.......",
    "..........bpp.bpPp......",
    "...........bpp.bpPp.....",
    "............bpp.bpPp....",
    ".............bpp.bppkk..",
    "............kkkK.kkkkK..",
    "............kkKK..kkKK..",
]
DOWN = [                   # on the back, head at the left, knees still up (22 wide, at x = 1)
    "................pp....",
    "...............pPPp...",
    "..hcch........pPPppp..",
    ".hGccHh..oOOo.pPPp.bpp",
    "hGHccHhSsCccOOoPPp.bpp",
    "hHHcchhSScccOOOwPp.bpk",
    "hHHcxhzSsccxOOowwp.kkK",
    ".hhxxzzzoodddoodqq.kkk",
]
FLAT = [                   # flat out; the helmet has rolled off to the left (22 wide, at x = 1)
    ".........oOOOo........",
    ".Cc..AaSsCccOOo....kk.",
    "GccH.AaSScccOOOwwPPkkK",
    "GccH.aSsoccxOOowwppkkk",
    "hxx..rzzoodddoodqqbkkk",
]


def soldier_die(kind: str, frame: int) -> Img:
    """Four frames: hit and reeling, falling, down, flat with the helmet rolled off."""
    style = army_style(kind)
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

def shirt(w: int, rows: int, belly: bool = False) -> list:
    """A top seen from the front (w = 8 for an adult) or from the side (w = 7): rounded
    shoulders, a shaded right edge, narrowing to the waist unless there is a belly."""
    out = ["." + "O" * (w - 2) + "."]
    for j in range(1, rows):
        waist = j >= rows - 2 and not belly
        shade_ = "ood" if j in (rows - 3, rows - 1) else "od"
        if waist:
            out.append("." + "O" * (w - 2 - len(shade_)) + shade_ + ".")
        elif belly and j == rows - 1:
            out.append("." + "O" * (w - 2 - len(shade_)) + shade_ + ".")
        else:
            out.append("O" * (w - len(shade_)) + shade_)
    return out


def hips(w: int) -> list:
    row = "." + "P" + "p" * (w - 4) + "b" + "."
    return [row, row]


SKIRT_FRONT = [            # a dress flares from the waist: six rows, left column at x = 7
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

# Side-view run legs for a child: two pixels thick, five rows from hip to sole.
KID_LAND = (["Pp....", ".Pp...", "..Ii..", "..kk..", "..kkK."], 0)
KID_KICK = (["...Pp", "..Pp.", ".Ii..", "kk...", "k...."], 3)
KID_KNEE = (["Pp...", "PPp..", ".Ii..", ".kk..", ".kkK."], 0)
KID_PUSH = (["...Pp", "..Pp.", ".Ii..", "kk...", "kK..."], 3)


def thin_leg(leg) -> tuple:
    """The same leg one pixel thinner: every run of three or more pixels loses its last one."""
    rows, ox = leg
    out = []
    for row in rows:
        chars = list(row)
        i = 0
        while i < len(chars):
            if chars[i] == ".":
                i += 1
                continue
            j = i
            while j < len(chars) and chars[j] != ".":
                j += 1
            if j - i >= 3:
                chars[j - 1] = "."
            i = j
        out.append("".join(chars))
    return (out, ox)


def long_leg(leg, extra: int = 1) -> tuple:
    """The same leg `extra` rows longer (a thigh row is repeated)."""
    rows, ox = leg
    return (rows[:2] + [rows[1]] * extra + rows[2:], ox)


# Builds: how a civilian differs from the standard adult (25 pixels from crown to sole).
#   dy          rows the head and shoulders sit lower (+) or higher (-)
#   torso       rows of the top
#   w           width of the top seen from the front (the side view is one narrower)
#   legs, leg_w columns and width of the two legs seen from the front
#   reach       how far the raised hands go above the shoulders
BUILDS = {
    "adult": {"dy": 0, "torso": 6, "w": 8, "legs": (8, 13), "leg_w": 3, "reach": 8, "belly": False},
    "child": {"dy": 6, "torso": 4, "w": 6, "legs": (9, 13), "leg_w": 2, "reach": 6, "belly": False},     # 19 px tall, big head
    "tall": {"dy": -2, "torso": 7, "w": 6, "legs": (9, 13), "leg_w": 2, "reach": 8, "belly": False},     # 27 px, thin
    "stout": {"dy": 0, "torso": 6, "w": 10, "legs": (8, 13), "leg_w": 3, "reach": 8, "belly": True},     # 2 px wider
}

# Props: something carried in one raised hand. Rows are stamped with their top left at the
# hand; letters: 1 2 3 = light, mid, dark of the prop's own colors, 4 = accent, n = dark strap.
PROPS = {
    "briefcase": {
        "art": [".nn..", "11112", "12422", "22223", "33333"],
        "colors": (col("#b9824a"), col("#8a5a33"), col("#5e3b22"), col("#f0dc9a")),
    },
    "bag": {                # a paper shopping bag with a magenta band
        "art": ["n..n", "1112", "4444", "1112", "1122", "2223"],
        "colors": (col("#ffffff"), col("#e6e8ee"), col("#aab0c4"), col("#d62f8a")),
    },
    "camera": {             # a camera swinging on its strap
        "art": ["n....", ".n...", ".1112", ".1422", ".2223"],
        "colors": (col("#737b8a"), col("#4a4f5c"), col("#2a2d35"), col("#dfe6f2")),
    },
}


def prop(img: Img, name: str, hx: int, hy: int, outward: int) -> None:
    """Hang a prop from the hand at (hx, hy). outward = +1 when the free side of that arm is
    to the right, -1 to the left; the prop hangs on the free side and is kept inside the cell
    so that its outline fits."""
    p = PROPS[name]
    c1, c2, c3, c4 = p["colors"]
    lg = {"1": c1, "2": c2, "3": c3, "4": c4, "n": col("#2a2d35")}
    art = p["art"]
    w = len(art[0])
    x0 = hx if outward > 0 else hx - w + 2
    x0 = min(max(x0, 1), W - 1 - w)
    img.art(art, x0, hy + 1, lg, flip=outward < 0)


def civilian_styles() -> list:
    """The six civilians. Bright clothes in colors that mean nothing in the game: none of
    them wears human cyan, kaiju orange or volley yellow, and no piece of clothing has the
    color of a ground tile (check_civilian_colors enforces both)."""
    white = (col("#ffffff"), col("#eef0f4"), col("#aab0c4"))
    return [
        {   # 1: a child: red T-shirt, blue jeans, short brown hair
            "name": "child in red", "head": "short", "skin": SKINS["light"], "build": "child",
            "hair": (col("#8a5a3a"), col("#5e3b26"), col("#3b2418")),
            "top": ramp("#e0372f"), "legs": ramp("#3b5fc0"), "boots": (col("#ffffff"), col("#d7dbe4")),
            "bare_arms": True, "bottom": "pants",
        },
        {   # 2: coral dress, long black hair
            "name": "coral dress", "head": "long", "skin": SKINS["brown"], "build": "adult",
            "hair": (col("#4a4458"), col("#2c2836"), col("#1b1924")),
            "top": ramp("#ff6f61", 0.72, 1.2), "legs": ramp("#ff6f61", 0.72, 1.2),
            "boots": (col("#8f5fd6"), col("#6a40ad")),
            "bare_arms": True, "bottom": "skirt",
        },
        {   # 3: office worker: stout, white shirt, magenta tie, navy trousers, bald with glasses, briefcase
            "name": "office", "head": "bald", "skin": SKINS["tan"], "build": "stout",
            "hair": (col("#d9d9de"), col("#a9abb5"), col("#7d7f8c")),
            "top": white, "legs": ramp("#34407a"), "boots": (col("#4a4d57"), col("#23252b")),
            "bare_arms": False, "bottom": "pants", "tie": (col("#d62f8a"), col("#a51f68")), "prop": "briefcase",
        },
        {   # 4: tall and thin: purple hoodie, khaki shorts, white cap
            "name": "purple hoodie", "head": "cap", "skin": SKINS["dark"], "build": "tall",
            "hair": (col("#3a3440"), col("#2a2530"), col("#1b1820")),
            "hat": white,
            "top": ramp("#8f5fd6"), "legs": ramp("#c9b27a"), "boots": (col("#ffffff"), col("#d7dbe4")),
            "bare_arms": False, "bottom": "shorts",
        },
        {   # 5: pink top, white skirt, blonde ponytail, shopping bag
            "name": "pink top", "head": "pony", "skin": SKINS["light"], "build": "adult",
            "hair": (col("#f4d488"), col("#d6a850"), col("#a67a2c")),
            "top": ramp("#ff5fa2"), "legs": white, "boots": (col("#8f5fd6"), col("#6a40ad")),
            "bare_arms": True, "bottom": "skirt2", "prop": "bag",
        },
        {   # 6: tourist: blue shirt, straw hat, red shorts, camera
            "name": "tourist", "head": "hat", "skin": SKINS["tan"], "build": "adult",
            "hair": (col("#6b4a33"), col("#4a3324"), col("#2f2019")),
            "hat": (col("#f7e3a1"), col("#e2c56e"), col("#b3954a")),
            "top": ramp("#2f62c9", 0.7, 1.3), "legs": ramp("#d8473c", 0.7, 1.2),
            "boots": (col("#a8743f"), col("#7a5236")),
            "bare_arms": True, "bottom": "shorts", "prop": "camera",
        },
    ]


# Colors with a meaning in the game, which no civilian may come near, and the ground anchors,
# which no piece of clothing may match (a tourist in grass-green shorts loses his legs on a lawn).
RESERVED = {"human cyan": "#1ec8e0", "kaiju orange": "#ff7a1a", "volley yellow": "#ffd91a"}
GROUNDS = {"road": "#2b3040", "sidewalk": "#b9bcc6", "grass": "#4fbf5f", "water": "#2f7fd6", "rubble": "#8d8d94"}
RESERVED_MIN = 60          # summed difference of the three channels, in steps of 1/255
GROUND_MIN = 24


def _dist(a, b) -> int:
    ca, cb = col(a), col(b)
    return sum(abs(int(ca[i]) - int(cb[i])) for i in range(3))


def check_civilian_colors(sheet_colors=None) -> list:
    """Problems with the civilians' colors, as sentences (empty when all is well).
    sheet_colors: the distinct colors found in civilians.png; every one of them must stay
    RESERVED_MIN away from the three reserved colors. The clothes of every style (tops,
    bottoms, hats, shoes: all three shades) must stay GROUND_MIN away from the ground anchors."""
    problems = []
    for c in sorted(sheet_colors or []):
        for name, r in RESERVED.items():
            if _dist(c, r) < RESERVED_MIN:
                problems.append(f"civilians.png uses #%02x%02x%02x, {_dist(c, r)} steps from {name} {r} (limit {RESERVED_MIN})" % tuple(c[:3]))
    for st in civilian_styles():
        for part in ("top", "legs", "hat", "boots"):
            for c in st.get(part, ()):
                for name, g in GROUNDS.items():
                    if _dist(c, g) < GROUND_MIN:
                        problems.append(f"civilian '{st['name']}': {part} color #%02x%02x%02x is the color of the {name} "
                                        f"({_dist(c, g)} steps away, limit {GROUND_MIN})" % tuple(c[:3]))
    return problems


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
    b = BUILDS[style["build"]]
    kid, tall, stout = style["build"] == "child", style["build"] == "tall", style["build"] == "stout"
    bottom = style["bottom"]
    skirt = bottom in ("skirt", "skirt2")
    bare_from = {"pants": None, "shorts": "knee", "skirt": "hip", "skirt2": "hip"}[bottom]
    bare = style["bare_arms"]
    art, offs = HEADS[style["head"]]
    air = frame in (1, 3)                    # both feet off the ground
    bob = -1 if air else 1
    dy = b["dy"]
    hy = 6 + dy + bob                        # top row of the head
    ty = 13 + dy + bob                       # top row of the top
    wy = ty + b["torso"]                     # first row of the hips (or skirt)
    leg_top = 13 + dy + b["torso"] + 2       # first row of the legs (they do not bob: the feet lift instead)
    w = b["w"]
    reach = b["reach"]
    held = style.get("prop")

    if facing in ("front", "back"):
        x0 = 12 - w // 2                     # left column of the top
        lift = {0: (0, 4), 1: (1, 2), 2: (4, 0), 3: (2, 1)}[frame]
        if kid:
            lift = tuple(min(v, 2) for v in lift)
        if facing == "back":
            lift = (lift[1], lift[0])
        _legs_front(body, lift, style, lg, bare_from=bare_from, shoes_big=False,
                    top=leg_top, xs=b["legs"], w=b["leg_w"])
        if skirt:
            sk = SKIRT_FRONT if bottom == "skirt" else SKIRT_FRONT[:4]
            body.art(sk, 7, wy, lg if bottom == "skirt" else {**lg, "O": legs_c[0], "o": legs_c[1], "d": legs_c[2]})
        else:
            body.art(hips(w), x0, wy, lg)
            body.rect(x0 + 1, leg_top + bob, x0 + w - 2, leg_top + max(bob, 0), legs_c[1])
        body.art(shirt(w, b["torso"], b["belly"]), x0, ty, lg)
        if style.get("tie") and facing == "front":
            # a tie, two pixels wide all the way so that it cannot be read as a letter
            body.rect(11, ty + 1, 12, ty + 4, style["tie"][0])
            body.hline(11, 12, ty, style["tie"][1])
            body.vline(12, ty + 1, ty + 4, style["tie"][1])
        if facing == "front" and bare:
            body.hline(12 - w // 2 + 2, 11 + w // 2 - 2, ty, skin[1])    # neckline
        # arms up, waving: each frame tilts the pair a little
        wave = [(-1, 0, 1, 2), (0, 0, 0, 0), (1, 2, -1, 0), (0, 1, 0, 1)][frame]
        sy = ty + 1
        el = 3 if reach >= 8 else 2          # the elbows sit this far above the shoulders
        lx, rx = x0, x0 + w - 1              # shoulder columns
        arms = Img(W, H)
        lh = (lx - 3 + wave[0], sy - reach + wave[1])
        rh = (rx + 3 + wave[2], sy - reach + wave[3])
        arm(arms, (lx, sy), (lx - 2.5, sy - el + wave[1]), lh, top[1], skin[1], bare=bare)
        arm(arms, (rx, sy), (rx + 2.5, sy - el + wave[3]), rh, top[2], skin[1], bare=bare)
        body.blit(arms)
        if held:
            # the same hand in both views: the figure's left, which is at the viewer's
            # right from the front and at the viewer's left from behind
            hand, outward = (rh, 1) if facing == "front" else (lh, -1)
            prop(body, held, int(round(hand[0])), int(round(hand[1])), outward)
        key = "front" if facing == "front" else "back"
        body.art(art[key], offs[0 if facing == "front" else 2], hy, lg)
    else:
        lean = 1
        ws = w - 1                            # the top seen from the side
        x0 = 8                               # its left (back) column; a belly grows forward
        hip_y = leg_top + bob
        # run: contact frames with a long stride, flight frames with both feet in the air
        if kid:
            far, near = [(KID_KICK, KID_LAND), (KID_KNEE, KID_PUSH), (KID_LAND, KID_KICK), (KID_PUSH, KID_KNEE)][frame]
        else:
            far, near = [(RUN_KICK, RUN_LAND), (RUN_KNEE, RUN_PUSH), (RUN_LAND, RUN_KICK), (RUN_PUSH, RUN_KNEE)][frame]
            if tall:
                far, near = long_leg(thin_leg(far)), long_leg(thin_leg(near))
        leg_side(body, far, 10, hip_y, style, near=False, bare_from=bare_from)
        leg_side(body, near, 10, hip_y, style, near=True, bare_from=bare_from)
        sy = ty + 1
        el = 1
        wave = [(0, 0), (1, -1), (0, 1), (-1, 0)][frame]
        # both arms are thrown up like goalposts, one behind the back and one in front of
        # the face, so the head stays clear between them
        far_skin = mix(skin[1], skin[2], 0.55)
        fx = x0 + ws - 1 + lean              # the front edge of the chest
        arms = Img(W, H)
        ahead = 3 if stout else 4            # how far in front of the chest the far hand goes up
        arm(arms, (fx - 1, sy), (fx + ahead - 1, sy - el), (fx + ahead + wave[0], sy - reach + 1 + wave[1]),
            top[2], far_skin, bare=bare)
        body.blit(arms)
        if skirt:
            sk = SKIRT_SIDE if bottom == "skirt" else SKIRT_SIDE[:4]
            body.art(sk, 7, wy, lg if bottom == "skirt" else {**lg, "O": legs_c[0], "o": legs_c[1], "d": legs_c[2]})
        else:
            hw = min(ws, 7)
            body.art(hips(hw), x0 + (1 if kid or tall else 0), wy, lg)
        rows = shirt(ws, b["torso"], b["belly"])
        split = 3 if b["torso"] >= 6 else 2
        body.art(rows[split:], x0 + (1 if kid or tall else 0) + lean, ty + split, lg)
        body.art(rows[:split], x0 + (1 if kid or tall else 0) + 1 + lean, ty, lg)
        if style.get("tie"):
            body.vline(fx + 1, ty + 1, ty + 2, style["tie"][0])
            body.vline(fx, ty + 3, ty + 4, style["tie"][0])
        body.art(art["side"], offs[1] + lean + 1, hy, lg)
        near_arm = Img(W, H)
        bx = x0 + (1 if kid or tall else 0) + 1 + lean          # the back of the shoulder
        nh = (bx - 4.5 - wave[0], sy - reach + 1 - wave[1])
        arm(near_arm, (bx, sy), (bx - 3.5, sy - el), nh, top[1], skin[1], bare=bare)
        if held:
            prop(near_arm, held, int(round(nh[0])), int(round(nh[1])), -1)
        body.stamp(near_arm, sep=top[2])
    body.outline(OUTLINE)
    return body


def civilian_frames(variant: int) -> list:
    """Rows of 4 run frames, one row per facing."""
    return [[civilian(variant, facing, f) for f in range(4)] for facing in FACINGS]
