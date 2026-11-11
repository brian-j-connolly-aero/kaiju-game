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
npm run sim -- --seeds 8 --fast                # the short MB_FAST timers and bar
npm run sim -- --seeds 3 --events --json       # event counts; reports as JSON
```

Columns: winner and why, match length, time per stage, kaiju nerve breaks (staggers) per stage,
units lost per stage, the bar at the end of each stage (as a percentage of the skyline, where
the three marks sit at 21, 57 and 100), kaiju health lost per stage. The summary adds, per
stage, how long the kaiju took to fill its segment, volleys, healing and the squads' collateral.

The harness is deterministic: the same seed and the same code give the same match
(`shared/test/determinism.test.ts`; the tables in section 4 were run twice and came out
identical). A change to any number reshuffles every match, so compare
summaries over 20 seeds or more, never single rows. With 20 matches a win rate carries about
plus or minus 11 points of noise; the three batches in section 4 show it.

## 2. Targets (DESIGN.md section 2)

| Target | Measured with |
| --- | --- |
| A kaiju left alone fills a stage's segment of the bar in 100 to 130 s | `--unopposed`, "segment filled after" |
| A contested stage lasts roughly 200 to 230 s | default run, "stage time when completed" |
| A match ends in 10 to 12 minutes | default run, "mean match length" |
| Neither side wins more than about 65% with equal bots, over about 20 seeds | default run |
| Scattered fire alone rarely kills; coordinated volleys do | health lost in and out of staggers; kills |

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

## 4. After

20 matches, seeds 1 to 20, with the numbers now in `shared/src/defs/`:

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

## 5. What changed, and why

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
