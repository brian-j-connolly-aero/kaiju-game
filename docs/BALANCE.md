# Monster Battle 9001: Balance

How the numbers in `shared/src/defs/` were tuned, what the balance harness measured before and
after, and why each number moved. Read this before changing a combat or pacing number, and add
to it when you do.

## 1. The instrument

`npm run sim` plays full matches between the kaiju bot and four squad bots, headless, a few
hundred times faster than real time, and prints one row per match and a summary
(`shared/scripts/sim.ts`; the match runner and its report are `shared/scripts/botMatch.ts`).

```
npm run sim -- --seeds 20                      # 20 matches, seeds 1 to 20
npm run sim -- --seeds 20 --seed 21            # the next 20
npm run sim -- --seeds 10 --unopposed          # no squads: how fast a kaiju fills the bar alone
npm run sim -- --seeds 10 --kaiju-handicap 0.3 # the kaiju bot hesitates 30% of the time
npm run sim -- --seeds 10 --human-handicap 0.3 # the same for the squads
npm run sim -- --seeds 20 --trigger-happy      # squads that hold the trigger instead of charging volleys
npm run sim -- --seeds 20 --no-crates          # no army supply crates (phase 2): what the pick-ups are worth
npm run sim -- --seeds 8 --fast                # the short MB_FAST timers and bar
npm run sim -- --seeds 3 --events --json       # event counts; reports as JSON
npm run sim -- --seeds 20 --every-anchor       # match i starts at anchor i mod 10: every start equally often
npm run sim -- --seeds 20 --nav                # also how the bots got about (stuck, wading, the bay, hanging back)
npm run sim -- --seeds 20 --bar 0.145,0.11,0.30 # try other bar fractions for this run only
npm run sim -- --seeds 20 --clock 576          # try another match clock (seconds) for this run only
npm run sim -- --seeds 5 --city placeholder    # the old grid city (a development option)
```

The harness plays in Port Meridian, the game's city, since the city switch (section 8). Every
table before section 8 was measured in the placeholder grid city and is history.

Columns: winner and why, match length, time per stage, kaiju nerve breaks (staggers) per stage,
units lost per stage, the bar at the end of each stage (as a percentage of the skyline, where
the three marks sit at 21, 57 and 100), kaiju health lost per stage. The summary adds, per
stage, how long the kaiju took to fill its segment, volleys, healing and the squads' collateral.

"Volleys" counts charged volleys only (sub-units fired with at least 60% charge); a trigger
pulled on less is ragged fire and is not counted.

The harness is deterministic: the same seed and the same code give the same match
(`shared/test/determinism.test.ts`; the tables in section 4 were run twice and came out
identical). A change to any number reshuffles every match, so compare
summaries over 20 seeds or more, never single rows. With 20 matches a win rate carries about
plus or minus 11 points of noise; the three batches in section 4 show it.

## 2. Targets (DESIGN.md section 2)

| Target | Measured with |
| --- | --- |
| A kaiju left alone fills a stage's segment of the bar in 100 to 130 s (stage 3 is allowed more since the second pass: sections 7 and 8) | `--unopposed`, "segment filled after" |
| A contested stage lasts roughly 200 to 230 s | default run, "stage time when completed" |
| A match ends in 10 to 12 minutes | default run, "mean match length" |
| Neither side wins more than about 65% with equal bots, over about 20 seeds | default run |
| Scattered fire alone rarely kills; coordinated volleys do | health lost in and out of staggers; kills |
| Undisciplined fire is clearly worse than charged, coordinated volleys at breaking the kaiju's nerve | `--trigger-happy` against the default run: staggers, wins |

Since phase 1 (section 9) the owner wants every stage about a fifth shorter than section 8
measured: contested stages near 2:35, 2:30 and 3:05, matches near 8:15, a 9:36 clock. Phase 2
(section 10) was held to within about a tenth of where phase 1 left the stages, and phase 3
(section 11) to within about a tenth of where phase 2 left them (2:01, 2:35 and 3:06; about 8
minutes a match), with something new happening to the monster and to each squad about every 20
to 25 seconds at every stage.

## 3. Before

The design's starting numbers, with the finished bots. 20 matches, seeds 1 to 20:

```
20 bot matches
seed  start         winner          length          stage time    staggers  units lost  bar % at stage end      kaiju hp lost
----  ------------  --------------  ------  ------------------  ----------  ----------  ------------------  -----------------
1     Gull Point    humans (kill)    10:03  2:57 / 5:45 / 1:21   2 / 3 / 3   4 / 6 / 0        21 / 57 / 84  1058 / 991 / 1313
2     Harrow Lane   humans (kill)    10:50  3:20 / 6:11 / 1:19   1 / 3 / 3   1 / 9 / 1        21 / 57 / 85   978 / 941 / 1303
3     Bellhaven     humans (kill)     8:52     7:29 / 1:23 / -   2 / 4 / -   6 / 0 / -         21 / 24 / -     774 / 1145 / -
4     Dovecote      humans (kill)     3:52        3:52 / - / -   3 / - / -   3 / - / -          13 / - / -       1062 / - / -
5     Cinder Flats  humans (kill)     5:33     4:05 / 1:28 / -   0 / 3 / -   3 / 0 / -         21 / 24 / -     830 / 1147 / -
6     Easter Green  humans (kill)     6:11        6:11 / - / -   2 / - / -   7 / - / -          21 / - / -       1240 / - / -
7     Cinder Flats  humans (kill)     2:57        2:57 / - / -   3 / - / -   5 / - / -          18 / - / -       1077 / - / -
8     Alder Row     humans (kill)     4:03        4:03 / - / -   4 / - / -   4 / - / -          21 / - / -       1236 / - / -
9     Ivy Court     humans (kill)     8:33     5:04 / 3:30 / -   1 / 8 / -   6 / 3 / -         21 / 27 / -     599 / 1799 / -
10    Bellhaven     humans (kill)     9:38     8:53 / 0:45 / -   1 / 3 / -   9 / 0 / -         21 / 22 / -     586 / 1069 / -
11    Dovecote      humans (clock)   12:00  4:48 / 6:43 / 0:29   0 / 1 / 1  2 / 12 / 0        21 / 57 / 71     136 / 237 / 34
12    Easter Green  humans (kill)     8:14     5:29 / 2:44 / -   2 / 6 / -   3 / 4 / -         21 / 28 / -    1309 / 1303 / -
13    Alder Row     humans (kill)     3:20        3:20 / - / -   0 / - / -   0 / - / -          21 / - / -        999 / - / -
14    Fennel Hill   humans (kill)    10:38     4:08 / 6:30 / -  1 / 11 / -   4 / 7 / -         21 / 50 / -     470 / 2591 / -
15    Bellhaven     humans (kill)    10:21     7:55 / 2:26 / -   2 / 6 / -   9 / 5 / -         21 / 26 / -    1032 / 1479 / -
16    Dovecote      humans (clock)   12:00  4:47 / 5:41 / 1:32   0 / 1 / 3   3 / 5 / 1        21 / 57 / 90    283 / 445 / 955
17    Juniper Bay   humans (clock)   12:00     2:54 / 9:06 / -   0 / 4 / -   6 / 8 / -         21 / 53 / -       50 / 858 / -
18    Harrow Lane   humans (kill)     5:49     5:05 / 0:44 / -   0 / 3 / -   9 / 1 / -         21 / 22 / -      77 / 1058 / -
19    Alder Row     humans (kill)     8:21     4:06 / 4:15 / -   1 / 6 / -   5 / 2 / -         21 / 45 / -     494 / 1474 / -
20    Dovecote      humans (kill)     5:47     4:50 / 0:57 / -   2 / 3 / -   4 / 0 / -         21 / 23 / -     962 / 1156 / -

kaiju wins 0/20 (0%)   human wins 20 (100%): 17 by kill, 3 by the clock
mean match length 7:57   shortest 2:57   longest 12:00
stage 1: reached 20, completed 15, mean time when completed 5:03, molt offered after 4:43; per match: staggers 1.4, volleys 71.6, units lost 4.7, kaiju hp lost 763 (healed 136), collateral 362 points
stage 2: reached 15, completed 4, mean time when completed 6:05, molt offered after 5:49; per match: staggers 4.3, volleys 61.8, units lost 4.1, kaiju hp lost 1179 (healed 389), collateral 731 points
stage 3: reached 4, completed 0, mean time when completed 0:00, molt offered after 0:00; per match: staggers 2.5, volleys 4.0, units lost 0.5, kaiju hp lost 902 (healed 240), collateral 650 points
voice: 12.8 cues per minute, at most 8 in any 10 s   simulated 296835 ticks in 19.4 s (510x real time)
```

And the kaiju alone (`--unopposed`, seeds 1 to 10):

```
10 bot matches [unopposed]
seed  start         winner          length          stage time   staggers  units lost  bar % at stage end  kaiju hp lost
----  ------------  --------------  ------  ------------------  ---------  ----------  ------------------  -------------
1     Gull Point    humans (clock)   12:00  4:57 / 5:43 / 1:21  0 / 0 / 0   0 / 0 / 0        21 / 57 / 96      0 / 0 / 0
2     Harrow Lane   humans (clock)   12:00  4:35 / 5:49 / 1:36  0 / 0 / 0   0 / 0 / 0        21 / 57 / 98      0 / 0 / 0
3     Bellhaven     humans (clock)   12:00     8:40 / 3:20 / -  0 / 0 / -   0 / 0 / -         21 / 33 / -      0 / 0 / -
4     Dovecote      humans (clock)   12:00  6:13 / 5:33 / 0:14  0 / 0 / 0   0 / 0 / 0        21 / 57 / 64      0 / 0 / 0
5     Cinder Flats  humans (clock)   12:00  4:39 / 6:09 / 1:12  0 / 0 / 0   0 / 0 / 0        21 / 57 / 88      0 / 0 / 0
6     Easter Green  humans (clock)   12:00     6:27 / 5:33 / -  0 / 0 / -   0 / 0 / -         21 / 48 / -      0 / 0 / -
7     Cinder Flats  humans (clock)   12:00  4:39 / 6:09 / 1:12  0 / 0 / 0   0 / 0 / 0        21 / 57 / 88      0 / 0 / 0
8     Alder Row     kaiju (bar)      11:32  4:34 / 5:07 / 1:51  0 / 0 / 0   0 / 0 / 0       21 / 57 / 100      0 / 0 / 0
9     Ivy Court     humans (clock)   12:00     6:49 / 5:11 / -  0 / 0 / -   0 / 0 / -         21 / 41 / -      0 / 0 / -
10    Bellhaven     humans (clock)   12:00     8:40 / 3:20 / -  0 / 0 / -   0 / 0 / -         21 / 33 / -      0 / 0 / -

kaiju wins 1/10 (10%)   human wins 9 (90%): 0 by kill, 9 by the clock
mean match length 11:57   shortest 11:32   longest 12:00
stage 1: reached 10, completed 10, mean time when completed 6:01, molt offered after 5:50; per match: staggers 0.0, volleys 0.0, units lost 0.0, kaiju hp lost 0 (healed 0), collateral 0 points
stage 2: reached 10, completed 6, mean time when completed 5:45, molt offered after 5:34; per match: staggers 0.0, volleys 0.0, units lost 0.0, kaiju hp lost 0 (healed 0), collateral 0 points
stage 3: reached 6, completed 1, mean time when completed 1:51, molt offered after 0:00; per match: staggers 0.0, volleys 0.0, units lost 0.0, kaiju hp lost 0 (healed 0), collateral 0 points
voice: 6.7 cues per minute, at most 7 in any 10 s   simulated 222014 ticks in 5.3 s (1404x real time)
```

What that showed:

- **The kaiju was far too slow alone.** Filling a segment took about 5:50 at stages 1 and 2
  instead of two minutes: nine matches out of ten ran out the clock with nobody shooting.
- **And it died anyway.** With squads, 17 of 20 matches ended in a kill, most of them at
  stage 1 or 2. A stagger with four squads firing took 300 to 400 health (a third of the
  kaiju), and a cocoon caught in the open 400 more.
- **Scattered fire was already harmless**, as designed: about 0.6 health per second outside a
  stagger. Everything lethal happened in stagger windows.
- **The humans filled the bar themselves.** Stray rockets did 28 structure damage against
  80-point houses; the squads' collateral at stage 1 (362 points) was most of the segment, so
  a contested stage 1 was *shorter* than an uncontested one.

## 4. After the first pass

(History. The rules changed after this pass and the numbers were tuned again: the current
tables are in section 7.)

20 matches, seeds 1 to 20, with the numbers that were in `shared/src/defs/` at the time:

