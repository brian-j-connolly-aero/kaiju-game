# Monster Battle 9001: Roadmap after the first multiplayer playtest

Written 14 November 2026 from the owner's notes on the first multiplayer session and their
answers to the plan. This is the work list for the next three phases. The owner plays the
result after phase 3, not between phases. Where this file and `docs/DESIGN.md` disagree, this
file is the newer intent: change `DESIGN.md` to match as each piece is built.

## What the playtest said

- The tunnel worked between several computers.
- The monster player (new to the game): too slow and a bit boring, not enough small milestones,
  too many controls at the start and nothing to unlock. After the squads were all dead she stood
  around wrecking buildings to reach the next stage. The beam was the best part.
- The owner, playing the army: could not tell how to pick a weapon or fire a volley (there was
  no weapon to pick: the wheel gave orders to the squad), got an artillery circle on the ground
  but could not tell it had fired, the tank felt like walking, and on foot the movement paused
  every few steps.

## The owner's decisions

- **Speeds.** The speeds were fine. The army is always 10 to 20% faster than the monster at the
  same stage, so a squad can run away while the monster can still throw things at it. Tighter
  streets and shorter sight lines (phase 3) keep that fair.
- **Third person by default** for both sides. V still switches.
- **The beam is not in the starting kit.** It is a big early reward: one of the choices at the
  first molt.
- **Brace** is no longer free. Players who like to block can choose it at the second molt.
- **Smoke and mark are gone** ("too much already, we'll be back to army later"), and so are the
  command wheel, the number keys, map orders and the artillery button.
- **Balance later.** The rule that two squads' charged volleys within 5 seconds stun the monster
  stays. One person with bots found the monster too strong; four people may find the army too
  strong. Fine for now: balance testing comes after the owner's next playtest. Pacing is
  different: every stage ran about 20% too long, so matches get about 20% shorter.
- **Tests stay lean.** Keep regression tests that guard real behavior; delete tests, rules and
  code that no longer apply. The game is growing and changing shape.
- **Slides** at the end: a picture-dense development log. Every slide is pictures, at most one
  sentence per picture (more only as labels on the picture). Not too many slides.

## Phase 1: easy to pick up for both sides

**Both sides**

- Fix the on-foot stutter. Leading suspect: when an input message reaches the server a little
  late, the server guesses and moves the unit, then also applies the late message (one step
  too many); the extra messages pile up and the server throws some away to catch up, which
  pulls the player's screen back. Measure first, then fix.
- Third person by default.
- Matches about 20% shorter (a rough cut now, tuned again in phase 3).

**The monster (Gragnor)**

- Starting kit, one move per button, no tap-versus-hold:
  - Left button: Swipe. While holding something: Throw it at the crosshair.
  - Right button: Grab what is in reach. While holding something: Eat it (heals). With nothing to
    grab but something edible in reach: eat that.
  - Space: Stomp.
  - F: Molt, one press, when the bar offers it.
  - Swimming stays automatic.
- At each molt the monster picks one new move from three pictures (no text). The pictures
  appear when the cocoon starts; a random one is given if none is picked by the end of the
  intermission. The first pick goes on Q, the second on E.
  - First molt: **Beam**, **Roar** or **Charge**.
  - Second molt: the two not taken, plus **Brace** or **Tail sweep** (the match's random draw
    picks which).
