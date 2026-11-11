"""Checks the voice script (shared/src/defs/voiceLines.json) against the rules it is written to:
the schema of docs/ASSETS.md section 6, the writing rules of docs/VOICE_SCRIPT.md, and how the
game picks lines (shared/src/defs/voice.ts, `chooseVoiceLines`): a cue about a squad is only ever
spoken by that squad's own voice or by Overlord, so variety has to exist per voice, not just per
cue. The build refuses to run on a script that breaks a rule."""

from __future__ import annotations

import re
from collections import Counter, defaultdict

from . import REPO

VOICE_TS = REPO / "shared" / "src" / "defs" / "voice.ts"

KEYS = ["id", "cue", "audience", "speaker", "text"]
# who speaks to whom
CAST = {"Overlord": "humans", "Granite": "humans", "Beacon": "humans", "Tempest": "humans",
        "Anchor": "kaiju", "Chair": "all"}
SQUAD_VOICES = ("Granite", "Beacon", "Tempest")
RADIO_VOICES = ("Overlord",) + SQUAD_VOICES
HEARING = ("hearing.humans.win", "hearing.kaiju.win")
MAX_WORDS, MAX_WORDS_HEARING = 12, 20

# Cues that happen many times a match: at least four alternatives for each side.
FREQUENT = ("kaiju.spotted", "volley.ready", "volley.fired", "nerve.break", "building.down",
            "collateral.human", "unit.lost", "crossfire", "kaiju.roar")
# Cues the simulation raises about one squad (shared/src/sim/systems/voice.ts passes the squad).
# The game then only uses that squad's own lines, or Overlord's for a squad without a voice, so
# every radio voice needs this many lines of its own or the same sentence comes round at once.
OWN_LINES = {"volley.ready": 3, "volley.fired": 3, "crossfire": 2, "nerve.break": 2, "unit.lost": 2,
             "kaiju.spotted": 2, "collateral.human": 2}
# Cues that come round every minute or so: at least three alternatives for each side.
REPEATING = ("stagger.end", "kaiju.brace", "kaiju.lost", "kaiju.special")
# Cues whose squad cannot be the one talking (it has just been wiped out).
NOT_BY_SQUADS = ("squad.wiped",)

# Words whose pronunciation depends on their meaning: a synthesizer has to guess.
HETERONYMS = set("""live lives lead leads read reads wind winds winding wound wounds tear tears bow bows
row rows close closer record records object objects present presents desert deserts refuse resume
resumes content contents contract conduct project projects produce subject subjects separate invalid
entrance dove sow bass use uses excuse house abuse perfect permit permits progress rebel suspect
transfer transport increase decrease insert estimate moderate graduate duplicate alternate
appropriate deliberate associate advocate elaborate attribute combine compound compress console
contest convert convict defect digest discharge escort export extract import incense insult intern
misuse recall refund reject relay segment survey torment upset polish""".split())


def cue_ids() -> list[str]:
    """The cue ids of the contract, read from shared/src/defs/voice.ts (VOICE_CUE_IDS)."""
    src = VOICE_TS.read_text()
    block = src[src.index("export const VOICE_CUE_IDS"):]
    block = block[: block.index("] as const")]
    return re.findall(r"'([a-z0-9.]+)'", block)


def words_of(text: str) -> list[str]:
    return re.findall(r"[A-Za-z]+", text)


