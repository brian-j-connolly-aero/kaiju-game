"""Atlas pictures for the six buildings of the starting neighborhoods (tools/art/city_starts.py):
the bungalow, the duplex, the garage, the diner, the firehouse and the motel. They live in the
homes block.

    motel_front     four motel rooms on two floors: a door and a wide window each (tintable)
    fire_front      the firehouse front: brick, two tall red engine doors, four windows, a bell
    diner_wall      the diner's body: a band of big round-cornered windows over fluted panels (tintable)
    door_rollup     a ribbed roll-up garage door 3 x 2.25 m (the look of prop_garagedoor)
    diner_chrome    the diner's chrome roof edge with a red neon line
    diner_sign      the diner's roof sign: a steaming cup (glows at night)
    motel_sign      the motel's sign: a sleeping moon, three sparkles and a bed (glows at night)
    steps           stair treads seen from above

No letters or numbers anywhere: pictures only.
"""
import numpy as np

from city import atlas, style

FAMILY = "homes"

REGIONS = [
    dict(name="motel_front", x=0, y=256, w=64, h=32, kind="facade", tint=True, twin=(64, 256),
         note="motel rooms: door and window per bay, two floors (tintable)"),
    dict(name="fire_front", x=0, y=288, w=64, h=40, kind="facade", twin=(64, 288),
         note="firehouse front 13.25 x 7.5 m: two red engine doors, four windows, a bell"),
    dict(name="diner_wall", x=0, y=328, w=64, h=20, kind="facade", tint=True, twin=(64, 328),
         note="diner body: window band over fluted panels, 4 bays x 3.3 m (tintable)"),
    dict(name="door_rollup", x=0, y=348, w=16, h=12, kind="picture", twin=(16, 348),
         note="ribbed roll-up garage door 3 x 2.25 m"),
    dict(name="diner_chrome", x=32, y=348, w=32, h=6, kind="texture", note="chrome roof edge, red neon line"),
    dict(name="diner_sign", x=64, y=348, w=32, h=16, kind="picture", note="roof sign: a steaming cup"),
    dict(name="motel_sign", x=96, y=348, w=16, h=24, kind="picture", note="pole sign: sleeping moon, sparkles, bed"),
    dict(name="steps", x=112, y=348, w=16, h=16, kind="texture", note="stair treads"),
]

RED = "#c8281e"
WHITE = "#f4f2ee"


def _rgb(h):
    return atlas.hexrgb(h)


def _stamp(c, y, x, rows, colors):
    """Paint a small pixel picture: `rows` of characters, `colors` maps a character to a color."""
    for j, row in enumerate(rows):
        for i, ch in enumerate(row):
            if ch in colors:
                c[y + j, x + i] = _rgb(colors[ch])


def _motel(c, e, r, rng):
    atlas.fill(c, atlas.WALL_TINT, rng, 4)
    win = atlas.Windows(c.shape)
    doors = ["#2c8f8f", "#e07b39", "#2c8f8f", "#e07b39"]
    for by in range(2):
        y = by * 16
        c[y, :] = _rgb("#f6f4ee")                               # the slab edge / eave line
        c[y + 1, :] *= 0.86
        for bx in range(4):
            x = bx * 16
            # the door: frame, leaf, a lamp over it
            c[y + 3:y + 16, x + 1:x + 8] = _rgb("#ffffff")
            c[y + 4:y + 16, x + 2:x + 7] = _rgb(doors[(bx + by) % 4])
            c[y + 5:y + 8, x + 3:x + 6] = _rgb(doors[(bx + by) % 4]) * 0.8
            c[y + 10, x + 6] = _rgb("#f0d890")                  # knob
            c[y + 2, x + 4] = _rgb("#fff4d6")
            e[y + 2, x + 4] = _rgb("#ffd27a")
            # the wide window with its curtains half drawn
            c[y + 5:y + 13, x + 9:x + 16] = _rgb("#ffffff")
            c[y + 6:y + 12, x + 10:x + 15] = _rgb(style.GLASS_DAY)
            c[y + 6, x + 10] = _rgb(style.GLASS_DAY) * 1.9
            cur = _rgb(["#f2c4a8", "#d8e8c8", "#f0e0a8", "#c8d8f0"][int(rng.integers(4))])
            c[y + 6:y + 12, x + 10] = cur
            c[y + 6:y + 12, x + 14] = cur
            c[y + 13, x + 8:x + 16] *= 0.82
            win.add(y + 6, y + 12, x + 11, x + 14)
    c[31, :] *= 0.8
    atlas.light_windows(e, win, rng, 0.6, atlas.LIGHTS_HOME)
    return win