- The moves:
  - **Beam:** as now, powered by rage. Rage builds from the start of the match, so taking the beam
    at the first molt can mean it is ready at once.
  - **Roar:** now stuns. Every unit in range freezes for a moment (cannot move or fire, loses its
    charge; a player's own unit stops answering), then is shaken as before.
  - **Charge:** slow to start, hard to turn, a few seconds at about twice walking speed, smashes
    small buildings and throws units aside, ends in a stumble.
  - **Tail sweep:** a quick sweep of the rear half that knocks units back and hits buildings
    behind.
  - **Brace:** hold to brace, as before.
- **Never alone:** when every squad has been wiped out, nearby buildings collapse until the bar
  reaches the stage's mark and the cocoon starts by itself. At stage 3 that fills the bar: the
  monster wins.
- Shots at the head and the tail count: the hit volume follows the body, not just a column
  around its middle.

**The army**

- Left button: Fire (holding it keeps firing).
- Right button: Volley. Hold it: the three squad-mates stop, aim at the crosshair and charge,
  while a big meter fills. Let go: everyone fires together. Let go early for a weak shot.
- Squad-mates follow the player as a loose swarm and shoot on their own.
- Speeds 10 to 20% above the monster's at every stage.
- Real tank driving at stages 2 and 3: W and S drive, A and D turn the hull, the turret turns
  toward the mouse at its own pace, and the camera sits behind the tank looking where the player
  looks.

## Phase 2: something happening every 20 seconds

**Built** (14 November 2026; `docs/STATUS.md`, the phase 2 sections at its end). In bot matches something new happens about every 10 to 15 s at stage 1, but only every 30 to 60 s at stage 2 and, for a squad, every 33 s at stage 3 (`docs/BALANCE.md` section 10).

- **Monster weight:** footsteps shake the screen, cars bounce, windows shatter, buildings wobble
  when it stomps, the view widens while it walks. The army gets a sense of speed too.
- **Special buildings** in every starting neighborhood, each with a reward you can see:
  - Power substation: a power surge (the monster's moves recharge, its stripes crackle, its
    attacks hit harder for a few seconds, and rage jumps).
  - Gas station: a fireball that hurts and shakes squads nearby.
  - Radio mast: the army's map turns to static for a while, and the fallen mast can be thrown
    like a javelin.
- **The city as a weapon**, small monster first: propane tank (explodes, and army shots can set it
  off), water tank (a splash that knocks squads over), antenna (a javelin that flies straight and
  far), fast-food sign (a club for a few big swings), garage door (a shield against shots from
  the front until it breaks).
- **Army pick-ups** on the ground, lasting until the stage ends: machine gun, big cannon, missile
  pod, artillery radio, reinforcements.
- **Rubble** stays as half-height mounds that still block shots and sight; some tall buildings fall
  over on their side.

## Phase 3: looks and sound

**Built** (14 November 2026; `docs/STATUS.md`, the phase 3 sections at its end; what to try at the next playtest: `docs/PLAYTEST.md`). The natural-sounding voices were already done in phase 1. In bot matches the stages take about 2:00 / 2:32 / 3:02, and something new happens to the monster about every 8 to 13 s and to a squad every 17 to 24 s at every stage (`docs/BALANCE.md` section 11).

- Natural-sounding radio and news voices.
- Two or three versions of each monster attack, slash trails, glowing stripes.
- More kinds of buildings, packed closer together where the match starts; roofs colored by
  district.
- Hills on the horizon. Hills inside the city wait: every rule assumes flat ground.
- The monster can squash and eat civilians (a puff, no gore).
- Final pacing pass, then the slide deck.

## Round 4: after the second playtest (16 November 2026)

The owner hosted on their own computer and played through the tunnel. Verdict: "much improved,
it's fun": the monster's molt picks, the army's charged volley and the rubble all worked, and the
old stutter on foot is gone. The owner plays again on 16 November in the afternoon, a live
multiplayer game (the players talk on a voice chat of their own, so the game needs no voice
chat).

The owner's decisions for this round:

- **Stutter through the tunnel.** Every 20 seconds or so the player's own body snaps back
  ("rubber banding"). Find out why with a small hidden on-screen readout and a log of slow
  server moments, reproduce it here with a slow, jittery connection, and fix it if it is the
  game's own fault. If it is only the tunnel, say so and stop: no big network project.
- **Voice lines: the automatic lines go.** Every automatic radio and news line goes, the news
  anchor included, except the one that says the monster is ready to molt. In their place a
  **communication rose**: a player holds a key, picks a wedge, and their character says
  something. The army's lines are inane schlocky monster-movie radio nonsense, one sentence
  each, shouted (lots of exclamation marks), through a radio filter. The monster gets roars,
  snuffles and a little musical mating call. None of it changes the game. A later voice pass
  with a commercial voice service will redo the lines.
- **The destruction bar** filled past the molt marker a little before the molt was offered:
  the marker and the moment must match.
- **Restart** from the Escape menu.
- **Controls card (H):** five things at most per side, big pictures.
- **The titan wading:** at stage 3 it showed no sign of being in water, because the water has no
  depth. It must visibly stand in deep water (and wade).
- **Throwing** is the monster's main answer to the army, and it is clumsy. Throws follow real
  ballistic arcs (they can lob over buildings), aimed where the monster looks, with no aiming
  delay: monsters throw fast. The arc is shown as a tube whose round cross-section grows with
  distance, so the player reads at a glance where it can land. Not too accurate: an unmoving
  squad about five monster lengths away is hit most of the time; farther, less often.
- **Army pick-ups** replace the main weapon's icon (as now) and change both the normal fire and
  the charged volley.
- **Civilians** popped in and out every few seconds: they must not.
- **Grabbable things glow** on the monster's screen, brighter when in reach.
- **Music:** longer, faster, more of it: pulse-pounding late-1990s high-end arcade style, a few
  tracks. The molt and upgrade music stays.
- Also agreed: foot squads must fit through the gaps between houses (their body is far wider
  than the soldiers drawn); the power surge must say what it does; the monster's screen gets the
  same kind of flair as its new attack animations, with a charge-up style rage meter of its own
  (styled differently from the army's diamond); the fallen radio mast's top got stuck when the
  owner tried to throw it.
