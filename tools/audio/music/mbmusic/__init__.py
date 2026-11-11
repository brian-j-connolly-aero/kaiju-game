"""Monster Battle 9001 soundtrack: the music is written as code.

score.py      note notation, parts, MIDI export
orchestra.py  the instruments (General MIDI programs, ranges, seating, mix defaults)
theme.py      the main theme and its harmony, shared by every cue
cues/         one module per cue (or per stage: base and combat stems)
synth.py      renders one part at a time with fluidsynth
dsp.py        hall reverb, filters, loop folding, limiter, loudness
mixdown.py    parts -> stems -> mastered loop or one-shot -> .ogg and .mp3
review.py     composer's score review (ranges, low intervals, density)
analyze.py    engineer's verification (loudness, peaks, loop seams, spectrograms)
"""
