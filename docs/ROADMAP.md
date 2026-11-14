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

- Natural-sounding radio and news voices.
- Two or three versions of each monster attack, slash trails, glowing stripes.
- More kinds of buildings, packed closer together where the match starts; roofs colored by
  district.
- Hills on the horizon. Hills inside the city wait: every rule assumes flat ground.
- The monster can squash and eat civilians (a puff, no gore).
- Final pacing pass, then the slide deck.
