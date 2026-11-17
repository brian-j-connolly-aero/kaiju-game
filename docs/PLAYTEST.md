# What to try at the next playtest (round 5)

Everything below is new since the third playtest (the first live game, five players from home).
The bots and the test scripts have played it all; people have not. Your evening is the real test.

## Starting

1. Get the new version: double-click `host/update.cmd` (or unpack the new zip over the old
   folder), then `host/start.cmd`. It shows the link for your friends and checks that it works.
   Full steps: [HOSTING.md](HOSTING.md).
2. Before you start, worth trying on the host computer (sensible, not yet measured on Windows):
   close heavy programs, do not share your screen in the voice chat, plug a laptop in and pick
   the **Best performance** power mode, and give Docker or Podman at least **2 processors**
   ([HOSTING.md](HOSTING.md) section 6, item 7).
3. Send your friends [PLAYING.md](PLAYING.md). Everyone: if the game shows only a few pictures a
   second, turn on **Use graphics acceleration when available** in the browser and restart it.

## What changed since last time

**The lag** (your notes: "terrible lag").
- When the host computer is too busy for a moment, the game now catches up afterwards. Before,
  it skipped that moment and from then on everyone's keys reached the game later and later, for
  the rest of the match. In our five-player test with the host computer stalling every 10
  seconds, the worst delay climbed from 0.1 s to **1.2 s** by the end of the match before, and
  stayed at **0.1 to 0.16 s** now.
- When a player's browser freezes for a moment, it now sends every key press it owes. Before,
  their steering was ignored and their body stopped and snapped back a second later: after 17
  of 20 freezes in our test, **0 of 26** now.
- Right after the host computer stood still, everything runs up to four times as fast for a
  fraction of a second while the game catches up. That is on purpose.

**The army's shooting**
- **The machine gun streams:** hold the left button, about six tracers a second. Its charged
  volley works, and both hit harder than your own gun.
- **A word under the crosshair always says whether you can volley:** READY, or why not (SHAKEN,
  STUNNED, RELOAD, LANDING, NO LINE, TOO FAR, NO SQUAD). Holding the right button: CHARGING,
  READY past the notch, FIRE! when full. After you let go: VOLLEY!, WEAK, NO SHOT or IMMUNE.
- **The weird yellow circle is gone.** TEAM UP now shows beside the monster's nerve bar when
  another squad's volley has just landed and yours would break it.
- **BLOCKED:** the crosshair turns red with a bar when your own shot would hit cover in front of
  the monster.

**The monster's throwing**
- **The throw lands where the crosshair is** (street, roof, squad). The game picks a flat throw
  or a lob over a house. A bold orange arc, a filled circle and a dashed ring mark the landing,
  by day and at night.
- **Red with a word means it cannot get there:** TOO FAR, BLOCKED, TOO CLOSE; BLOCKED for a beam
  stopped by a building; TOO TALL for the building that will stop a charge.
- **Who hit you:** a red ring round the squad that shot you, or a red arrow at the screen's edge.

**Words beside every picture.** Every button, bar, card, rose wedge and menu has a label of one
or two words in capitals, and the button's word follows what it does right now (the monster's
left button says THROW while it holds something).

## What to try first

1. **Play one whole match on the same sides as last time** and say: do keys still feel late? Does
   anyone snap back? Do other players jump about? Say who played the monster.
2. **Army:** take a machine gun crate and hold the left button on the monster; then hold the right
   button and let go at FIRE!. Watch the word under your crosshair: did you always know whether
   you could volley? Volley together with another squad when TEAM UP shows.
3. **Monster:** throw cars at squads near and far, and at a squad behind a house. Does it land
   where you pointed? Is the landing mark easy to see at the biggest size and at night?
4. **New players:** before they press anything, ask them what each button does. Note any word
   that was unclear, wrong, or missing.

## After the session: save the log and send it

1. Double-click `host/savelog.cmd`. A folder **Monster Battle logs** opens on the desktop with
   the file selected (`stop.cmd` and `update.cmd` also save one first, by themselves). It says
   for every player, minute by minute, how late their keys were, how often they snapped back and
   whether their page froze, and every moment the host computer was too busy.
2. Send that file, with who played which side, and which seat was the host.
3. About the host computer: Docker or Podman, how many processors and how much memory (Windows:
   Settings, System, About), and whether anyone shared a screen in the voice chat.
4. If something felt laggy at one moment: press **`** (left of 1) to open the network readout,
   take a screenshot at once, and say roughly when.

If `savelog.cmd` does not work, double-click `logs.cmd`, copy everything in the window and send
that instead.

## Known risks

- **The lag fixes were tested on this machine, not on yours.** We made the host stall and the
  players' browsers freeze on purpose and the game now copes. Whether your computer was stalling,
  or the tunnel, or a player's browser, we cannot tell without your log. A stall on someone's own
  internet line of over a second still snaps them back.
- **`savelog.cmd` has never been run on Windows** (checked line by line only). If it fails, use
  `logs.cmd` as above.
- A browser drawing only a few pictures a second still plays badly (choppy, about half its key
  presses a little late); graphics acceleration is the fix.
- **Nobody has used the new words, the machine gun or the throw in a real fight.** All of it was
  judged on pictures drawn without a graphics card. The words may look large on a big television.
- A throw lands where the crosshair is, not where a running squad will be: aim ahead of it.
- **Balance** in bot matches: the monster won 8 of 20 (22 of 40 over a longer run), against 8 of 20
  and 16 of 40 last time; within what bots can tell. Watch whether the army's machine gun or the
  monster's easier throwing tips it.
