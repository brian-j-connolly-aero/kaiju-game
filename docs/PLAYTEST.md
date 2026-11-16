# What to try at this afternoon's playtest (16 November)

Everything below is new since the second playtest. The computer bots and the test scripts have
played it all; people have not. Your afternoon is the real test.

## Starting

1. Get the new version: double-click `host/update.cmd` (or unpack the new zip over the old
   folder), then `host/start.cmd`. It shows the link for your friends and checks that it works.
   Full steps and what to do if something goes wrong: [HOSTING.md](HOSTING.md).
2. Open http://localhost:2567 yourself, create a room, send the link. Send your friends
   [PLAYING.md](PLAYING.md) too: it now explains the communication rose and throwing.
3. Talk on your own voice chat (Discord). The game has no voice chat of its own.

## What changed since last time

**Talking and restarting**
- The automatic radio and news chatter is gone. The only line left: once per molt the
  television news tells the monster's player the creature is ready to shed its skin.
- **Hold Z** (d-pad down on a controller): a ring of pictures opens round your crosshair. Move
  the mouse to one and let go. The army shouts a silly one-sentence 1950s monster-movie line
  over the radio in its squad's voice, with a subtitle; the monster roars, snuffles, growls,
  chomps, purrs or sings a little mating call. Everyone hears it; it changes nothing in the
  game. One every two seconds. Let go in the middle to say nothing.
- **Restart:** the host presses Escape, then the circular arrow twice (red after the first
  press). Everyone starts over on the same sides.

**The monster**
- **Throwing on real arcs.** Holding something, you see a yellow arc from your hand, a tube that
  widens with distance, and a ring where it can land. Look higher to throw farther or to lob
  over a house; look lower to throw short and flat. It lands somewhere in the ring: a squad
  standing still about five of your lengths away is hit about three times in four, twice as far
  about once in four. The camera moves over your right shoulder while you hold something.
- **What you can pick up glows** gold, brighter and pulsing within reach of your hand.
- **Rage:** three claw marks round your crosshair heat up from a dark scar to white-hot, and throb
  when the beam is ready.
- **The power surge** now shows a big blue lightning badge with a ring that runs down, and every
  hit flashes electric.
- **The titan wades:** in the bay, the river and the moat it stands in the water up to its
  thighs, with foam and a wake, and moves at 70% of its speed.
- The fallen radio mast's top can be picked up and thrown at every size, and throws from beside
  rubble fly over it instead of sticking.

**The army**
- Squads on foot squeeze through the narrow gaps between houses; the other units follow.
- A crate's weapon now changes the charged volley too: a hail of tracers (machine gun), heavy
  shells (big cannon) or a flight of missiles (missile pod).

**Both sides**
- The controls card (H) shows at most five big pictures: only what you can do right now.
- Civilians no longer pop in and out of view.
- The molt picture under the city bar lights up exactly when the bar reaches it.
- New, faster match music, one track per stage, and a last-minute track with an alarm that ends
  exactly as the clock runs out.
- The snapping back through the tunnel: a connection stall of up to a second no longer pulls
  your body back, and a few small jolts the game caused itself are fixed.

## What to try

- **Monster:** throw cars at squads near and far; lob one over a house. Can you read at a glance
  where it will land, by day and at night, and at the biggest size? Does the camera move over
  the shoulder feel jumpy? Does the glow make the garage doors and propane tanks read as things
  to pick up, or is a street of cars too busy?
- **Army:** do the narrow gaps help or get you stuck? Does a thrown car feel dodgeable but
  dangerous? Do the crate volleys feel worth it?
- **Everyone:** use the rose a lot. Are the shouted lines understandable through the radio
  crackle? Which squad voices sound too alike? Does the music get tiring, or drown the effects?
  Try one restart.

## If your character snaps back

Press **`** (the key under Escape, left of 1). A small panel opens at the top left with the
connection's numbers and a 30-second graph. Right after a snap, take a screenshot of the whole
screen. After the session, double-click `host/logs.cmd` and copy the window. Send both, with who
played which side and roughly when. In the graph a tall red bar is a snap, a blue spike with it
means the connection stalled, and purple marks mean that computer froze for a moment. Press **`**
again to close it. More in [HOSTING.md](HOSTING.md), section 6, item 9.

## Known risks

- **Nobody has heard the new sounds:** the rose lines, the monster's noises and the new music
  were checked by measurement only (no speakers here). Tell us what sounds wrong or too loud.
- Throwing was tuned with bots. The speed and accuracy may need another pass, the landing ring
  is small on screen at the biggest size, and the arc does not show soldiers in the way.
- Balance is from bot matches only: the monster won 8 of 20 (16 of 40 over a longer run). Four
  people may find either side too strong; that is the next round's job.
- If several squads talk at once their lines wait their turn; a line still waiting after four
  seconds is dropped.
- Connection stalls longer than a second still snap you back: that is the tunnel or the network.
- In a narrow gap the squad's camera sits very close, and some soldiers drawn may overlap a wall.
- The pictures here were drawn without a graphics card. If anything looks broken or runs
  slowly, a screenshot helps.
