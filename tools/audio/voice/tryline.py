#!/opt/mbtools/venv/bin/python
"""Audition candidate wordings before they go into the script.

  tryline.py <Speaker> "candidate text" ["another candidate" ..]
  tryline.py --cue nerve.break Overlord "An order." ..     (spoken as an order: the order speed)
  tryline.py --file candidates.json [--jobs 2] [--seeds 3] [--json out.json]

Speaks each candidate with the speaker's own voice and chain (cast.json), exactly as the build
would, and prints how long the finished clip is and what the speech recognizer (pocketsphinx)
hears in the unprocessed speech and in the finished clip. The static, crackle and room of a chain
are random per line id, so each candidate is finished with several seeds (default 3) and the
errors are added up: a wording is only as good as its worst draw. Nothing is written to the
repository.

candidates.json is a list of { "speaker": "Granite", "tag": "anything", "texts": ["..", ".."] }
(optionally with "cue").

Use it when writing or rewording lines: prefer the candidate with no errors in the unprocessed
speech and the fewest in the finished clip, and check the length against the window the line
announces (docs/VOICE_SCRIPT.md, "Rules for writing new lines")."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from multiprocessing import Pool
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from mbvoice import SR, asr  # noqa: E402
from mbvoice.chains import apply_chain  # noqa: E402
from mbvoice.pipeline import line_plan, master, raw_speech  # noqa: E402
from mbvoice.script import load_cast  # noqa: E402

_CAST = None


def trial(job: tuple[str, str, str, int, str | None]) -> dict:
    global _CAST
    speaker, tag, text, seeds, cue = job
    if _CAST is None:
        _CAST = load_cast()
    line = {"id": "try_" + hashlib.sha256(f"{speaker}|{text}".encode()).hexdigest()[:10],
            "speaker": speaker, "text": text}
    if cue:                               # e.g. nerve.break: spoken as an order, if the speaker has an order speed
        line.update(cue=cue, audience="humans")
    plan = line_plan(line, _CAST, {"words": {}, "lines": {}})
    raw = raw_speech(text, plan["voice"], plan["max_pause_ms"], plan["min_pause_ms"])
    h_raw = asr.transcribe(raw, SR)
    e_raw, words = asr.word_errors(text, h_raw)
    finished = []
    seconds = 0.0
    for k in range(seeds):
        seed = int.from_bytes(hashlib.sha256(f"{line['id']}#{k}".encode()).digest()[:8], "little")
        y, _ = apply_chain(plan["chain"], raw, plan["chain_cfg"], np.random.default_rng(seed))
        y = master(y)
        seconds = len(y) / SR
        h = asr.transcribe(y, SR)
        finished.append({"errors": asr.word_errors(text, h)[0], "hyp": h})
    return {"speaker": speaker, "tag": tag, "text": text, "words": words, "seconds": round(seconds, 2),
            "raw_errors": e_raw, "raw_hyp": h_raw,
            "finished_errors": [f["errors"] for f in finished],
            "finished_hyp": [f["hyp"] for f in finished]}


def main() -> int:
    ap = argparse.ArgumentParser(description="Audition candidate wordings for voice lines.")
    ap.add_argument("speaker", nargs="?")
    ap.add_argument("texts", nargs="*")
    ap.add_argument("--file", help="JSON list of {speaker, tag, texts}")
    ap.add_argument("--jobs", type=int, default=2)
    ap.add_argument("--seeds", type=int, default=3, help="noise draws per candidate (default 3)")
    ap.add_argument("--json", help="also write the results to this file")
    ap.add_argument("--cue", help="the cue the line is for (nerve.break and kaiju.special lines of the humans are "
                                  "orders, spoken at the speaker's order speed from cast.json)")
    args = ap.parse_args()
    jobs = []
    if args.file:
        for group in json.loads(Path(args.file).read_text()):
            for text in group["texts"]:
                jobs.append((group["speaker"], group.get("tag", ""), text, args.seeds, group.get("cue", args.cue)))
    elif args.speaker and args.texts:
        jobs = [(args.speaker, "", t, args.seeds, args.cue) for t in args.texts]
    else:
        ap.error("give a speaker and candidate texts, or --file")
    from mbvoice.synth import split_threads
    split_threads(args.jobs)
    with Pool(max(1, args.jobs)) as pool:
        results = pool.map(trial, jobs)
    last = None
    for r in results:
        head = (r["speaker"], r["tag"])
        if head != last:
            print(f"\n== {r['speaker']}  {r['tag']}")
            last = head
        fin = "+".join(str(e) for e in r["finished_errors"])
        print(f"  {r['seconds']:5.2f} s  {r['words']:2d} words  unprocessed {r['raw_errors']}  finished {fin}"
              f"  | {r['text']}")
        if r["raw_errors"]:
            print(f"        unprocessed heard: {r['raw_hyp']}")
        worst = int(np.argmax(r["finished_errors"]))
        if r["finished_errors"][worst]:
            print(f"        finished heard:    {r['finished_hyp'][worst]}")
    if args.json:
        Path(args.json).write_text(json.dumps(results, indent=1) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