```
20 bot matches
seed  start         winner          length          stage time    staggers  units lost  bar % at stage end     kaiju hp lost
----  ------------  --------------  ------  ------------------  ----------  ----------  ------------------  ----------------
1     Gull Point    kaiju (bar)       8:35  2:29 / 2:17 / 3:50   2 / 1 / 6   3 / 5 / 2       21 / 57 / 100   337 / 181 / 845
2     Harrow Lane   humans (kill)    11:18  2:14 / 4:11 / 4:53  0 / 6 / 12   3 / 8 / 3        21 / 57 / 98   37 / 716 / 1797
3     Bellhaven     kaiju (bar)      11:23  4:39 / 2:56 / 3:47   3 / 0 / 7   3 / 0 / 2       21 / 57 / 100    523 / 82 / 883
4     Dovecote      kaiju (bar)      11:35  4:08 / 2:22 / 5:05   1 / 2 / 8   5 / 4 / 4       21 / 57 / 100  314 / 302 / 1304
5     Cinder Flats  kaiju (bar)       8:47  2:48 / 3:09 / 2:50   0 / 1 / 4   1 / 7 / 2       21 / 57 / 100    76 / 204 / 459
6     Easter Green  humans (clock)   12:00  3:43 / 3:20 / 4:56  1 / 0 / 11   6 / 0 / 3        21 / 57 / 97  269 / 196 / 1645
7     Cinder Flats  humans (clock)   12:00  2:42 / 5:39 / 3:38   0 / 8 / 8   2 / 9 / 4        21 / 57 / 94  102 / 1272 / 984
8     Alder Row     humans (kill)     8:56  1:57 / 2:44 / 4:16  0 / 0 / 11   4 / 9 / 1        21 / 57 / 94    96 / 75 / 1797
9     Ivy Court     kaiju (bar)      10:37  4:49 / 3:45 / 2:02   3 / 1 / 1   6 / 6 / 0       21 / 57 / 100   608 / 141 / 112
10    Bellhaven     humans (kill)     7:46     4:33 / 3:13 / -   1 / 9 / -   7 / 2 / -         21 / 31 / -    244 / 1555 / -
11    Dovecote      kaiju (bar)       8:07  3:20 / 2:05 / 2:41   2 / 1 / 4   0 / 0 / 1       21 / 57 / 100    584 / 73 / 405
12    Easter Green  humans (clock)   12:00  3:23 / 3:04 / 5:33  1 / 3 / 15   3 / 3 / 3        21 / 57 / 94  740 / 446 / 1821
13    Alder Row     humans (clock)   12:00  2:22 / 3:43 / 5:54   1 / 4 / 9   5 / 5 / 2        21 / 57 / 92  226 / 801 / 1567
14    Fennel Hill   kaiju (bar)      11:53  2:09 / 5:23 / 4:21   1 / 8 / 6   4 / 5 / 3       21 / 57 / 100  259 / 1168 / 714
15    Bellhaven     kaiju (bar)       9:40  4:31 / 2:49 / 2:20   3 / 0 / 1   2 / 4 / 1       21 / 57 / 100    624 / 59 / 172
16    Dovecote      kaiju (bar)       9:47  3:56 / 2:47 / 3:04   3 / 1 / 5   3 / 3 / 1       21 / 57 / 100   543 / 183 / 507
17    Juniper Bay   kaiju (bar)       8:15  2:21 / 3:44 / 2:09   0 / 3 / 2   4 / 4 / 0       21 / 57 / 100    52 / 464 / 196
18    Harrow Lane   humans (kill)     9:37  2:11 / 3:46 / 3:40   0 / 3 / 8   3 / 6 / 3        21 / 57 / 98  116 / 581 / 1399
19    Alder Row     kaiju (bar)       8:00  2:26 / 2:32 / 3:02   3 / 1 / 4   5 / 0 / 2       21 / 57 / 100   517 / 393 / 521
20    Dovecote      kaiju (bar)      11:05  3:35 / 4:14 / 3:15   3 / 5 / 5   4 / 8 / 2       21 / 57 / 100   588 / 646 / 776

kaiju wins 12/20 (60%)   human wins 8 (40%): 4 by kill, 4 by the clock
mean match length 10:10   shortest 7:46   longest 12:00
stage 1: reached 20, completed 20, segment filled after 2:51, stage time when completed 3:13; per match: staggers 1.4, volleys 41.1, units lost 3.6, kaiju hp lost 343 (healed 88), collateral 48 points
stage 2: reached 20, completed 19, segment filled after 3:01, stage time when completed 3:24; per match: staggers 2.9, volleys 42.5, units lost 4.4, kaiju hp lost 477 (healed 204), collateral 340 points
stage 3: reached 19, completed 12, segment filled after 3:12, stage time when completed 3:12; per match: staggers 6.7, volleys 45.2, units lost 2.1, kaiju hp lost 942 (healed 501), collateral 916 points
voice: 13.8 cues per minute, at most 7 in any 10 s   simulated 381370 ticks in 23.1 s (551x real time)
```

Two more batches of 20 for the noise (seeds 21 to 40, then 41 to 60):

```
kaiju wins 7/20 (35%)   human wins 13 (65%): 7 by kill, 6 by the clock
mean match length 10:22   shortest 8:10   longest 12:00
stage 1: reached 20, completed 20, segment filled after 2:38, stage time when completed 2:59; per match: staggers 1.3, volleys 36.3, units lost 4.4, kaiju hp lost 301 (healed 80), collateral 47 points
stage 2: reached 20, completed 19, segment filled after 3:13, stage time when completed 3:35; per match: staggers 3.3, volleys 52.8, units lost 5.0, kaiju hp lost 566 (healed 240), collateral 362 points
stage 3: reached 19, completed 7, segment filled after 3:37, stage time when completed 3:37; per match: staggers 7.5, volleys 52.9, units lost 2.6, kaiju hp lost 1154 (healed 547), collateral 1013 points
voice: 14.0 cues per minute, at most 8 in any 10 s   simulated 388456 ticks in 21.8 s (595x real time)
```

```
kaiju wins 12/20 (60%)   human wins 8 (40%): 6 by kill, 2 by the clock
mean match length 9:53   shortest 6:48   longest 12:00
stage 1: reached 20, completed 20, segment filled after 2:38, stage time when completed 3:00; per match: staggers 1.6, volleys 43.0, units lost 3.3, kaiju hp lost 387 (healed 80), collateral 47 points
stage 2: reached 20, completed 19, segment filled after 2:58, stage time when completed 3:19; per match: staggers 2.9, volleys 43.9, units lost 4.8, kaiju hp lost 482 (healed 208), collateral 342 points
stage 3: reached 19, completed 12, segment filled after 3:33, stage time when completed 3:33; per match: staggers 6.9, volleys 44.2, units lost 2.3, kaiju hp lost 970 (healed 484), collateral 913 points
voice: 14.0 cues per minute, at most 7 in any 10 s   simulated 370963 ticks in 20.9 s (591x real time)
```

And the kaiju alone (`--unopposed`, seeds 1 to 10):

```
10 bot matches [unopposed]
seed  start         winner       length          stage time   staggers  units lost  bar % at stage end  kaiju hp lost
----  ------------  -----------  ------  ------------------  ---------  ----------  ------------------  -------------
1     Gull Point    kaiju (bar)    5:43  1:45 / 1:55 / 2:03  0 / 0 / 0   0 / 0 / 0       21 / 57 / 100      0 / 0 / 0
2     Harrow Lane   kaiju (bar)    6:15  1:50 / 2:02 / 2:22  0 / 0 / 0   0 / 0 / 0       21 / 57 / 100      0 / 0 / 0
3     Bellhaven     kaiju (bar)    7:42  3:24 / 2:21 / 1:58  0 / 0 / 0   0 / 0 / 0       21 / 57 / 100      0 / 0 / 0
4     Dovecote      kaiju (bar)    6:12  2:21 / 2:06 / 1:44  0 / 0 / 0   0 / 0 / 0       21 / 57 / 100      0 / 0 / 0
5     Cinder Flats  kaiju (bar)    5:45  1:44 / 2:06 / 1:55  0 / 0 / 0   0 / 0 / 0       21 / 57 / 100      0 / 0 / 0
6     Easter Green  kaiju (bar)    6:47  2:32 / 2:09 / 2:07  0 / 0 / 0   0 / 0 / 0       21 / 57 / 100      0 / 0 / 0
7     Cinder Flats  kaiju (bar)    5:45  1:44 / 2:06 / 1:55  0 / 0 / 0   0 / 0 / 0       21 / 57 / 100      0 / 0 / 0
8     Alder Row     kaiju (bar)    6:20  1:44 / 2:24 / 2:12  0 / 0 / 0   0 / 0 / 0       21 / 57 / 100      0 / 0 / 0
9     Ivy Court     kaiju (bar)    7:42  2:36 / 3:18 / 1:48  0 / 0 / 0   0 / 0 / 0       21 / 57 / 100      0 / 0 / 0
10    Bellhaven     kaiju (bar)    7:42  3:24 / 2:21 / 1:58  0 / 0 / 0   0 / 0 / 0       21 / 57 / 100      0 / 0 / 0

kaiju wins 10/10 (100%)   human wins 0 (0%): 0 by kill, 0 by the clock
mean match length 6:35   shortest 5:43   longest 7:42
stage 1: reached 10, completed 10, segment filled after 2:07, stage time when completed 2:18; per match: staggers 0.0, volleys 0.0, units lost 0.0, kaiju hp lost 0 (healed 0), collateral 0 points
stage 2: reached 10, completed 10, segment filled after 2:06, stage time when completed 2:17; per match: staggers 0.0, volleys 0.0, units lost 0.0, kaiju hp lost 0 (healed 0), collateral 0 points
stage 3: reached 10, completed 10, segment filled after 2:00, stage time when completed 2:00; per match: staggers 0.0, volleys 0.0, units lost 0.0, kaiju hp lost 0 (healed 0), collateral 0 points
voice: 8.2 cues per minute, at most 4 in any 10 s   simulated 126440 ticks in 2.0 s (2068x real time)
```

Against the targets, over the 60 contested matches and the 10 uncontested ones:

| Target | Result |
| --- | --- |
| Alone, a segment in 100 to 130 s | 2:07 / 2:06 / 2:00 (127, 126, 120 s). In range. Start areas with apartment blocks (Bellhaven, Ivy Court) take longer at stage 1 (3:24, 2:36): a hatchling cannot bring those down, yet they count toward the mark. |
| Contested stage 200 to 230 s | Stage 1: 3:00 to 3:13. Stage 2: 3:19 to 3:35. Stage 3: 3:12 to 3:37. Stages 2 and 3 are in range; stage 1 runs 10 to 20 s short. |
| Match 10 to 12 minutes | Mean 9:53 to 10:22 per batch (10:08 overall). The kaiju's 31 wins come between 8:00 and 11:53 (mean 9:40), the 12 clock wins at 12:00, the 17 kills between 6:48 and 11:46. |
| Neither side above about 65% | Kaiju 31 of 60 (52%): 60%, 35% and 60% in the three batches. |
| Scattered fire rarely kills, coordinated volleys do | 17 kills in 60 matches: 14 at stage 3 and 3 at stage 2, every one after 8 to 15 staggers in that stage. Fire outside a stagger costs the kaiju about 1 health per second. |

Sensitivity, 10 matches each: a kaiju bot that hesitates 30% of the time wins 0 of 10
(`kaiju wins 0/10 (0%)   human wins 10 (100%): 4 by kill, 6 by the clock`); squads that hesitate 30% of the time win 0 of 10
(`kaiju wins 10/10 (100%)   human wins 0 (0%): 0 by kill, 0 by the clock`). With no rubber banding, skill decides: the balance above is for equal play.

## 5. What changed in the first pass, and why

| Number (file) | Before | After | Why |
| --- | --- | --- | --- |
| Bar mark fractions `p1 / p2 / p3` (`defs/rules.ts`) | 0.35 / 0.30 / 0.30 | 0.13 / 0.088 / 0.31 | The pace knob. A hatchling wrecks about 2 points a second (two swipes a house), a juvenile about 15 to 25, a titan about 200. The fractions were set so that each segment is about two minutes of that. |
| Stray rocket structure damage (`defs/weapons.ts`) | 28 | 3 | Rockets at a hatchling among houses mostly miss it. At 28 the squads did the kaiju's work for it. At 3 a whole missed salvo still dents a house, and collateral at stage 1 is about a fifth of the segment: a real cost, not the main source. |
| Stray shell structure damage, tank and troop guns | 120 | 25 | The same at stages 2 and 3. Most of what is left of stage 2 collateral (about 340 points, a quarter of the segment) is tanks driving over parked cars. |
| Staggered or cocooned damage multiplier, `helplessMult` (`defs/kaiju/lizard.ts`) | 1.0 | 0.5 | At 1.0 one stagger with four squads firing was a third of the kaiju's health and two were usually fatal. At 0.5 a stagger costs 10 to 20%: still four times what it shrugs off (0.12), enough that six or more staggers in a stage kill, not enough that two do. |
| Kaiju nerve leak per second | 9 | 7.5 | With less nerve per hit (below) two squads' volleys a second or two apart should still add up. |
| Nerve immunity after a stagger (`defs/rules.ts`) | 6 s | 8 s | Four squads with clear lines could break a titan again four seconds after its immunity ran out: six staggers in 90 s, never able to eat or move. Eight seconds leaves room to act between staggers. |
| Rocket nerve | 1.5 | 1.8 | Staggers at stage 1 were rare (a hatchling is hard to keep in the sights). Kept low enough that one squad cannot break the kaiju alone: a full-charge volley is 54 nerve from the front, 92 from behind, 92 as a one-player crossfire. `shared/test/defs.test.ts` holds that line. |
| Tank shell nerve | 4.5 | 5.4 | The same rule for the tank platoon (54 / 92 / 92). |
| Tank troop shell nerve | 1.5 | 1.6 | A titan cannot hide, so troops need the least help (48 / 82 / 82). |
| Artillery shell damage / nerve (`defs/callins.ts`) | 14 / 10 | 9 / 5 | A titan wrecking downtown stands still, so most of 8 shells land. Four squads' barrages at 10 nerve a shell kept it staggered by themselves, from anywhere on the map. At 5 a barrage is half a stagger: a set-up for a volley, not a replacement. |
| Squad deployment (`sim/spawn.ts`, logic) | farthest perimeter points | one squad per sector around the kaiju, each at the nearest allowed point | At stage 3 the perimeter is the city edge: squads spawned up to 1900 m from a titan that needs two minutes to win. Now they start 800 to 1300 m out, on all sides. |

Bot numbers (`defs/bots.ts`), tuned in the same runs: the kaiju bot eats below 70% health, takes
revenge on the nearest squad for 10 s after a stagger, dashes at charging guns within 110 / 280 /
450 m for at most 7 s with 7 s between dashes, and looks for a place to molt for at most 16 s.
The dash range at stage 2 is the strongest pace lever among them (at 300 m a juvenile chases
tanks it cannot catch and stage 2 runs past four minutes; at 200 m it ignores them and stage 2
drops under three).

Things tried and dropped:

- **Bracing more readily** (at three lasers and 60% charge): the kaiju stood still more, was
  hit more, and was staggered half again as often (18 kills in 20 matches). Standing still is
  the worst defense it has.
- **Rocket nerve 3.6 and tank nerve 7.5**: gave the right number of staggers with bots, but let
  a single squad break the kaiju alone, which is not the game.
