# Tutorial

The **How to play** button on the title screen opens an interactive tutorial. It runs entirely in the browser: no server, no room, nothing to join.

## Lessons

1. **Ticks and orders:** the tick dial, queuing a move, watching it run, queuing a route.
2. **Making troops:** the generation ring, owned farms speeding a city up, the cap.
3. **Marching armies:** all-but-one troop, chains of moves, joining armies, the camera.
4. **Battles:** attacking, strength, and the defensive bonuses (farm 100%, village 125%, city 150%), including an attack that fails and a retry.
5. **Armies that meet:** two armies marching into each other fight halfway, with no bonuses.
6. **Fog of war:** what you see in full, what you see from afar, and clouds.
7. **The scoreboard:** the production pie, the ordering of the list, and how a game is won.

The **Lessons** menu (top right) jumps to any lesson; **Back** and **Next** move between steps; **Exit tutorial** leaves.

## How it works

- `tutorial/lessons.ts` is the script: each lesson is a small board (drawn as rows of characters, see `tutorial/maps.ts`), optional scripted rivals, and a list of steps. A step has the guide's text, what to point out (tiles on the board, or a part of the HUD), whether the clock runs while it is on screen, and an optional **task**: a function of the game that says when the player has done what was asked. Steps without a task are just read.
- `tutorial/localMatch.ts` is a match that runs in the browser with the real rules (`resolveTick`) and speaks the server's protocol (`snapshot`, `tick`, `queued`), so the board, HUD and animations are the same code that plays real games. Its clock can be stopped and started, so nothing happens while a step is being read.
- `tutorial/runner.ts` runs a lesson: it sets the scene for each step, checks the task after every message, moves on a moment after it is done, and puts the player back (with a message) if a step goes wrong. Each step remembers the state it began from, for retries and for going back.
- `ui/Tutorial.tsx` draws the guide's card, the lesson menu, and the pulsing outline around parts of the HUD; the board draws the outlines around tiles.

`tutorial/tutorial.test.ts` plays every lesson through with scripted orders, so a lesson that cannot be finished fails the tests.