def _fire(c, e, r, rng):
    atlas.brick(c, rng)
    win = atlas.Windows(c.shape)
    stone = _rgb("#e6dccb")
    c[0:2, :] = stone                                           # cornice
    c[1, :] *= 0.86
    c[15:17, :] = stone                                         # string course over the doors
    c[16, :] *= 0.86
    for x in (6, 21, 35, 50):                                   # upper windows
        atlas.sash_window(c, win, 4, x, rng, lintel="#e6dccb", h=9)
    for x0 in (4, 37):                                          # two engine doors, 23 px wide
        x1 = x0 + 23
        c[18:40, x0:x1] = stone                                 # the stone surround
        c[18, x0] = c[18, x1 - 1] = _rgb("#b65740")             # ... with eased top corners
        c[19:40, x0 + 1:x1 - 1] = _rgb(RED)
        c[19, x0 + 1] = c[19, x1 - 2] = stone
        for y in (26, 30, 34, 38):                              # panel lines
            c[y, x0 + 1:x1 - 1] = _rgb(RED) * 0.78
        c[19:40, x0 + 11] = _rgb(RED) * 0.7                     # the leaves meet
        for k in range(4):                                      # a row of small windows
            wx = x0 + 2 + k * 5 + (1 if k >= 2 else 0)
            c[21:25, wx:wx + 4] = _rgb("#ffffff")
            c[22:24, wx + 1:wx + 3] = _rgb(style.GLASS_DAY)
            win.add(22, 24, wx + 1, wx + 3)
        c[39, x0 + 1:x1 - 1] = _rgb("#e3b23c")                  # a yellow kick strip
    # between the doors: a brass bell on a white disc, and a red call lamp over it
    _stamp(c, 22, 28, [".wwwwww.", "wwwbbwww", "wwbbbbww", "wwbbbbww", "wbbbbbbw", "wwwddwww", ".wwwwww."],
           {"w": WHITE, "b": "#e3b23c", "d": "#8a6a22"})
    c[19:21, 31:33] = _rgb("#d7263d")
    e[19:21, 31:33] = _rgb("#ff3a3a")
    c[32:40, 28:36] *= 0.92
    c[37:40, :4] = c[37:40, 60:] = _rgb("#8c8478")              # plinth stones at the corners
    atlas.light_windows(e, win, rng, 0.7, atlas.LIGHTS_HOME)
    return win


def _diner(c, e, r, rng):
    atlas.fill(c, atlas.WALL_TINT, rng, 3)
    win = atlas.Windows(c.shape)
    c[0:2, :] = _rgb("#f6f4ee")
    c[2, :] *= 0.86
    for bx in range(4):
        x = bx * 16
        c[4:13, x + 1:x + 15] = _rgb("#ffffff")                  # the frame, corners rounded
        for yy, xx in ((4, x + 1), (4, x + 14), (12, x + 1), (12, x + 14)):
            c[yy, xx] = _rgb(atlas.WALL_TINT)
        c[5:12, x + 2:x + 14] = _rgb("#3d5878")
        c[5, x + 2] = c[5, x + 13] = c[11, x + 2] = c[11, x + 13] = _rgb("#ffffff")
        c[6, x + 3:x + 7] = _rgb("#9fc0de")                      # the sky in the glass
        c[7, x + 3:x + 5] = _rgb("#7fa2c6")
        c[10:12, x + 4:x + 6] = _rgb("#c8414a")                  # two booth seats and their table
        c[10:12, x + 10:x + 12] = _rgb("#c8414a")
        c[10, x + 7:x + 9] = _rgb("#f4f2ee")
        c[11, x + 7:x + 9] = _rgb("#aab3bf")
        win.add(5, 12, x + 2, x + 14)
    c[13, :] = _rgb("#f6f4ee")
    c[14:18, :] = _rgb(atlas.WALL_TINT)
    c[15, :] *= 0.86                                             # fluted panels
    c[17, :] *= 0.86
    c[18:20, :] = _rgb("#7c8694")
    for lab in range(1, win.n + 1):                              # a diner never closes: every window lit
        e[win.label == lab] = _rgb("#ffe39a")
    return win