- **A crossfire multiplier of 2.0**: the one-player crossfire then broke the kaiju alone too.
- **`helplessMult` 0.3 and 0.36**: no kills in 30 matches at 0.3, one at 0.36.
- **Healing 100 per meal**: with the stagger damage halved the kaiju no longer needs it; the
  design's 80 stands.

## 6. Limits, and what to do next

- **The city is the placeholder grid.** The marks are fractions of the value actually standing
  in each stage's bounds, so the pace should carry over, but lines of fire, hiding places and
  the mix of buildings will all change with the handcrafted Port Meridian. Rerun the three
  commands at the top when it lands and adjust `p1 / p2 / p3` first.
- **Bots are a proxy.** They are deliberately beatable (`defs/bots.ts`). A good kaiju player
  wrecks faster than the bot and a coordinated team staggers more often; expect to revisit
  `helplessMult` and the nerve numbers after real playtests, in that order.
- **Stage 1 is short of its window and stage 3 is the deadly one.** Squad bots stagger a
  hatchling about 1.5 times a stage and a titan about 7 times. Giving infantry more nerve would
  even it out but breaks the one-squad rule above; better squad play at stage 1 (closer firing
  positions, waiting for the kaiju to commit to an attack) is the way to go.
- **Variance is high**: single matches run from 7 to 12 minutes, and a batch of 20 can land
  anywhere from 35% to 60% for the kaiju with the same numbers.

## 7. Second pass: charged, coordinated volleys (after the rules inspection)