def check(lines: list[dict], dictionary: set[str] | None = None) -> tuple[list[str], list[str]]:
    """Returns (errors, warnings). `dictionary`: the recognizer's known words; a word that is
    not in it cannot be checked by speech recognition and is an error."""
    errors: list[str] = []
    warnings: list[str] = []
    cues = cue_ids()
    ids: set[str] = set()
    texts: dict[str, str] = {}
    by_cue: dict[str, list[dict]] = defaultdict(list)
    for n, l in enumerate(lines):
        if list(l.keys()) != KEYS:
            errors.append(f"entry {n}: keys {list(l.keys())}, expected {KEYS}")
            continue
        i = l["id"]
        for k in KEYS:
            if not isinstance(l[k], str) or not l[k].strip() or l[k] != l[k].strip():
                errors.append(f"{i}: field {k} is empty or padded")
        if i in ids:
            errors.append(f"{i}: duplicate id")
        ids.add(i)
        if l["cue"] not in cues:
            errors.append(f"{i}: unknown cue {l['cue']}")
            continue
        if l["speaker"] not in CAST:
            errors.append(f"{i}: unknown speaker {l['speaker']}")
        elif CAST[l["speaker"]] != l["audience"]:
            errors.append(f"{i}: {l['speaker']} speaks to {CAST[l['speaker']]}, not to {l['audience']}")
        m = re.fullmatch(r"v_(.+)_(\d+)", i)
        if not m or m.group(1) != l["cue"].replace(".", "_"):
            errors.append(f"{i}: the id must be v_<cue with underscores>_<number>")
        by_cue[l["cue"]].append(l)
        t = l["text"]
        if t in texts:
            errors.append(f"{i}: same text as {texts[t]}")
        texts[t] = i
        if not re.fullmatch(r"[A-Za-z ,.]+", t):
            errors.append(f"{i}: only letters, spaces, commas and periods are allowed: {t!r}")
        if not t.endswith(".") or "  " in t or " ." in t or " ," in t or ".." in t:
            errors.append(f"{i}: punctuation: {t!r}")
        for s in [s.strip() for s in t.split(".") if s.strip()]:
            if not s[0].isupper():
                errors.append(f"{i}: a sentence does not start with a capital: {s!r}")
        ws = words_of(t)
        limit = MAX_WORDS_HEARING if l["cue"] in HEARING else MAX_WORDS
        if len(ws) > limit:
            errors.append(f"{i}: {len(ws)} words, the limit is {limit}")
        for w in ws:
            lw = w.lower()
            if dictionary is not None and lw not in dictionary:
                errors.append(f"{i}: {w!r} is not in the pronouncing dictionary")
            if lw in HETERONYMS:
                errors.append(f"{i}: {w!r} can be said two ways")
            if len(w) > 1 and w.isupper():
                errors.append(f"{i}: {w!r} is all capitals and would be spelled out")

    for cue in cues:
        ls = by_cue.get(cue, [])
        if not ls:
            errors.append(f"{cue}: no lines")
            continue
        nums = [int(l["id"].rsplit("_", 1)[1]) for l in ls]
        if nums != list(range(1, len(ls) + 1)):
            errors.append(f"{cue}: lines must be numbered 1..n in file order, found {nums}")
        side = Counter(l["audience"] for l in ls)
        voice = Counter(l["speaker"] for l in ls)
        if cue in HEARING:
            if side["all"] < 3 or len(ls) != side["all"]:
                errors.append(f"{cue}: needs at least 3 lines, all for everyone")
            continue
        if side["humans"] < 2:
            errors.append(f"{cue}: {side['humans']} lines for the humans, at least 2 are needed")
        if cue != "player.takeover" and side["kaiju"] < 2:
            errors.append(f"{cue}: {side['kaiju']} lines for the kaiju player, at least 2 are needed")
        if cue in FREQUENT and (side["humans"] < 4 or side["kaiju"] < 4):
            errors.append(f"{cue}: a frequent cue needs 4 lines per side "
                          f"(humans {side['humans']}, kaiju {side['kaiju']})")
        if cue in REPEATING and (side["humans"] < 3 or side["kaiju"] < 3):
            errors.append(f"{cue}: a repeating cue needs 3 lines per side "
                          f"(humans {side['humans']}, kaiju {side['kaiju']})")
        if cue in OWN_LINES:
            for v in RADIO_VOICES:
                if voice[v] < OWN_LINES[cue]:
                    errors.append(f"{cue}: {v} has {voice[v]} lines of its own, {OWN_LINES[cue]} are needed "
                                  f"(the game only uses a squad's own lines, or Overlord's)")
        if cue in NOT_BY_SQUADS:
            for v in SQUAD_VOICES:
                if voice[v]:
                    errors.append(f"{cue}: {v} cannot speak here; the squad the cue is about is gone")
        elif voice["Overlord"] == 0:
            warnings.append(f"{cue}: no Overlord line; a squad without a voice of its own has nothing neutral")
    order = []
    for l in lines:
        if l["cue"] not in order:
            order.append(l["cue"])
    if order != [c for c in cues if c in by_cue]:
        warnings.append("the cues are not in the order of VOICE_CUE_IDS")
    b = [l["audience"] for l in by_cue.get("match.briefing", [])]
    if b != sorted(b, key=["humans", "kaiju", "all"].index):
        errors.append(f"match.briefing: the lines of one side must be together and in order, found {b}")
    return errors, warnings
