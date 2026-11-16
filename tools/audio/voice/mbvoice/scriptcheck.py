"""Checks the voice script against the rules it is written to (docs/VOICE_SCRIPT.md, "Rules for
writing new lines"). Since round 4 the script has two parts:

- the simulation's cue lines (shared/src/defs/voiceLines.json, schema in docs/ASSETS.md section
  6): only the news telling the monster's player it can molt is left, calm and in full sentences;
- the communication rose's army lines (client/src/audio/roseLines.json): for every wedge of the
  army's rose (shared/src/net/rose.ts, ROSE_ARMY) four to six one-sentence lines, shouted, each
  spoken in every squad voice.

The build refuses to run on a script that breaks a rule."""

from __future__ import annotations

import re

from . import ROSE_TS

KEYS = ["id", "cue", "audience", "speaker", "text"]
# who speaks to whom
CAST = {"Anchor": "kaiju", "Granite": "humans", "Beacon": "humans", "Tempest": "humans", "Anvil": "humans"}
SQUAD_VOICES = ("Granite", "Beacon", "Tempest", "Anvil")
# the cue lines the game still plays, and how many each needs at least
CUE_LINES = {"molt.available": 1}
MAX_WORDS = 12
ROSE_MIN, ROSE_MAX = 4, 6

# Words whose pronunciation depends on their meaning: a synthesizer has to guess.
HETERONYMS = set("""live lives lead leads read reads wind winds winding wound wounds tear tears bow bows
row rows close closer record records object objects present presents desert deserts refuse resume
resumes content contents contract conduct project projects produce subject subjects separate invalid
entrance dove sow bass use uses excuse house abuse perfect permit permits progress rebel suspect
transfer transport increase decrease insert estimate moderate graduate duplicate alternate
appropriate deliberate associate advocate elaborate attribute combine compound compress console
contest convert convict defect digest discharge escort export extract import incense insult intern
misuse recall refund reject relay segment survey torment upset polish""".split())


def rose_wedges() -> list[str]:
    """The army's wedges in wire order, read from shared/src/net/rose.ts (ROSE_ARMY)."""
    src = ROSE_TS.read_text()
    block = src[src.index("export const ROSE_ARMY"):]
    block = block[: block.index("] as const")]
    return re.findall(r"'([a-zA-Z]+)'", block)


def words_of(text: str) -> list[str]:
    return re.findall(r"[A-Za-z]+", text)


def _text_rules(i: str, t: str, shouted: bool, dictionary: set[str] | None, errors: list[str]) -> None:
    end = "!" if shouted else "."
    if not re.fullmatch(r"[A-Za-z ,.!]+", t):
        errors.append(f"{i}: only letters, spaces, commas, periods and exclamation marks are allowed: {t!r}")
    if not t.endswith(end) or "  " in t or " ." in t or " ," in t or " !" in t or ".." in t or "!!" in t:
        errors.append(f"{i}: punctuation (it ends with one {end!r}): {t!r}")
    sentences = [s.strip() for s in re.split(r"[.!]", t) if s.strip()]
    if shouted and len(sentences) != 1:
        errors.append(f"{i}: a rose line is one sentence: {t!r}")
    for s in sentences:
        if not s[0].isupper():
            errors.append(f"{i}: a sentence does not start with a capital: {s!r}")
    ws = words_of(t)
    if len(ws) > MAX_WORDS:
        errors.append(f"{i}: {len(ws)} words, the limit is {MAX_WORDS}")
    for w in ws:
        lw = w.lower()
        if dictionary is not None and lw not in dictionary:
            errors.append(f"{i}: {w!r} is not in the pronouncing dictionary")
        if lw in HETERONYMS:
            errors.append(f"{i}: {w!r} can be said two ways")
        if len(w) > 1 and w.isupper():
            errors.append(f"{i}: {w!r} is all capitals and would be spelled out")


def check(lines: list[dict], dictionary: set[str] | None = None) -> tuple[list[str], list[str]]:
    """Returns (errors, warnings). `dictionary`: the recognizer's known words; a word that is
    not in it cannot be checked by speech recognition and is an error."""
    errors: list[str] = []
    warnings: list[str] = []
    wedges = rose_wedges()
    ids: set[str] = set()
    texts: dict[tuple[str, str], str] = {}
    per_wedge: dict[tuple[str, str], int] = {}
    cue_count: dict[str, int] = {}
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
        if l["speaker"] not in CAST:
            errors.append(f"{i}: unknown speaker {l['speaker']}")
        elif CAST[l["speaker"]] != l["audience"]:
            errors.append(f"{i}: {l['speaker']} speaks to {CAST[l['speaker']]}, not to {l['audience']}")
        rose = l["cue"].startswith("rose.")
        if rose:
            wedge = l["cue"][5:]
            if wedge not in wedges:
                errors.append(f"{i}: {wedge!r} is not a wedge of the army's rose (shared/src/net/rose.ts)")
            if l["speaker"] not in SQUAD_VOICES:
                errors.append(f"{i}: a rose line is spoken by a squad voice, not {l['speaker']}")
            m = re.fullmatch(r"rose_([a-z]+)_([a-zA-Z]+)_(\d+)", i)
            if not m or m.group(1) != l["speaker"].lower() or m.group(2) != wedge:
                errors.append(f"{i}: the id must be rose_<voice>_<wedge>_<number>")
            key = (l["speaker"], wedge)
            per_wedge[key] = per_wedge.get(key, 0) + 1
        else:
            if l["cue"] not in CUE_LINES:
                errors.append(f"{i}: the game plays no line for the cue {l['cue']} any more")
            m = re.fullmatch(r"v_(.+)_(\d+)", i)
            if not m or m.group(1) != l["cue"].replace(".", "_"):
                errors.append(f"{i}: the id must be v_<cue with underscores>_<number>")
            cue_count[l["cue"]] = cue_count.get(l["cue"], 0) + 1
        t = l["text"]
        key2 = (l["speaker"], t)
        if key2 in texts:
            errors.append(f"{i}: same text as {texts[key2]}")
        texts[key2] = i
        _text_rules(i, t, rose, dictionary, errors)

    for cue, least in CUE_LINES.items():
        if cue_count.get(cue, 0) < least:
            errors.append(f"{cue}: needs at least {least} line(s)")
    for voice in SQUAD_VOICES:
        for wedge in wedges:
            count = per_wedge.get((voice, wedge), 0)
            if not ROSE_MIN <= count <= ROSE_MAX:
                errors.append(f"rose {wedge} ({voice}): {count} lines, {ROSE_MIN} to {ROSE_MAX} are wanted")
    return errors, warnings