def _rollup(c, e, r, rng):
    c[...] = _rgb("#f4f2ee")
    for k in range(10):
        c[1 + k, 1:15] = _rgb("#eef0f2" if k % 2 else "#b4bcc6")
    c[11, 1:15] = _rgb("#5b6270")
    c[9, 7:9] = _rgb("#3a3f4a")                                  # the pull handle
    return None


def _chrome(c, e, r, rng):
    rows = ["#f6f9fc", "#c6d0dc", "#d7263d", "#d7263d", "#dfe6ee", "#8f9aaa"]
    for y, col in enumerate(rows):
        c[y, :] = _rgb(col)
    c[0:2, ::8] *= 0.9
    c[4:6, ::8] *= 0.9
    e[2:4, :] = _rgb("#ff5a6a")
    return None


def _cup(c, e, r, rng):
    board, ink, neon = "#2aa6a0", "#fff4d6", "#ff8ad0"
    c[...] = _rgb(board)
    c[0, :] = c[-1, :] = c[:, 0] = c[:, -1] = _rgb(WHITE)
    rows = ["..........s...s...s.............",
            "...........s...s...s............",
            "..........s...s...s.............",
            "...........s...s...s............",
            "................................",
            "........cccccccccccccc..........",
            "........cccccccccccccchhh.......",
            "........cccccccccccccc..hh......",
            "........cccccccccccccc..hh......",
            ".........cccccccccccchhh........",
            "..........cccccccccc............",
            "......pppppppppppppppppp........",
            "........pppppppppppppp.........."]
    _stamp(c, 2, 1, rows, {"c": ink, "h": ink, "s": WHITE, "p": "#f2a4c8"})
    lit = np.abs(c - _rgb(board)).sum(axis=2) > 40
    e[lit] = _rgb(neon)
    e[0, :] = e[-1, :] = e[:, 0] = e[:, -1] = _rgb(neon) * 0.55
    return None


def _moon(c, e, r, rng):
    board, moon = "#27356b", "#ffd84a"
    c[...] = _rgb(board)
    c[0, :] = c[-1, :] = c[:, 0] = c[:, -1] = _rgb(WHITE)
    rows = ["..............",
            ".s.....mmm....",
            "sss..mmmmmm...",
            ".s..mmmm......",
            "...mmmm.....s.",
            "...mmmm....sss",
            "...mmme.....s.",
            "...mmmm.......",
            "....mmmm...m..",
            ".....mmmmmmm..",
            ".s.....mmm....",
            "sss...........",
            ".s............",
            "..............",
            "..............",
            ".h............",
            ".h.pp.........",
            ".hbbbbbbbbbb..",
            ".hhhhhhhhhhhh.",
            ".h..........h.",
            "..............",
            ".............."]
    _stamp(c, 1, 1, rows, {"m": moon, "e": board, "s": WHITE, "h": WHITE, "p": "#f2a4c8", "b": "#7fd8ff"})
    lit = np.abs(c - _rgb(board)).sum(axis=2) > 40
    e[lit] = c[lit] * 0.95
    return None


def _steps(c, e, r, rng):
    for y in range(16):
        c[y, :] = _rgb("#d8d2c4" if y % 4 < 3 else "#8a8478")
    c += atlas.noise(rng, c.shape, 4)
    c[:, 0] = c[:, -1] = _rgb("#f2efe8")
    return None


_PAINT = {"motel_front": _motel, "fire_front": _fire, "diner_wall": _diner, "door_rollup": _rollup,
          "diner_chrome": _chrome, "diner_sign": _cup, "motel_sign": _moon, "steps": _steps}


def paint(cv, r, rng):
    c, e = cv.view(r)
    return _PAINT[r.name](c, e, r, rng)