(History: measured in the placeholder grid city. The tables for the game's city are in section 8.)

An inspection of the rules found that the bots had been hiding two things from the harness,
because they never play that way:

- **Holding the trigger beat charging a volley.** A sub-unit joined a volley with any charge
  and the bonus was linear, so a parked squad whose player simply held Fire got a "volley"
  every reload at 43 to 53% charge: more nerve per second than waiting for a full charge.
- **One squad could break the kaiju alone**: with one volley from behind whose shots also
  crossed (103 to 133 nerve of 100), or with volley after volley against the leak.

On open ground, with four squads standing round a kaiju that never moves (the script is
`shared/test/volleyRules.test.ts` in test form), it looked like this before:

| Four squads, kaiju standing still | first stagger | staggers a minute | killed after |
| --- | --- | --- | --- |
| Synchronized full-charge volleys | 6.8 / 7.3 / 8.5 s | 5.0 / 4.5 / 4.4 | 48 / 53 / 55 s |
| Hold-and-charge, everybody holds Fire | 0.8 / 1.3 / 2.5 s | 4.5 / 3.9 / 3.8 | 40 / 46 / 47 s |
| Fire at will, everybody holds Fire | 3.4 / 1.6 / 2.8 s | 4.2 / 4.4 / 3.9 | 72 / 69 / 76 s |

(Stages 1 / 2 / 3. One squad alone holding Fire from the front broke it after 14 / 21 / 28 s.)

### The rules now (DESIGN.md sections 3 and 5)

- **A volley needs a charge.** Below 60% charge (`COMBAT_RULES.volleyMinCharge`) a sub-unit
  still fires with the trigger, but raggedly: half nerve and the at-will aim error, exactly
  what fire at will is worth. From 60% to full the nerve multiplier rises from x0.5 to x3 and
  the aim error falls to the volley value. The damage bonus is unchanged, x(1 + charge), so
  holding Fire stays a reasonable way to do plain damage. The guns reload in 2.6 to 3.2 s of
  the 6 s charge, so a held trigger never gets past 53%.
- **It takes two squads to break the kaiju.** Nerve at capacity breaks only while charged
  volleys from two different squads have hit it within 5 s (`breakSquads`,
  `volleyBreakWindow`). Otherwise it stays at capacity, "on the brink". Artillery never counts.
- **Range limits every shot**: a projectile gives out after 1.1 times its weapon's range
  (shells used to fly 990 m against a listed 600).

The same four squads after:

| Four squads, kaiju standing still | first stagger | staggers a minute | killed after | health a second outside staggers |
| --- | --- | --- | --- | --- |
| Synchronized full-charge volleys | 6.8 / 7.3 / 8.5 s | 5.0 / 4.5 / 4.4 | 48 / 53 / 55 s | 5.0 / 0 / 3.3 |
| Hold-and-charge, everybody holds Fire | never | 0 | 84 / 94 / 92 s | 11.9 / 10.6 / 10.9 |
| Fire at will, everybody holds Fire | never | 0 | 126 / 130 / 131 s | 8.0 / 7.7 / 7.7 |

Two squads whose fire crosses, volleying together, break it after 6.8 / 7.3 / 8.5 s and kill
it in 120 to 139 s; the same two holding Fire never break it and have not killed it after
three minutes; one squad alone never breaks it, whatever it does. (A kaiju that stands
still, never eats and never fights back is the best case for lazy fire there is.)

### What that did to the balance, and the tuning

With the rules changed and nothing else, the kaiju won 18 of 20 (seeds 1 to 20): staggers
per stage went from 1.4 / 2.9 / 6.7 to 1.6 / 1.8 / 1.8. Stages 1 and 2 hardly moved; the
titan's staggers had mostly been artillery alone. Squads deploy 800 to 1300 m from a titan
and need about a minute and a half to get into range; until then four batteries (40 nerve a
barrage, more from the side) used to break it from across the map every 35 s. Now artillery
only brings it to the brink, and a titan that needs two minutes alone is done before the
squads have fought it.

Two rounds, one knob:

| Tried (20 matches each unless said) | Kaiju wins | Notes |
| --- | --- | --- |
| Rules only, `p3` 0.31 | 18 of 20 | no kills |
| Letting a barrage count as its squad's volley | 14 of 20 | rejected: trigger-happy squads then still broke a titan 4.8 times a stage and killed it 3 times in 20 |
| Squad bots that wait longer for each other (`syncCharge` 0, `syncWait` 4 or 8) | 16 of 20 | no gain: once in range they already fire together |
| `p3` 0.40 | 7 of 20 | stage 3 takes 5:06 |
| `p3` 0.40 and `helplessMult` 0.65 | 2 of 20 | |
| `p3` 0.34 / 0.35 / 0.36, all fixes in, 60 matches each | 37 / 34 / 26 of 60 | chosen: 0.35 |

| Number (file) | Before | After | Why |
| --- | --- | --- | --- |
| Third bar mark fraction `p3` (`defs/rules.ts`) | 0.31 | 0.35 | The titan's segment has to last until the squads can fight it with volleys. Contested stage 3 is 3:16 to 3:32 again. The price: alone, a titan now needs 2:44 instead of 2:00 (it runs out of cheap blocks: 0.34 gives 2:31, 0.36 gives 3:00). |
| Volley nerve below 60% charge (`COMBAT_RULES.volleyMinCharge`, new) | x(1 + 2 x charge) | x0.5, then rising to x3 at full charge | See above. |
| Squads needed to break nerve (`breakSquads`, `volleyBreakWindow`, new) | none | 2 within 5 s | See above. |
| Projectile lifetime (`SQUAD_RULES.rangeSlack`, new) | 7 s rockets, 9 s shells | 1.1 x range / speed | Range now limits a person's shots and volleys. Stray shots also stop short of far houses: squad collateral at stage 1 fell from 58 to about 41 points. |
| Kaiju eye and mouth (`defs/kaiju/lizard.ts`) | 3.8 / 28 / 100 and 3.3 / 24 / 88 m up, on the body's axis | 4.2 / 27.5 / 90.7 and 2.9 / 22 / 72 m up, 1.7 / 11 / 38.5 and 2.5 / 15 / 51.4 m ahead | Where the model has them, so that the beam burns where it is drawn. Alone, the bot's pace did not change (stage 3 at `p3` 0.31 is still 2:00). |

### Current tables

20 matches, seeds 1 to 20:

```
20 bot matches
seed  start         winner          length          stage time    staggers  units lost  bar % at stage end     kaiju hp lost
----  ------------  --------------  ------  ------------------  ----------  ----------  ------------------  ----------------
1     Gull Point    kaiju (bar)       8:04  2:30 / 2:03 / 3:31   3 / 1 / 0   4 / 6 / 1       21 / 57 / 100   250 / 109 / 268
2     Harrow Lane   kaiju (bar)       9:00  2:10 / 3:49 / 3:01   0 / 4 / 0   3 / 8 / 3       21 / 57 / 100    45 / 498 / 176
3     Bellhaven     kaiju (bar)      10:51  4:47 / 2:33 / 3:31   3 / 0 / 3   6 / 4 / 1       21 / 57 / 100    385 / 77 / 588
4     Dovecote      humans (kill)     6:39     4:29 / 2:10 / -   0 / 6 / -   5 / 3 / -         21 / 31 / -     239 / 999 / -
5     Cinder Flats  kaiju (bar)      11:47  2:28 / 5:48 / 3:31   0 / 7 / 1   4 / 7 / 1       21 / 57 / 100    50 / 999 / 364
6     Easter Green  humans (clock)   12:00  4:09 / 3:16 / 4:35   1 / 0 / 7   8 / 8 / 2        21 / 57 / 84   219 / 46 / 1522
7     Cinder Flats  kaiju (bar)      11:02  3:02 / 4:52 / 3:08   1 / 4 / 0   3 / 6 / 0       21 / 57 / 100   229 / 676 / 229
8     Alder Row     humans (clock)   12:00  2:22 / 4:14 / 5:24  1 / 5 / 10   3 / 7 / 2        21 / 57 / 95  132 / 786 / 1861
9     Ivy Court     kaiju (bar)      10:25  4:26 / 3:13 / 2:45   3 / 0 / 0   5 / 0 / 3       21 / 57 / 100    316 / 92 / 181
10    Bellhaven     humans (clock)   12:00  5:05 / 3:53 / 3:02   4 / 3 / 2   7 / 7 / 2        21 / 57 / 97   452 / 429 / 412
11    Dovecote      humans (clock)   12:00  3:26 / 3:19 / 5:15   2 / 1 / 8   0 / 4 / 2        21 / 57 / 99  515 / 218 / 1394
12    Easter Green  kaiju (bar)      10:45  3:47 / 3:48 / 3:10   1 / 4 / 0   3 / 3 / 4       21 / 57 / 100   235 / 831 / 253
13    Alder Row     kaiju (bar)       9:52  2:45 / 3:53 / 3:14   1 / 4 / 1   3 / 9 / 3       22 / 57 / 100   174 / 590 / 473
14    Fennel Hill   kaiju (bar)      11:31  2:00 / 5:00 / 4:31  1 / 10 / 3  4 / 10 / 6       21 / 57 / 100  169 / 1286 / 666
15    Bellhaven     humans (clock)   12:00  4:28 / 3:12 / 4:20   2 / 0 / 2   6 / 0 / 1        21 / 57 / 98    308 / 98 / 549
16    Dovecote      kaiju (bar)      10:45  4:02 / 2:22 / 4:21   2 / 1 / 4   5 / 3 / 2       21 / 57 / 100   249 / 120 / 975
17    Juniper Bay   humans (clock)   12:00  2:51 / 3:26 / 5:42   0 / 1 / 9   4 / 0 / 4        21 / 57 / 91  102 / 161 / 1622
18    Harrow Lane   kaiju (bar)       8:31  2:10 / 3:14 / 3:07   0 / 1 / 1  3 / 10 / 0       21 / 57 / 100    51 / 203 / 309
19    Alder Row     kaiju (bar)       9:59  2:55 / 3:19 / 3:44   2 / 5 / 4   4 / 0 / 3       21 / 57 / 100  200 / 1073 / 806
20    Dovecote      humans (kill)    11:00  4:09 / 2:03 / 4:49  4 / 1 / 11   5 / 0 / 3        21 / 57 / 83  464 / 178 / 1798

kaiju wins 12/20 (60%)   human wins 8 (40%): 2 by kill, 6 by the clock
mean match length 10:36   shortest 6:39   longest 12:00
stage 1: reached 20, completed 20, segment filled after 3:03, stage time when completed 3:24; per match: staggers 1.6, volleys 31.6, units lost 4.3, kaiju hp lost 239 (healed 32), collateral 43 points
stage 2: reached 20, completed 19, segment filled after 3:13, stage time when completed 3:32; per match: staggers 2.9, volleys 30.4, units lost 4.8, kaiju hp lost 474 (healed 200), collateral 316 points
stage 3: reached 19, completed 12, segment filled after 3:28, stage time when completed 3:28; per match: staggers 3.5, volleys 28.9, units lost 2.3, kaiju hp lost 760 (healed 345), collateral 948 points
voice: 13.3 cues per minute, at most 8 in any 10 s   simulated 397271 ticks in 31.4 s (422x real time)
```

Seeds 21 to 40, then 41 to 60:

```
kaiju wins 10/20 (50%)   human wins 10 (50%): 2 by kill, 8 by the clock
mean match length 10:34   shortest 5:12   longest 12:00
stage 1: reached 20, completed 20, segment filled after 2:46, stage time when completed 3:08; per match: staggers 1.7, volleys 30.8, units lost 4.8, kaiju hp lost 266 (healed 68), collateral 41 points
stage 2: reached 20, completed 19, segment filled after 3:49, stage time when completed 4:10; per match: staggers 3.8, volleys 43.6, units lost 5.5, kaiju hp lost 599 (healed 324), collateral 349 points
stage 3: reached 19, completed 10, segment filled after 3:16, stage time when completed 3:16; per match: staggers 2.2, volleys 20.4, units lost 2.6, kaiju hp lost 550 (healed 253), collateral 874 points
voice: 13.3 cues per minute, at most 8 in any 10 s   simulated 395893 ticks in 29.5 s (448x real time)
```

```
kaiju wins 12/20 (60%)   human wins 8 (40%): 2 by kill, 6 by the clock
mean match length 10:37   shortest 7:59   longest 12:00
stage 1: reached 20, completed 20, segment filled after 2:49, stage time when completed 3:12; per match: staggers 1.6, volleys 29.8, units lost 3.6, kaiju hp lost 307 (healed 36), collateral 39 points
stage 2: reached 20, completed 20, segment filled after 3:06, stage time when completed 3:27; per match: staggers 2.9, volleys 29.1, units lost 4.0, kaiju hp lost 430 (healed 184), collateral 339 points
stage 3: reached 20, completed 12, segment filled after 3:32, stage time when completed 3:32; per match: staggers 3.7, volleys 28.4, units lost 2.4, kaiju hp lost 812 (healed 371), collateral 889 points
voice: 13.3 cues per minute, at most 7 in any 10 s   simulated 397706 ticks in 39.3 s (337x real time)
```

The same 20 seeds with squads that play the lazy way (`--trigger-happy`: parked, they fire
every time the guns have loaded and never wait for a charge):

```
20 bot matches [trigger-happy squads]
seed  start         winner       length          stage time   staggers  units lost  bar % at stage end    kaiju hp lost
----  ------------  -----------  ------  ------------------  ---------  ----------  ------------------  ---------------
1     Gull Point    kaiju (bar)    7:36  1:57 / 2:10 / 3:29  0 / 0 / 0   5 / 4 / 3       21 / 57 / 100   42 / 115 / 430
2     Harrow Lane   kaiju (bar)    8:05  1:48 / 3:15 / 3:02  0 / 0 / 0  3 / 12 / 2       22 / 57 / 100   84 / 313 / 359
3     Bellhaven     kaiju (bar)    9:15  3:37 / 2:23 / 3:15  0 / 0 / 0   5 / 0 / 3       21 / 57 / 100  170 / 102 / 423
4     Dovecote      kaiju (bar)    8:59  2:27 / 3:42 / 2:50  0 / 0 / 0   4 / 3 / 0       21 / 57 / 100  110 / 616 / 242
5     Cinder Flats  kaiju (bar)    7:22  1:52 / 2:12 / 3:18  0 / 0 / 0   2 / 5 / 4       21 / 57 / 100   83 / 106 / 383
6     Easter Green  kaiju (bar)    6:53  2:07 / 2:19 / 2:26  0 / 0 / 0   0 / 3 / 2       21 / 57 / 100   54 / 201 / 194
7     Cinder Flats  kaiju (bar)    7:23  1:54 / 2:37 / 2:53  0 / 0 / 0   2 / 6 / 0       21 / 57 / 100   55 / 133 / 248
8     Alder Row     kaiju (bar)    8:15  1:53 / 2:56 / 3:27  0 / 0 / 0   0 / 6 / 3       21 / 57 / 100   48 / 322 / 304
9     Ivy Court     kaiju (bar)    8:31  2:51 / 3:00 / 2:39  0 / 0 / 0   2 / 3 / 1       21 / 57 / 100  190 / 279 / 271
10    Bellhaven     kaiju (bar)    8:54  3:29 / 2:38 / 2:47  0 / 0 / 0   4 / 0 / 1       22 / 57 / 100   125 / 82 / 304
11    Dovecote      kaiju (bar)    7:31  2:11 / 2:39 / 2:41  0 / 0 / 0   2 / 5 / 1       22 / 57 / 100  177 / 307 / 268
12    Easter Green  kaiju (bar)    7:06  2:09 / 2:12 / 2:45  0 / 0 / 0   2 / 4 / 2       21 / 57 / 100   65 / 136 / 267
13    Alder Row     kaiju (bar)    7:46  1:30 / 2:54 / 3:21  0 / 0 / 0   0 / 7 / 1       21 / 57 / 100   49 / 247 / 401
14    Fennel Hill   kaiju (bar)    7:37  1:37 / 2:27 / 3:32  0 / 0 / 0   2 / 3 / 3       21 / 57 / 100   36 / 201 / 444
15    Bellhaven     kaiju (bar)    9:33  3:24 / 2:24 / 3:46  0 / 0 / 0   4 / 0 / 5       21 / 57 / 100    85 / 50 / 848
16    Dovecote      kaiju (bar)    7:56  2:17 / 2:59 / 2:40  0 / 0 / 0   3 / 6 / 0       21 / 57 / 100   47 / 274 / 305
17    Juniper Bay   kaiju (bar)    8:35  1:53 / 4:04 / 2:38  0 / 0 / 0   1 / 5 / 3       21 / 57 / 100   56 / 216 / 224
18    Harrow Lane   kaiju (bar)    7:13  1:39 / 2:47 / 2:46  0 / 0 / 0   1 / 7 / 3       21 / 57 / 100   47 / 222 / 247
19    Alder Row     kaiju (bar)    7:29  2:00 / 2:39 / 2:51  0 / 0 / 0   2 / 8 / 1       21 / 57 / 100   55 / 244 / 198
20    Dovecote      kaiju (bar)    8:11  2:40 / 1:52 / 3:39  0 / 0 / 0   3 / 0 / 2       21 / 57 / 100   108 / 80 / 655

kaiju wins 20/20 (100%)   human wins 0 (0%): 0 by kill, 0 by the clock
mean match length 8:00   shortest 6:53   longest 9:33
stage 1: reached 20, completed 20, segment filled after 1:54, stage time when completed 2:16; per match: staggers 0.0, volleys 1.3, units lost 2.4, kaiju hp lost 84 (healed 0), collateral 102 points
stage 2: reached 20, completed 20, segment filled after 2:20, stage time when completed 2:42; per match: staggers 0.0, volleys 1.9, units lost 4.3, kaiju hp lost 212 (healed 16), collateral 545 points
stage 3: reached 20, completed 20, segment filled after 3:02, stage time when completed 3:02; per match: staggers 0.0, volleys 1.8, units lost 2.0, kaiju hp lost 351 (healed 96), collateral 1629 points
voice: 11.2 cues per minute, at most 6 in any 10 s   simulated 303890 ticks in 25.2 s (402x real time)
```

And the kaiju alone (`--unopposed`, seeds 1 to 10):

```
10 bot matches [unopposed]
seed  start         winner       length          stage time   staggers  units lost  bar % at stage end  kaiju hp lost
----  ------------  -----------  ------  ------------------  ---------  ----------  ------------------  -------------
1     Gull Point    kaiju (bar)    6:26  1:45 / 1:55 / 2:45  0 / 0 / 0   0 / 0 / 0       21 / 57 / 100      0 / 0 / 0
2     Harrow Lane   kaiju (bar)    6:52  1:50 / 2:02 / 2:59  0 / 0 / 0   0 / 0 / 0       21 / 57 / 100      0 / 0 / 0
3     Bellhaven     kaiju (bar)    8:29  3:24 / 2:21 / 2:44  0 / 0 / 0   0 / 0 / 0       21 / 57 / 100      0 / 0 / 0
4     Dovecote      kaiju (bar)    7:02  2:17 / 2:05 / 2:40  0 / 0 / 0   0 / 0 / 0       21 / 57 / 100      0 / 0 / 0
5     Cinder Flats  kaiju (bar)    6:34  1:44 / 2:06 / 2:43  0 / 0 / 0   0 / 0 / 0       21 / 57 / 100      0 / 0 / 0
6     Easter Green  kaiju (bar)    7:26  2:32 / 2:09 / 2:45  0 / 0 / 0   0 / 0 / 0       21 / 57 / 100      0 / 0 / 0
7     Cinder Flats  kaiju (bar)    6:34  1:44 / 2:06 / 2:43  0 / 0 / 0   0 / 0 / 0       21 / 57 / 100      0 / 0 / 0
8     Alder Row     kaiju (bar)    6:43  1:44 / 2:24 / 2:35  0 / 0 / 0   0 / 0 / 0       21 / 57 / 100      0 / 0 / 0
9     Ivy Court     kaiju (bar)    8:36  2:36 / 3:18 / 2:42  0 / 0 / 0   0 / 0 / 0       21 / 57 / 100      0 / 0 / 0
10    Bellhaven     kaiju (bar)    8:29  3:24 / 2:21 / 2:44  0 / 0 / 0   0 / 0 / 0       21 / 57 / 100      0 / 0 / 0

kaiju wins 10/10 (100%)   human wins 0 (0%): 0 by kill, 0 by the clock
mean match length 7:19   shortest 6:26   longest 8:36
stage 1: reached 10, completed 10, segment filled after 2:07, stage time when completed 2:18; per match: staggers 0.0, volleys 0.0, units lost 0.0, kaiju hp lost 0 (healed 0), collateral 0 points
stage 2: reached 10, completed 10, segment filled after 2:06, stage time when completed 2:17; per match: staggers 0.0, volleys 0.0, units lost 0.0, kaiju hp lost 0 (healed 0), collateral 0 points
stage 3: reached 10, completed 10, segment filled after 2:44, stage time when completed 2:44; per match: staggers 0.0, volleys 0.0, units lost 0.0, kaiju hp lost 0 (healed 0), collateral 0 points
voice: 7.9 cues per minute, at most 4 in any 10 s   simulated 139479 ticks in 1.4 s (3323x real time)
```

Against the targets, over the 60 contested matches:

| Target | Result |
| --- | --- |
| Alone, a segment in 100 to 130 s | 2:07 / 2:06 / 2:44. Stage 3 is over the window on purpose (see `p3` above). |
| Contested stage 200 to 230 s | Stage 1: 3:08 to 3:24. Stage 2: 3:27 to 4:10. Stage 3: 3:16 to 3:32. |
| Match 10 to 12 minutes | Mean 10:34 to 10:37 per batch. |
| Neither side above about 65% | Kaiju 34 of 60 (57%): 60%, 50% and 60% in the three batches. |
| Scattered fire rarely kills, coordinated volleys do | 6 kills in 60 matches (the humans' other 20 wins are the clock). Trigger-happy squads: no kill and no win in 20. |
| Undisciplined fire is clearly worse at breaking nerve | Disciplined squads break the kaiju 1.6 / 2.9 / 3.5 times a stage (seeds 1 to 20); trigger-happy squads never do, cost it a third to a half of the health (84 / 212 / 351 against 239 / 474 / 760), and add twice the collateral (102 / 545 / 1629 points against 43 / 316 / 948). Their matches are 2:36 shorter. |

Sensitivity, 10 matches each: a kaiju bot that hesitates 30% of the time wins 0 of 10
(`kaiju wins 0/10 (0%)   human wins 10 (100%): 1 by kill, 9 by the clock`); squads that hesitate 30% of the time win 5 of 10
(`kaiju wins 5/10 (50%)   human wins 5 (50%): 1 by kill, 4 by the clock`). The squads' side has become less sensitive to hesitation than it was
(they used to lose 10 of 10): more of their wins are the clock, which a slower kaiju hands
them either way. How they fire matters far more than how often.

### Limits of the second pass

- **Kills are rare now** (6 in 60 against 17 in 60 before): a titan is staggered 2 to 4 times
  a stage instead of 7, and the humans mostly win on the clock. If the owner wants more kills,
  the levers are `helplessMult` (0.5; what a stagger costs) and the squads' deployment at
  stage 3 (how soon they can fight), in that order. Raising nerve numbers would not help: a
  pair of volleys already breaks it.
- **Alone at stage 3 the titan is slow against the target** (2:44 for a 100 to 130 s window).
  When the real city lands, tune `p3` again; a city with more value in reach of a titan will
  move this more than anything here.
- **The bots fire at full charge only.** A person who fires at 60 to 90% charge gets a
  weaker volley sooner; the harness has no profile for that middle ground.
- **Four idle people no longer stagger anything**: squads start on fire at will, which never
  breaks nerve now. The client's autopilot squad (`client/src/game/autoplay.ts`) used to hold
  the trigger too; since 12 November it plays the squad bot's volley rule (park, charge to
  full, wait up to 2.5 s for a squad that is nearly charged, then fire), so browser smoke runs
  fire charged volleys again. Measured in the sandbox at stage 2 over 100 s (one autopilot
  squad, three bot squads, bot kaiju): the old autopilot fired no volley of its own, the new
  one seven, all at full charge, most of them within a second of a bot squad's.

## 8. Third pass: Port Meridian (the city switch)

The game moved from the placeholder grid to Port Meridian (`docs/CITY.md`). The marks are
fractions of the value standing in each stage's square, so they carried over in name only: the
real city has its towers 720 m from where a titan starts, low-rise starts with less in reach,
a bay and a river. Before tuning, the bots and the navigation were fixed on the new city (bot
matches from every start, with `--nav`); the numbers below are with those fixes in.

### What was wrong on the new city, and what changed

| Seen | Fix (file) |
| --- | --- |
| A squad deployed at stage 3 along the sea edge walked inland to the Long Mole, 150 m inside the line and a kilometer from the fight; some units stood in the sea. | A deploy point counts only when dry ground lies within 40 m of it (`sim/spawn.ts`). Test: `meridianPlay.test.ts`, every start, titan at its anchor, half way and downtown. |
| A squad deployed into a pocket of houses against the stage 1 line (Juniper Bay): its only way out was across the quarantine line, so it went back and forth for the whole stage (65 swings in three matches). | Deploy spots must have a street inside the bounds in plain reach (`standsByRoad`), and sub-units are placed dry first and no nearer the kaiju than the deploy distance. Test: the deployment test now checks this for every unit of every start and stage. |
| Squads drove straight across the bay at half speed (up to 10% of their time in it). | A straight line may wade at most 120 m (the widest river crossing is about 100 m); longer, the unit takes the streets (`sim/nav.ts`, `shallowWay`). Out in open water (no land within 50 m) fell to 0.1 to 0.4% of unit time. |
| A troop of tanks came out of a turn 9 m off the middle of the next street, flank in the houses, and drove about for good. | A crossroads counts as passed within 3 m, not within the body's radius; a unit that gets no closer to its next stop for 8 s plans again from where it is. |
| A troop of tanks swung between a straight line and its street (the line was clear by a hair from one spot and not from the next). | Staying on a straight line forgives a wall within 30% of the body's radius (the progress watch still drops a line that stops it); stepping off the street at the checked point counts as being on the line. |
| A 30 m trip took a 900 m route, because the stage 1 square cuts the streets. | When the street route is more than 2.5 times the straight distance plus 60 m, the unit first feels its way straight there, and takes the long route only if that fails. |
| A move-to marker in the middle of the stadium sent units into a walled strip behind it. | Hold points: a second, four times wider search for ground by a street before settling for any open ground (`sim/squads.ts`). |
| The hatchling leaned on a house for 11 s while looking for a place to molt. | The kaiju bot smashes what stands in its way while it looks, as it does while wrecking (`sim/bots/kaijuBot.ts`). The soak test now fails if the kaiju or a unit is stuck for 20 s or goes outside the bounds. |
| A match ran one tick past its clock (150.033 s of 150). | The clock ends within a microsecond of zero instead of after a rounding crumb (`systems/matchFlow.ts`). |
| Units on a collapsing bridge deck took their fall a tick late, leaving a hit queued between ticks. | Applied on the tick the deck goes (`systems/cityDamage.ts`). |

A stress run of 1800 random move-to trips (every start, every stage, markers anywhere: roofs,
yards, the river, the bay) went from 286 trips that did not arrive within 10 times the straight
drive plus a minute to 4; within 3 times plus a minute, 13 do not (0.7%), all into pockets
against the stage 1 line or far out in the bay. Nobody was ever inside a wall or outside the
bounds. (The script is `/tmp/mb-scratch/city-switch/stress.mts`; `test/nav.test.ts` has a
small version.)

Bot navigation in the final batches below (60 matches, `--nav`): units stuck 0.00 to 0.01% of
their time (longest 3.1 s), no route given up, 3 to 4% wading, at most 4 units on one deck,
1.1 to 1.3% in the bay (0.1 to 0.4% out in open water), never outside the bounds, the kaiju
stuck 0.07 to 0.40% of play (longest 9.7 s), never without something to wreck.

### Tuning

Start: today's fractions on the new city, 20 contested matches (`--every-anchor`, seeds 1 to
20) and 10 unopposed:

| Fractions p1 / p2 / p3 | Kaiju wins | Mean length | Contested stage times | Alone: segment filled after |
| --- | --- | --- | --- | --- |
| 0.13 / 0.088 / 0.35 (the placeholder's) | 4 of 20 | 10:51 | 2:21 / 2:34 / 5:49 | 1:29 / 1:30 / 4:18 |
| 0.165 / 0.11 / 0.27 | 15 of 20 | 8:31 | 2:55 / 2:43 / 2:57 | 1:53 / 1:45 / 2:29 |
| 0.18 / 0.125 / 0.30 | 34 of 60 (65, 55, 50%) | 10:08, 10:05, 9:37 | 3:17 / 3:07 / 3:16 (first 20) | 2:02 / 2:02 / 2:49 |
| **0.18 / 0.125 / 0.31** | **28 of 60 (50, 40, 50%)** | **10:46, 10:18, 9:52** | 3:15 to 3:18 / 2:56 to 3:16 / 3:41 to 4:01 | **2:02 / 2:02 / 3:02** |
| 0.18 / 0.125 / 0.32 | 18 of 40 (55, 35%) | 10:53, 10:33 | 3:17 / 3:07 / 4:21 (first 20) | 2:02 / 2:02 / 3:13 |

Chosen: **0.18 / 0.125 / 0.31** (`MATCH_RULES.bar` in `defs/rules.ts`). p1 and p2 put a lone
kaiju's first two segments at about two minutes, as before. p3 is the knob between the sides:
0.30 gives the kaiju 57% and 9:57 matches, 0.31 gives it 47% and 10:19. The stopgap the
placeholder needed (p3 raised from 0.31 to 0.35 so a titan could not finish before the squads
arrived) is gone: on this city the titan walks 720 m to the towers anyway.

| Number (file) | Before | After | Why |
| --- | --- | --- | --- |
| `p1` (`defs/rules.ts`) | 0.13 | 0.18 | A hatchling alone took 1:29 for its segment in the low-rise starts; now 2:02. Contested stage 1 went from 2:21 to 3:17. |
| `p2` | 0.088 | 0.125 | The same for the juvenile: 1:30 alone, now 2:02; contested 2:34 to about 3:05. |
| `p3` | 0.35 | 0.31 | At 0.35 a titan alone needed 4:18 and lost 16 of 20 contested matches (most by a kill in a 5:49 stage 3). At 0.31: 3:02 alone, even contested. |

### Current tables

20 matches, `npm run sim -- --seeds 20 --every-anchor`:

```
20 bot matches [every start in turn]
seed  start         winner          length          stage time    staggers  units lost  bar % at stage end     kaiju hp lost
----  ------------  --------------  ------  ------------------  ----------  ----------  ------------------  ----------------
1     Alder Row     humans (kill)     9:51  3:09 / 3:05 / 3:37   1 / 3 / 5   5 / 3 / 3        22 / 57 / 98  302 / 463 / 1315
2     Bellhaven     kaiju (bar)      10:53  3:26 / 3:57 / 3:29   2 / 6 / 2   7 / 4 / 3       22 / 57 / 100   186 / 733 / 516
3     Cinder Flats  kaiju (bar)      10:07  2:53 / 2:53 / 4:21   1 / 1 / 4   3 / 3 / 4       21 / 57 / 100   171 / 226 / 896
4     Dovecote      humans (kill)    11:22  4:13 / 2:15 / 4:55   5 / 0 / 8   3 / 0 / 3       21 / 57 / 100   527 / 81 / 1559
5     Easter Green  humans (clock)   12:00  3:40 / 3:47 / 4:34   0 / 3 / 4   3 / 7 / 4        21 / 57 / 93   129 / 436 / 976
6     Fennel Hill   kaiju (bar)      11:41  3:07 / 2:40 / 5:53   1 / 0 / 7   8 / 2 / 4       21 / 57 / 100   206 / 79 / 1334
7     Gull Point    humans (clock)   12:00  3:19 / 2:45 / 5:56   1 / 1 / 9   0 / 3 / 6        22 / 57 / 87  275 / 255 / 1504
8     Harrow Lane   kaiju (bar)       9:00  2:45 / 2:25 / 3:50   1 / 1 / 0   4 / 7 / 2       21 / 57 / 100    91 / 124 / 337
9     Ivy Court     humans (clock)   12:00  2:39 / 5:01 / 4:21   2 / 3 / 5  3 / 11 / 3        22 / 57 / 98   313 / 521 / 916
10    Juniper Bay   kaiju (bar)       8:26  2:50 / 2:43 / 2:53   0 / 3 / 0   6 / 4 / 0       21 / 57 / 100    37 / 410 / 195
11    Alder Row     humans (kill)    10:19  4:15 / 2:54 / 3:10  2 / 3 / 10   5 / 3 / 5        21 / 57 / 59  322 / 661 / 1640
12    Bellhaven     humans (kill)     9:30  3:05 / 2:27 / 3:58   0 / 0 / 6   5 / 1 / 2        22 / 57 / 98    64 / 36 / 1396
13    Cinder Flats  kaiju (bar)      11:26  3:03 / 3:33 / 4:49   2 / 2 / 4   3 / 3 / 1       21 / 57 / 100   230 / 455 / 980
14    Dovecote      kaiju (bar)       9:24  3:33 / 2:43 / 3:08   3 / 0 / 0   5 / 2 / 2       21 / 58 / 100    222 / 97 / 310
15    Easter Green  humans (clock)   12:00  4:08 / 2:37 / 5:15   2 / 2 / 5   9 / 4 / 2        21 / 57 / 99  274 / 243 / 1165
16    Fennel Hill   kaiju (bar)      11:43  3:07 / 3:43 / 4:53   1 / 3 / 6   2 / 0 / 3       21 / 57 / 100  248 / 572 / 1047
17    Gull Point    humans (clock)   12:00  3:33 / 3:45 / 4:42   2 / 5 / 5   2 / 5 / 6        22 / 57 / 89  245 / 603 / 1050
18    Harrow Lane   kaiju (bar)      11:34  3:20 / 4:05 / 4:09   2 / 4 / 3   5 / 5 / 2       21 / 57 / 100   276 / 540 / 712
19    Ivy Court     humans (clock)   12:00  2:47 / 2:25 / 6:48   1 / 1 / 9   3 / 0 / 2        22 / 57 / 99  162 / 201 / 1873
20    Juniper Bay   kaiju (bar)       8:08  2:44 / 2:38 / 2:47   0 / 0 / 0   4 / 7 / 1       21 / 57 / 100     27 / 78 / 233

kaiju wins 10/20 (50%)   human wins 10 (50%): 4 by kill, 6 by the clock
mean match length 10:46   shortest 8:08   longest 12:00
stage 1: reached 20, completed 20, segment filled after 2:51, stage time when completed 3:17; per match: staggers 1.4, volleys 29.9, units lost 4.3, kaiju hp lost 215 (healed 8), collateral 47 points
stage 2: reached 20, completed 20, segment filled after 2:42, stage time when completed 3:07; per match: staggers 2.0, volleys 22.4, units lost 3.7, kaiju hp lost 341 (healed 96), collateral 297 points
stage 3: reached 20, completed 10, segment filled after 4:01, stage time when completed 4:01; per match: staggers 4.6, volleys 33.0, units lost 2.9, kaiju hp lost 998 (healed 460), collateral 971 points
voice: 13.2 cues per minute, at most 7 in any 10 s   simulated 403299 ticks in 23.0 s (584x real time)
```

Seeds 21 to 40, then 41 to 60:

```
kaiju wins 8/20 (40%)   human wins 12 (60%): 9 by kill, 3 by the clock
mean match length 10:18   shortest 7:56   longest 12:00
stage 1: reached 20, completed 20, segment filled after 2:49, stage time when completed 3:15; per match: staggers 1.4, volleys 29.9, units lost 4.0, kaiju hp lost 249 (healed 4), collateral 47 points
stage 2: reached 20, completed 19, segment filled after 2:52, stage time when completed 3:16; per match: staggers 2.8, volleys 29.3, units lost 4.0, kaiju hp lost 428 (healed 176), collateral 307 points
stage 3: reached 19, completed 8, segment filled after 3:41, stage time when completed 3:41; per match: staggers 3.8, volleys 29.5, units lost 2.2, kaiju hp lost 967 (healed 332), collateral 875 points
```

```
kaiju wins 10/20 (50%)   human wins 10 (50%): 5 by kill, 5 by the clock
mean match length 9:52   shortest 5:58   longest 12:00
stage 1: reached 20, completed 20, segment filled after 2:54, stage time when completed 3:18; per match: staggers 1.5, volleys 32.8, units lost 4.0, kaiju hp lost 256 (healed 40), collateral 51 points
stage 2: reached 20, completed 18, segment filled after 2:34, stage time when completed 2:56; per match: staggers 1.9, volleys 20.9, units lost 3.8, kaiju hp lost 335 (healed 72), collateral 284 points
stage 3: reached 18, completed 10, segment filled after 3:57, stage time when completed 3:57; per match: staggers 3.6, volleys 26.1, units lost 2.3, kaiju hp lost 850 (healed 342), collateral 1065 points
```

The same 20 seeds with trigger-happy squads (`--trigger-happy`):

```
kaiju wins 20/20 (100%)   human wins 0 (0%): 0 by kill, 0 by the clock
mean match length 8:40   shortest 6:21   longest 11:42
stage 1: reached 20, completed 20, segment filled after 1:51, stage time when completed 2:16; per match: staggers 0.0, volleys 1.5, units lost 2.9, kaiju hp lost 108 (healed 0), collateral 114 points
stage 2: reached 20, completed 20, segment filled after 2:14, stage time when completed 2:34; per match: staggers 0.0, volleys 1.9, units lost 3.9, kaiju hp lost 225 (healed 44), collateral 482 points
stage 3: reached 20, completed 20, segment filled after 3:50, stage time when completed 3:50; per match: staggers 0.0, volleys 1.9, units lost 2.4, kaiju hp lost 524 (healed 259), collateral 1682 points
```

And the kaiju alone (`--unopposed --seeds 10 --every-anchor`: each start once; an unopposed
match repeats exactly per start):

```
10 bot matches [unopposed, every start in turn]
seed  start         winner       length          stage time   staggers  units lost  bar % at stage end  kaiju hp lost
----  ------------  -----------  ------  ------------------  ---------  ----------  ------------------  -------------
1     Alder Row     kaiju (bar)    7:44  2:22 / 2:10 / 3:13  0 / 0 / 0   0 / 0 / 0       21 / 57 / 100      0 / 0 / 0
2     Bellhaven     kaiju (bar)    7:18  2:07 / 2:04 / 3:07  0 / 0 / 0   0 / 0 / 0       21 / 57 / 100      0 / 0 / 0
3     Cinder Flats  kaiju (bar)    8:34  2:10 / 2:34 / 3:49  0 / 0 / 0   0 / 0 / 0       21 / 57 / 100      0 / 0 / 0
4     Dovecote      kaiju (bar)    7:30  2:23 / 2:08 / 3:00  0 / 0 / 0   0 / 0 / 0       21 / 57 / 100      0 / 0 / 0
5     Easter Green  kaiju (bar)    8:30  2:25 / 3:18 / 2:48  0 / 0 / 0   0 / 0 / 0       21 / 57 / 100      0 / 0 / 0
6     Fennel Hill   kaiju (bar)    7:13  2:11 / 2:13 / 2:50  0 / 0 / 0   0 / 0 / 0       21 / 57 / 100      0 / 0 / 0
7     Gull Point    kaiju (bar)    7:06  2:05 / 1:59 / 3:02  0 / 0 / 0   0 / 0 / 0       21 / 57 / 100      0 / 0 / 0
8     Harrow Lane   kaiju (bar)    7:07  2:11 / 2:01 / 2:55  0 / 0 / 0   0 / 0 / 0       21 / 57 / 100      0 / 0 / 0
9     Ivy Court     kaiju (bar)    7:19  2:16 / 2:02 / 3:01  0 / 0 / 0   0 / 0 / 0       21 / 57 / 100      0 / 0 / 0
10    Juniper Bay   kaiju (bar)    6:29  2:03 / 1:45 / 2:41  0 / 0 / 0   0 / 0 / 0       21 / 57 / 100      0 / 0 / 0

kaiju wins 10/10 (100%)   human wins 0 (0%): 0 by kill, 0 by the clock
mean match length 7:29   shortest 6:29   longest 8:34
stage 1: reached 10, completed 10, segment filled after 2:02, stage time when completed 2:13; per match: staggers 0.0, volleys 0.0, units lost 0.0, kaiju hp lost 0 (healed 0), collateral 0 points
stage 2: reached 10, completed 10, segment filled after 2:02, stage time when completed 2:13; per match: staggers 0.0, volleys 0.0, units lost 0.0, kaiju hp lost 0 (healed 0), collateral 0 points
stage 3: reached 10, completed 10, segment filled after 3:02, stage time when completed 3:02; per match: staggers 0.0, volleys 0.0, units lost 0.0, kaiju hp lost 0 (healed 0), collateral 0 points
```

Against the targets, over the 60 contested matches:

| Target | Result |
| --- | --- |
| Alone, a segment in 100 to 130 s | 2:02 / 2:02 (122 s each; every start between 1:45 and 2:34, except Easter Green's 3:18 at stage 2) / 3:02. Stage 3 is over the window, as it was in the placeholder (2:44): a titan starts about 720 m from the towers. |
| Contested stage 200 to 230 s | Stage 1: 3:15 to 3:18. Stage 2: 2:56 to 3:16. Stage 3: 3:41 to 4:01 (the stage the squads fight hardest: 3.6 to 4.6 staggers). |
| Match 10 to 12 minutes | Mean 9:52 to 10:46 per batch (10:19 overall). |
| Neither side above about 65% | Kaiju 28 of 60 (47%): 50%, 40% and 50%. |
| Scattered fire rarely kills, coordinated volleys do | 18 kills in 60 (the humans' other 14 wins are the clock): 15 at stage 3 after 4 to 10 staggers there, 3 at stage 2 after 7 to 17. Trigger-happy squads: no stagger, no kill, no win in 20. |
| Undisciplined fire is clearly worse at breaking nerve | Disciplined squads break the kaiju 1.4 / 2.0 / 4.6 times a stage (seeds 1 to 20); trigger-happy squads never do, cost it half to two thirds of the health (108 / 225 / 524 against 215 / 341 / 998), add 1.6 to 2.4 times the collateral (114 / 482 / 1682 against 47 / 297 / 971 points), and their matches are 2:06 shorter. |

Sensitivity, 10 matches each, every start once: a kaiju bot that hesitates 30% of the time wins
1 of 10 (`kaiju wins 1/10 (10%)   human wins 9 (90%): 0 by kill, 9 by the clock`); squads that
hesitate 30% of the time win 1 of 10 (`kaiju wins 9/10 (90%)   human wins 1 (10%): 0 by kill,
1 by the clock`). Both sides are more sensitive to hesitation than in the placeholder (where
hesitant squads still won 5 of 10): the real city's streets cost a hesitant squad more.

### Limits of the third pass

- **Kills came back** (18 in 60, against 6 in 60 in the placeholder): 15 at stage 3, where the
  titan wades through the downtown grid with long straight avenues for crossfire.
  If the owner wants fewer, `helplessMult` is the lever (section 7).
- **Stage 3 is still the long one contested** (3:41 to 4:01 against 200 to 230 s) and alone
  (3:02). Lowering p3 shortens it and hands the kaiju the match (0.27: 75% kaiju wins in 8:31).
  The next lever, as CITY.md says, is the bots' stage 3 plan: how far the titan walks before it
  wrecks.
- **The start matters**: unopposed, Easter Green's juvenile needs 3:18 for its segment and
  Juniper Bay's 1:45; contested, Ivy Court and Gull Point lose more often by the clock. The
  value inside each square is within 14% (CITY.md section 6); the layout around it is not.
- **Move-to in odd places**: 0.7% of random move-to trips take more than three times the
  straight drive (pockets against the stage 1 line, far out in the bay). Bots never order
  these; a person can, and then re-orders.

## 9. Phase 1 pacing: a fifth shorter (14 November, the phase 1 integration)

The owner's word after the first multiplayer playtest (`docs/ROADMAP.md`): every stage ran about
20% too long, so matches get about 20% shorter, as a rough cut now (tuned again in phase 3).
Balance itself waits for the owner's next playtest; it is only reported here. The aim, a fifth
off the last measured numbers (section 8): contested stages near 2:35, 2:30 and 3:05, a match
near 8:15, and the clock cut in proportion (12:00 to 9:36). The levers allowed: the three bar
fractions and the clock. `npm run sim` gained `--clock S` to try a clock without editing the
rules (like `--bar`).

### Where phase 1 left the pace

Measured first, on the whole phase 1 tree (the monster's one-move buttons and molt cards, the
army's two buttons and swarm, never alone) with section 8's numbers unchanged. Phase 1 had
already moved the stages a long way, and not evenly:

| | Stage 1 | Stage 2 | Stage 3 | Match | Kaiju wins |
| --- | --- | --- | --- | --- | --- |
| Section 8 (before phase 1) | 3:15 | 3:05 | 3:50 | 10:20 | 47% of 60 |
| Phase 1, old clock and bar, seeds 1 to 20 | 2:02 | 2:25 | 4:47 | 8:49 | 11 of 20 |
| Phase 1, old clock and bar, seeds 21 to 40 | 2:02 | 2:30 | 4:30 | 8:12 | 6 of 20 |

(Stage times are for stages the kaiju completed. Seeds 1 to 20 and 21 to 40 with
`--every-anchor`: every start twice in each batch.)

- **Stages 1 and 2 got shorter by themselves.** The squad-mates now fire at will all the time,
  and every miss that lands in the city fills the bar (DESIGN.md section 2: damage counts
  "whoever caused it"): collateral at stage 1 went from 47 to 145 points a match. A contested
  hatchling now fills its segment faster (1:39) than one left alone (2:03).
- **Stage 3 got longer.** Faster squads with a volley button catch a titan more often: 7.9 to
  8.6 staggers and 48 to 55 volleys a stage 3, against 4.6 and 33 before.
- A kaiju left alone is unchanged: 2:03 / 1:57 / 3:05 for the three segments.

### What changed

| Number (`shared/src/defs/rules.ts`) | Before | After | Why |
| --- | --- | --- | --- |
| `MATCH_RULES.clock` | 720 (12:00) | 576 (9:36) | A fifth off, as asked. |
| `MATCH_RULES.bar.p3` | 0.31 | 0.29 | Stage 3 from about 4:40 to about 3:00. |
| `p1`, `p2` | 0.18, 0.125 | unchanged | Already at or under the aim, see below. |

Trials, seeds 1 to 20, every start, all with the 9:36 clock (stage 1 2:02 and stage 2 2:25 in
all of them; the bar is the only thing that differs):

| p3 | Kaiju wins | Match | Stage 3 (completed) | Stage 3 alone |
| --- | --- | --- | --- | --- |
| 0.31 | 6 of 20 (7 by the clock) | 8:29 | 4:12 (6 completed) | 3:05 |
| 0.30 | 8 of 20 | 8:03 | 3:24 | |
| **0.29** | **11 of 20** | **7:33** | **3:02** | **2:44** |
| 0.28 | 12 of 20 | 7:24 | 2:52 | 2:32 |
| 0.27 | 14 of 20 | 7:07 | 2:43 | |
| 0.25 | 14 of 20 | 7:01 | 2:24 | 2:17 |
| 0.23 | 15 of 20 | 6:44 | 2:19 | 2:02 |

Raising `p1` to bring stage 1 up to the 2:35 aim was tried and dropped: at 0.20 stage 1 took
2:16 contested and 2:16 alone, but stage 2 grew to 2:47 (its mark is at least 1.6 times the
first) and the kaiju won 7 of 20; at 0.21, 2:23 and 2:53, and 6 of 20. Making the first stage
longer, and slower for a hatchling on its own, is the opposite of what the playtest asked for.

### The result

| | Stage 1 | Stage 2 | Stage 3 | Match | Kaiju wins |
| --- | --- | --- | --- | --- | --- |
| Aim | 2:35 | 2:30 | 3:05 | 8:15 | (not tuned) |
| Seeds 1 to 20 | 2:02 | 2:25 | 3:02 | 7:33 | 11 of 20 (7 kills, 2 by the clock) |
| Seeds 21 to 40 | 2:02 | 2:29 | 2:59 | 7:29 | 9 of 20 (9 kills, 2 by the clock) |
| Alone (`--unopposed`, 10 starts) | 2:03 | 1:57 | 2:44 | 7:06 | |

- Stages 2 and 3 are on the aim. Stage 1 is half a minute under it, so the average match is
  about 7:30, 45 s under the aim of 8:15: about a quarter shorter than section 8's 10:20
  rather than a fifth. If the owner's next playtest finds stage 1 rushed, `p1` is the lever (about 0.21 for
  2:35; it lengthens stage 2 too, see above).
- The kaiju won 20 of 40 (50%), with the old clock and bar 17 of 40 (43%). Not degenerate, so
  nothing else was touched. With 20 matches a win rate carries about 11 points of noise either
  way (section 1).
- 4 matches of 40 ended on the clock, against 2 of 40 with the old clock and bar.

Seeds 1 to 20, `npm run sim -- --seeds 20 --every-anchor`:

```
seed  start         winner          length          stage time    staggers  units lost  bar % at stage end      kaiju hp lost
----  ------------  --------------  ------  ------------------  ----------  ----------  ------------------  -----------------
1     Alder Row     humans (kill)     7:03  1:59 / 2:55 / 2:08   2 / 6 / 7   2 / 1 / 0        22 / 57 / 60  226 / 1211 / 1397
2     Bellhaven     humans (kill)     6:12  2:05 / 2:08 / 1:59   2 / 3 / 8   0 / 0 / 0        22 / 57 / 62   273 / 540 / 1399
3     Cinder Flats  humans (kill)     5:34     2:01 / 3:33 / -   2 / 7 / -   0 / 0 / -         22 / 57 / -     381 / 1716 / -
4     Dovecote      kaiju (bar)       6:54  2:10 / 2:23 / 2:21   3 / 1 / 0   0 / 0 / 0       22 / 57 / 100     295 / 287 / 81
5     Easter Green  kaiju (bar)       7:25  2:47 / 1:40 / 2:58   4 / 0 / 2   0 / 0 / 0       22 / 57 / 100    787 / 106 / 438
6     Fennel Hill   kaiju (bar)       6:38  2:01 / 2:17 / 2:20   2 / 0 / 0   0 / 1 / 0       22 / 57 / 100     337 / 227 / 42
7     Gull Point    humans (kill)     6:42  1:56 / 2:13 / 2:33   2 / 1 / 7   0 / 3 / 0        21 / 57 / 82   360 / 301 / 1317
8     Harrow Lane   humans (clock)    9:36  1:46 / 2:02 / 5:48  2 / 3 / 11   0 / 1 / 4        22 / 57 / 94   241 / 392 / 1564
9     Ivy Court     kaiju (bar)       8:55  2:05 / 3:30 / 3:20   4 / 4 / 3   4 / 6 / 0       21 / 57 / 100    501 / 568 / 569
10    Juniper Bay   kaiju (bar)       7:39  1:25 / 3:19 / 2:55   0 / 4 / 1   2 / 0 / 0       21 / 57 / 100    101 / 560 / 353
11    Alder Row     kaiju (bar)       8:29  1:49 / 2:18 / 4:22   1 / 2 / 8   1 / 4 / 0       22 / 57 / 100   152 / 278 / 1079
12    Bellhaven     kaiju (bar)       7:39  2:09 / 1:42 / 3:48   1 / 1 / 4   4 / 0 / 0       21 / 57 / 100    250 / 204 / 807
13    Cinder Flats  humans (clock)    9:36  1:38 / 3:11 / 4:47   0 / 6 / 9   1 / 3 / 1        22 / 57 / 91   81 / 1150 / 1629
14    Dovecote      kaiju (bar)       6:18  2:14 / 1:30 / 2:34   2 / 0 / 0   1 / 0 / 0       22 / 57 / 100     378 / 35 / 181
15    Easter Green  kaiju (bar)       8:46  3:21 / 2:22 / 3:03   7 / 2 / 1   0 / 6 / 0       22 / 57 / 100   1047 / 238 / 261
16    Fennel Hill   humans (kill)     7:21  1:41 / 2:23 / 3:17   1 / 2 / 8   0 / 4 / 0        21 / 57 / 92   216 / 447 / 1473
17    Gull Point    humans (kill)     8:46  2:01 / 3:49 / 2:56  2 / 10 / 8   0 / 0 / 0        22 / 57 / 82  344 / 1826 / 1478
18    Harrow Lane   kaiju (bar)       6:45  1:24 / 2:28 / 2:54   1 / 2 / 0   0 / 3 / 0       21 / 57 / 100    228 / 356 / 199
19    Ivy Court     humans (kill)     8:18  2:26 / 2:01 / 3:51   3 / 1 / 9   0 / 0 / 2        22 / 57 / 98   449 / 293 / 1473
20    Juniper Bay   kaiju (bar)       6:24  1:50 / 1:49 / 2:44   2 / 2 / 0   1 / 2 / 2       22 / 58 / 100    262 / 272 / 168

kaiju wins 11/20 (55%)   human wins 9 (45%): 7 by kill, 2 by the clock
mean match length 7:33   shortest 5:34   longest 9:36
stage 1: reached 20, completed 20, segment filled after 1:39, stage time when completed 2:02; per match: staggers 2.1, volleys 28.6, units lost 0.8, kaiju hp lost 345 (healed 48), collateral 145 points, swum 1 s (0.1 dives)
stage 2: reached 20, completed 19, segment filled after 2:08, stage time when completed 2:25; per match: staggers 2.9, volleys 26.9, units lost 1.7, kaiju hp lost 550 (healed 172), collateral 525 points, swum 3 s (0.6 dives)
stage 3: reached 19, completed 11, segment filled after 3:02, stage time when completed 3:02; per match: staggers 4.5, volleys 30.9, units lost 0.5, kaiju hp lost 837 (healed 316), collateral 1383 points, swum 0 s (0.0 dives)
```

### Limits

- Bots, not people. The squad bots release full volleys and pair them; four people may well do
  less (or more), and a person new to the monster wrecks more slowly than its bot. The owner's
  next playtest is the real measure.
- Stage 1 is short because of the squads' own stray fire. That is the rule as it stands
  ("whoever caused it"); if it should change, it is a balance question for after the playtest.
- Stage 3 is very sensitive to `p3` (0.31 to 0.27 took it from 4:12 to 2:43): a titan that
  reaches the downtown towers before the squads close in finishes quickly, one that does not is
  staggered again and again.

## 10. Phase 2 pacing: held where phase 1 left it (14 November, the phase 2 integration)

Phase 2 (`docs/ROADMAP.md`: special buildings, city weapons, supply crates and pick-ups, rubble
that stays, buildings that fall over) could speed the monster up or slow it down. The rule for
this pass: if a stage moved more than about a tenth from phase 1's numbers (section 9), bring it
back with the bar fractions; report the monster's win rate and step in on balance only if it is
lopsided (under 20% or over 80%). The final pacing pass is phase 3's.

### What phase 2 did to the pace

Measured on the whole phase 2 tree as its four builders left it, with section 9's bar
(`npm run sim -- --seeds 20 --every-anchor`, seeds 1 to 20 and 21 to 40, and `--unopposed`):

| | Stage 1 | Stage 2 | Stage 3 | Match | Kaiju wins |
| --- | --- | --- | --- | --- | --- |
| Phase 1 (section 9, 40 matches) | 2:02 | 2:27 | 3:01 | 7:31 | 20 of 40 |
| Phase 2 as built, seeds 1 to 20 | 1:59 | 2:54 | 2:48 | 7:59 | 7 of 20 |
| Phase 2 as built, seeds 21 to 40 | 2:02 | 2:59 | 2:53 | 8:06 | 8 of 20 |
| Alone, phase 1 (segment filled after) | 2:03 | 1:57 | 2:44 | 7:06 | |
| Alone, phase 2 as built | 2:13 | 2:05 | 2:09 | 6:49 | |

(Contested stage times are for stages the kaiju completed: 15 of 39 third stages here, against
20 in phase 1, so that column is a small and lucky sample.)

- **Stage 2 got a fifth longer** (2:57 against 2:27). The juvenile now spends more of the stage
  fighting: it killed nearly three times as many units there (4.5 to 4.8 a match against 1.7)
  and ate more (healed 250 to 360 hp against 170), while the squads, with their pick-ups,
  fired more volleys (31 to 36 against 27).
- **A lone titan finishes a fifth sooner** (2:09 against 2:44): a tower that falls over brings
  down what it lands on, and those count for the bar.
- **Stage 1 held**, although it changed inside: the squads fire half as many charged volleys
  there (15 a match against 29) and break the hatchling's nerve a third as often (0.6 against
  2.1). Rubble from a house hides most of a hatchling (`DESIGN.md` section 7, "Rubble and
  falls"), the garage door takes shots from the front, and the squads' own stray fire still
  fills most of the first segment.

### Found on the way: the squads stopped firing at a hatchling behind rubble

The scripted playtest's squad session (`tools/playtest/scripted.mjs`) waits for another squad's
charged volley to hit the kaiju; in phase 2 none ever did. The squad bot parked where its leader
saw the hatchling's head over a heap of rubble, held the volley button, found that most of its
planted squad-mates had no line (rubble now blocks their lines too) and let go; with nobody
planted the leader alone saw the kaiju again, so it planted again, and so on for the whole stage,
its "no line of fire" patience reset every other look. Where no firing spot near its bearing had
a line at all, it drove to the best one anyway and waited there for ever. With a hatchling
standing still (the playtest's monster player does nothing), in a whole fast stage 1 not one
squad fired a charged volley at the playtest's start, and over the ten starts (one seed) 24
squads of 40 fired none: at least one at every start, all four at one.

Fixed in `shared/src/sim/bots/squadBot.ts` (numbers in `BOT_RULES.squad`): a squad whose planted
squad-mates had no line does not plant there again; it moves on after its usual 4 s and passes
over that spot (15 m round it) for 20 s; and one that reaches its firing spot with no line at all
tries another side (its bearing turns 70°). Now 1 squad of the 40 fires none (phase 1's code: 2
of 40). Two tests in `shared/test/bots.test.ts` hold it: a wall that hides the kaiju from one
side, and a start and seed where three squads of four fired none.

### What changed

| Number (`shared/src/defs/rules.ts`) | Before | After | Why |
| --- | --- | --- | --- |
| `MATCH_RULES.bar.p2` | 0.125 | 0.11 | Stage 2 back from about 2:57 to about 2:35. |
| `MATCH_RULES.bar.p3` | 0.29 | 0.30 | A lone titan's last segment back from 2:21 to 2:28 (phase 1: 2:44); contested stage 3 stays near 3:00. |
| `p1`, the clock | 0.18, 9:36 | unchanged | Stage 1 and the match length held. |

The second mark is `max(1.6 × P1, p2 × V(stage 2))`, and at every start the second term is the
larger by five times, so `p2` alone sets it. Trials on the tree before the squad bot fix (stage 2
was 2:54 and 2:59 there with 0.125):

| p2, p3 | Seeds | Stage 2 | Stage 3 (completed) | Match | Kaiju wins | Alone: stage 2 / 3 |
| --- | --- | --- | --- | --- | --- | --- |
| 0.11, 0.29 | 1 to 20 | 2:33 | 3:00 (8) | 7:45 | 8 of 20 | 1:47 / 2:21 |
| 0.11, 0.29 | 21 to 40 | 2:36 | 2:45 (11) | 7:38 | 11 of 20 | |
| 0.10, 0.29 | 1 to 20 | 2:18 | 2:19 (8) | 7:11 | 8 of 20 | |
| 0.11, 0.30 | 1 to 20 | 2:33 | 2:59 (8) | 7:44 | 8 of 20 | 1:47 / 2:28 |
| 0.11, 0.30 | 21 to 40 | 2:36 | 2:37 (10) | 7:35 | 10 of 20 | |

### The result (the bar above and the squad bot fix, the tree as shipped)

| | Stage 1 | Stage 2 | Stage 3 | Match | Kaiju wins |
| --- | --- | --- | --- | --- | --- |
| Phase 1 (section 9) | 2:02 | 2:27 | 3:01 | 7:31 | 20 of 40 (50%) |
| Seeds 1 to 20 | 1:58 | 2:18 | 2:35 (10) | 7:16 | 10 of 20 (7 kills, 3 by the clock) |
| Seeds 21 to 40 | 2:04 | 2:51 | 3:58 (6) | 8:35 | 6 of 20 (8 kills, 6 by the clock) |
| All 40 | 2:01 (-1%) | 2:35 (+5%) | 3:06 (+3%) | 7:56 (+5%) | 16 of 40 (40%) |
| Alone (`--unopposed`, 10 starts) | 2:13 (+8%) | 1:47 (-9%) | 2:28 (-10%) | 6:49 (-4%) | |

- Every stage is within about a tenth of phase 1, contested and alone. The two batches differ a
  lot (stage 2 2:18 against 2:51, stage 3 2:35 against 3:58): with 20 matches a batch is noisy,
  and the third stage's column counts only the 16 third stages the kaiju finished.
- The monster wins 40% (16 of 40; 50% in phase 1). Not lopsided, so balance was left alone, as
  the owner asked. 9 of the 40 matches ended on the clock (4 of 40 in phase 1): more third
  stages run out of time, the squads staggering the titan more often (4.7 to 7.0 staggers a
  match against 4.5).
- Collateral (the squads' own misses) is about what it was: 140 / 580 / 1020 points a match at the
  three stages, against 145 / 525 / 1383.

### Something happening every 20 seconds

`docs/ROADMAP.md` names phase 2 "something happening every 20 seconds". Counted over the same 40
matches (a scratch script built on `shared/scripts/botMatch.ts`'s `onTick`): the moments when
something new happens to the monster or to a squad, of the kinds phase 2 added. For the monster:
a special building pays out (whoever wrecked it), it picks up, throws or swings a city weapon, a
squad takes a crate in sight of it (180 / 300 / 600 m by stage), a building falls over in sight,
or a radio's barrage is called onto it. For a squad (only while it is in the fight): it takes a
crate, a fireball or a surge goes off in sight of its leader (150 / 250 / 400 m) or a mast's
static covers its map, the monster picks up, throws or swings a city weapon in sight, a propane
tank goes off in sight, a building falls over in sight, or its own radio's barrage or
reinforcements come. Things on the same half-second count as one moment.

| | Something new, on average | 20-second stretches with something new | Longest quiet stretch (median) | Met? |
| --- | --- | --- | --- | --- |
| Stage 1, monster | every 10 s | 86% | 30 s | Yes |
| Stage 1, a squad | every 15 s | 73% | 38 s | Yes, most of the time |
| Stage 2, monster | every 30 s | 47% | 71 s | No |
| Stage 2, a squad | every 58 s | 27% | 94 s | No |
| Stage 3, monster | every 11 s | 64% | 53 s | On average yes, but falls come in bunches |
| Stage 3, a squad | every 33 s | 34% | 97 s | No |

What fills them, per minute of play: at stage 1 the monster's city weapons (2.2), crates taken
near it (2.1), special buildings (1.1); a squad's city weapons seen (2.3), specials (0.8), crates
(0.8). At stage 2: crates (1.2 near the monster, 0.6 per squad), barrages (0.7), specials (0.3),
falls (0.1). At stage 3: falls (4.9 near the monster, 1.4 per squad), crates (0.8 and 0.4).
Stage 1 is where phase 2 put its new things (all ten special-building trios stand in the starting
neighborhoods, the city weapons are the hatchling's), and it meets the goal; stages 2 and 3 do
not, for a squad least of all. Levers for later (the owner's call, not tuned here): more crates
at stages 2 and 3 (`CRATE_RULES`: one every 30 s for the squads in turn), special buildings
beyond the starting neighborhoods, city weapons a juvenile can lift.

### Limits

- Bots, not people, and 40 matches. The squads' rubble behavior is new; a person finds a line
  round a heap faster than the bot does, or not at all.
- The "something new" counts are for this definition of "in sight"; a player who watches the
  map or hears the radio notices more.

## 11. Phase 3 pacing: the final pass (14 November, the pacing task)

Phase 3 (`docs/ROADMAP.md`, "looks and sound") packed the ten starting neighborhoods close
together (narrow streets, houses up to the pavement, back lanes lined with garages; each start
worth about a quarter more), added six kinds of buildings, and put 44 more special buildings
on the way from the starts to downtown (`docs/CITY.md` section 13). This pass, the last before
the owner plays again, had three aims: keep the stage times within about a tenth of where phase
2 left them (2:01, 2:35 and 3:06; a match of about 8 minutes); make something new happen to the
monster and to each squad on average about every 20 to 25 seconds at every stage (phase 2 met
that only at stage 1, section 10), with the data the game already has and no new mechanics;
and check that the squad bots still fire their volleys in the packed streets. Balance waits for
the owner's next playtest: it was only to be touched if the monster won outside about 30 to 70%.

### Where phase 3 left the pace

Measured first on the whole tree as the phase 3 builders left it (`npm run sim -- --seeds 20
--every-anchor`, seeds 1 to 20 and 21 to 40, and `--unopposed`), with section 10's numbers:

| | Stage 1 | Stage 2 | Stage 3 | Match | Kaiju wins |
| --- | --- | --- | --- | --- | --- |
| Phase 2 (section 10, 40 matches) | 2:01 | 2:35 | 3:06 | 7:56 | 16 of 40 |
| Phase 3 as built, seeds 1 to 20 | 2:21 | 2:03 | 2:55 (9) | 7:35 | 9 of 20 (4 by the clock) |
| Phase 3 as built, seeds 21 to 40 | 2:25 | 2:06 | 3:21 (10) | 8:02 | 10 of 20 (3 by the clock) |
| Alone, phase 2 (segment filled after) | 2:13 | 1:47 | 2:28 | 6:49 | |
| Alone, phase 3 as built | 2:33 | 1:52 | 2:56 | 7:43 | |

(Stage 3 counts only the third stages the monster finished: the number in brackets.)

- **Stage 1 got a fifth longer** (2:23 against 2:01; alone 2:33 against 2:13). The first mark is
  a share of what the starting square is worth, and the packed squares are worth about a
  quarter more (1721 to 1742 points against 1326 to 1415): the first mark went from about 247 to
  312 points.
- **Stage 2 got a fifth shorter** (2:04 against 2:35) though alone it hardly moved (1:52 against
  1:47). The squads fought less well there: 17 charged volleys a match against 23 to 31, half
  the staggers. The special buildings beyond the starts were part of it (radio masts put the
  army's map to static for 10 to 12% of stage 2, against 2 to 4% in phase 2), and so were the
  squad bots' troubles in the packed streets (below).
- **Stage 3 held** (3:09 contested), though alone the titan took a fifth longer (2:56).
- The monster won 19 of 40, 7 matches on the clock.

### Found on the way: the squad bots in the packed streets

In the packed starts a hatchling is hidden from most streets. Counted at the ten starts with a
hatchling standing where it starts (street points every 5 m inside the stage 1 square; a line
of fire from a rocket squad's muzzle to the hatchling's middle, top or knees;
`/tmp/mb-scratch/pacing/los_scan.ts`):

| Street points with a line of fire, by distance from the hatchling | 48 to 64 m | 64 to 80 m | 80 to 112 m | 112 to 144 m |
| --- | --- | --- | --- | --- |
| Phase 2 city | 90% | 78% | 50% | 25% |
| Phase 3 city | 85% | 65% | 26% | 14% |

The squad bot parks 80 to 144 m out at stage 1 (half to nine tenths of its range), so it found
half as many places to fire from. In bot matches the squads fired 1.2 charged volleys per minute
in the fight at stage 1 (phase 2: 1.8), and a fifth of the squads fired none in a whole stage 1.
Watching them showed four faults, all fixed in `shared/src/sim/bots/squadBot.ts` (numbers in
`BOT_RULES.squad`):

- **It only looked at the middle of each street.** In a packed street a line of fire is often a
  gap between two houses. It now looks at spots every 20 m along every street (`spotStep`) and
  checks the 24 cheapest for a line, not 8 (`spotCandidates`).
- **It parked where only its leader could see.** It now prefers a spot its squad-mates round
  it would share the line from (to either side, or behind along the line), and only then one
  where the leader alone sees the hatchling.
- **With no line from anywhere in its band it never came closer.** Round a green in the middle of
  a block it now looks closer in, down to 0.35 of its range but never inside 1.25 times the
  distance it backs off at (`innerStandoff`, `innerMargin`), and parks there.
- **It dithered.** With no line from any spot, it turned for whichever spot was cheapest from
  where it stood, look after look (every 0.4 s), and arrived nowhere. Now it keeps going where it
  was going and looks from another side once there.

Two plain bugs turned up as well. A squad that backed off from the monster to a spot a step
short of where it felt safe again (it stops within 3 m of where it drives to) stayed there,
backing off, for the rest of the stage; now it goes back to work once it is at that spot. And a
tank whose way lay straight behind it rocked left and right on the spot for ever (its hull
answers the stick a tick late, and a hair either side of straight behind is a full turn either
way: a troop that had driven down a narrow street to a crate, its squad-mates behind it, never
came out); now it keeps turning the way it is turning until the way is in front. Two new tests
in `shared/test/bots.test.ts` hold the first: an idle hatchling on the green of Dovecote (seed
16), where two squads of four used to fire no charged volley, and a squad that backs off along a
street that ends just inside its safe distance; the fast matches in `meridianPlay.test.ts`
(nobody gives up a route) caught the rocking troop.

Charged volleys per squad-minute in the fight, and squads that fired none in a stage (of those
in the fight for at least a minute of it), over the same 40 bot matches:

| | Stage 1 | Stage 2 | Stage 3 |
| --- | --- | --- | --- |
| Phase 2 (its city, bot and numbers) | 1.77; 22 of 157 | 2.66; 34 of 157 | 2.58; 25 of 156 |
| Phase 3 as built (old bot, old numbers) | 1.22; 34 of 159 | 2.12; 34 of 155 | 2.43; 20 of 156 |
| Old bot with this pass's numbers | 1.13; 50 of 159 | 1.74; 49 of 154 | 2.20; 26 of 152 |
| **New bot with this pass's numbers (shipped)** | **1.55; 35 of 160** | **2.33; 30 of 154** | **2.17; 24 of 152** |

With this pass's numbers (more crates to fetch, a shorter stage 1) the old bot would have fired
a quarter fewer volleys again; the new one fires about a third more than the old at stage 1 and
stage 2, and breaks the hatchling's nerve twice as often (0.9 staggers a match against 0.4).
Squads spend 7 to 13% of their time fetching crates.

**At a hatchling standing still** (phase 2's check: the monster player does nothing, fast
stage 1, all ten starts, four squads each; `/tmp/mb-scratch/pacing/idle_many.ts`, seeds 1 to 12,
480 squads): 25 squads fired no charged volley (5%), against 31 on the tree as built and 16 on
phase 2's (3%). Over 20 seeds (800 squads) the old and the new bot leave the same number silent
(36 and 37): the bot changes do not help there. Those squads are at starts where the hatchling
stands on a green in the middle of a block (Cinder Flats, Gull Point, Dovecote, Bellhaven), the
nearest streets with a view lie inside the distance a squad backs off at, and the bot parks only
on streets; a person would walk onto the green. Phase 2's seed 7 check (`idle3.ts`): 3 squads of
40 fired none (as built: 3; phase 2: 1).

### What changed

| Number | Before | After | Why |
| --- | --- | --- | --- |
| `MATCH_RULES.bar.p1` (`defs/rules.ts`) | 0.18 | 0.145 | Stage 1 back from about 2:23 to 2:00 (the packed starts are worth a quarter more). |
| `CRATE_RULES.every` (`defs/pickups.ts`) | 30 s at every stage | 30 / 12 / 15 s | Something new for a squad more often at stages 2 and 3: with four squads in the fight each gets one every 48 s at stage 2 and every 60 s at stage 3, besides the one every squad gets when a stage starts. |
| `CRATE_RULES.maxDown` | 3 / 4 / 5 | 3 / 6 / 8 | So the faster drops are not held up by crates nobody has taken yet. |
| `BOT_RULES.squad.crateRange` (`defs/bots.ts`) | 60 m | 60 / 90 / 90 m | A crate comes down 25 to 90 m from the squad it is meant for; a tank reaches it in a few seconds, and a person would fetch it. On foot (stage 1) the bot still goes 60 m at most. |
| `BOT_RULES.squad.spotCandidates`, `spotStep`, `innerStandoff`, `innerMargin` | 8; middles of streets; none | 24; every 20 m; 0.35; 1.25 | The squad bot in the packed streets (above). |
| `p2`, `p3`, the clock, `SPECIAL_SITES`, the kaiju bot | | unchanged | |

How the crates are shared did not change: one in turn for each squad still in the fight (88%
of those taken at stage 2 went to the squad they were meant for). The special buildings beyond
the starts were not changed either: at stage 2 the juvenile already met one about every 55 s and
the monster had something new every 13 s; for a squad the static, surges and fireballs come
mostly when it is near the monster, and more sites would mean more of the army's map in static.

Trials for the crates (40 matches each, seeds 1 to 40, on the tree with the bot fixes but
before the rocking-tank fix; "every" is the average time between new things for a squad; the
stage 2 time depends on p1 too, the column after it):

| Crates every (stage 1/2/3), at most down, where they land | Bot fetches within | Stage 2: squad every | Stage 3: squad every | Stage 2 time | p1 | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| 30 / 30 / 30 s, 3 / 4 / 5, 25 to 90 m (phase 2) | 60 m | 39 s | 29 s | 2:25 | 0.18 | |
| 30 / 15 / 15 s, 3 / 6 / 8, 25 to 90 m | 60 m | 33 s | 22 s | 2:20 | 0.18 | |
| 30 / 12 / 15 s, 3 / 6 / 8, 20 to 60 m | 60 m | 24 s | 22 s | 2:26 | 0.18 | crates at stage 1 land closer too, and the squads fire fewer volleys there |
| 30 / 10 / 15 s, 3 / 6 / 8, 20 to 60 m | 60 m | 23 s | 22 s | 2:16 | 0.145 | squads volley a fifth less at stage 2 |
| the same at 12 s, and the juvenile seeks special buildings while nobody is within 80 m (was 110) | 60 m | 25 s | 21 s | 2:22 | 0.145 | hardly more special buildings wrecked (125 against 122), no gain for the squads |
| **30 / 12 / 15 s, 3 / 6 / 8, 25 to 90 m** | **60 / 90 / 90 m** | **24 s** | **22 s** | **2:24** | 0.145 | chosen |
| 30 / 15 / 15 s, 3 / 6 / 8, 25 to 90 m | 60 / 90 / 90 m | 26 s | 21 s | 2:25 | 0.145 | |

Trials for the bar, all with the crates landing 20 to 60 m away (the third row above):

| p1 / p2 / p3 | Seeds | Stage 1 | Stage 2 | Stage 3 (completed) | Match | Kaiju wins |
| --- | --- | --- | --- | --- | --- | --- |
| 0.18 / 0.11 / 0.30 | 1-20, 21-40 | 2:34, 2:28 | 2:31, 2:21 | 2:52 (7), 3:06 (10) | 8:03, 7:44 | 7, 10 of 20 |
| 0.15 / 0.11 / 0.30 | 1-20, 21-40 | 2:11, 2:05 | 2:21, 2:14 | 3:05 (9), 3:06 (10) | 7:27, 7:25 | 9, 10 of 20 |
| **0.145 / 0.11 / 0.30** | 1-20, 21-40 | **2:05, 2:05** | 2:25, 2:32 | 2:49 (11), 2:47 (9) | 7:38, 7:39 | 11, 9 of 20 |
| 0.145 / 0.11 / 0.305 | 1-20, 21-40, 41-60 | 2:05, 2:05, 2:00 | 2:25, 2:32, 2:35 | 3:08 (13), 3:01 (10), 3:44 (8) | 7:35, 7:46, 7:38 | 13, 10, 8 of 20 |
| 0.145 / 0.11 / 0.31 | 1-20, 21-40 | 2:05, 2:05 | 2:25, 2:32 | 3:26 (12), 3:10 (10) | 7:55, 7:48 | 12, 10 of 20 |

p3 stayed at 0.30: the third stage swings by half a minute between batches of 20, and on the
shipped tree it came out at 3:02. The second mark is `max(1.6 × P1, p2 × V(stage 2))`, and p2
sets it at every start, so lowering p1 also made the second segment about 60 points (4%) longer.

### The result (the tree as shipped)

| | Stage 1 | Stage 2 | Stage 3 | Match | Kaiju wins |
| --- | --- | --- | --- | --- | --- |
| Phase 2 (section 10) | 2:01 | 2:35 | 3:06 | 7:56 | 16 of 40 (40%) |
| Seeds 1 to 20 | 2:02 | 2:34 | 3:11 (12) | 7:41 | 12 of 20 (5 kills, 3 by the clock) |
| Seeds 21 to 40 | 1:58 | 2:30 | 2:52 (10) | 7:33 | 10 of 20 (8 kills, 2 by the clock) |
| All 40 | 2:00 (-1%) | 2:32 (-2%) | 3:02 (-2%) | 7:37 (-4%) | 22 of 40 (55%) |
| Alone (`--unopposed`, 10 starts) | 2:05 (-6%) | 1:51 (+4%) | 2:45 (+11%) | 7:02 (+3%) | |

- Every contested stage is within a few seconds of phase 2, and the match within 20 s. A lone
  titan takes a tenth longer than in phase 2 (2:45 against 2:28; phase 1: 2:44).
- The monster wins 55% (22 of 40); 5 matches of 40 ended on the clock (phase 2: 9). Not
  lopsided, so balance was left alone, as the owner asked.
- Navigation (`--nav`): units stuck 0.01 to 0.03% of their time (longest 7.5 s), as before; a
  unit gave up a route 11 times in 40 matches (the tree as built: about once in 20), nearly all
  of them squad-mates of tank troops at stage 3 that could not follow their leader. One, in a
  courtyard it could not drive out of, gave up four times: the swarm's places are checked for
  room, not for a way there (`swarmSlot` in `sim/squads.ts`, an open item from the city work).

### Something happening every 20 seconds (before and after)

Counted exactly as in section 10 (the same scratch script, now
`/tmp/mb-scratch/pacing/trial.ts`), over the same 40 matches:

| | Before: something new | Before: 20 s stretches with something | After: something new | After: 20 s stretches | After: longest quiet stretch (median) |
| --- | --- | --- | --- | --- | --- |
| Stage 1, monster | every 11 s | 85% | every 11 s | 85% | 31 s |
| Stage 1, a squad | every 17 s | 69% | every 17 s | 68% | 44 s |
| Stage 2, monster | every 23 s | 56% | every 13 s | 77% | 41 s |
| Stage 2, a squad | every 42 s | 38% | every 24 s | 56% | 51 s |
| Stage 3, monster | every 11 s | 72% | every 8 s | 84% | 33 s |
| Stage 3, a squad | every 29 s | 42% | every 23 s | 53% | 61 s |

(Phase 2, section 10: every 10 / 15 s at stage 1, 30 / 58 s at stage 2, 11 / 33 s at stage 3, for
the monster and a squad.)

The goal is met on average at every stage, for both sides. What fills it, per minute of play:
at stage 2 a squad takes a crate 1.4 times, has a barrage or reinforcements 0.6 times, sees a
special building go off 0.6 times; the monster sees a squad take a crate nearby 2.7 times, a
barrage come down beside it 1.2 times, a special building pay out 1.1 times. At stage 3 a squad
sees a building fall 1.4 times and takes a crate 1.0 times; the monster sees falls 6.4 times
and crates 2.0 times. In 40 matches 650 crates came down at stage 2 and 544 were taken (103 were
still lying there when the stage ended); at stage 3, 614 and 456. The juvenile set off a special
building about every 55 s and the titan every 2 minutes. Quiet stretches still happen: half the
squads have a stretch of 51 s (stage 2) or 61 s (stage 3) with nothing new, and a 20-second
stretch with something in it is still a coin toss for a squad at stage 3 (53%).

### Limits

- Bots, not people. A crate every 48 s for each squad at stage 2 is a lot to fetch; the bots
  spend 13% of their time at it and fire fewer volleys for it. People may take fewer (fewer
  moments) or fight less (a weaker army).
- The bot fixes bring the squads' volleys at a moving hatchling most of the way back, not all of
  it (1.55 per minute against phase 2's 1.77), and do nothing for a hatchling standing still in
  the middle of a green (above).
- The counts use the phase 2 definition of "in sight" (180 / 300 / 600 m of the monster, 150 /
  250 / 400 m of a squad's leader); a crate coming down near a squad counts only when taken.

### Re-checked at the phase 3 integration

After every phase 3 builder had finished (the sound, the monster's looks and the city on screen
change nothing in the simulation), `npm run sim -- --seeds 20 --every-anchor` and the 40-match
count above were run once more on the final tree. Both came out exactly as in this section
(seeds 1 to 20: 2:02 / 2:34 / 3:11, 7:41, the monster winning 12 of 20; seeds 1 to 40: 2:00 /
2:32 / 3:02, 7:37, 22 of 40, something new every 11 / 13 / 8 s for the monster and 17 / 24 / 23
s for a squad), as a deterministic simulation should when nothing in it has changed. Nothing was
retuned.
