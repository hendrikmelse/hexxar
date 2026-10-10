# Tutorial

The **How to play** button on the title screen opens an interactive tutorial. It runs entirely in the browser: no server, no room, nothing to join.

## Lessons

1. **Ticks and orders:** the tick dial, queuing a move and watching it run, queuing a route.
2. **Making troops:** the generation ring, owned farms speeding a city up, villages, the cap.
3. **Battles:** attacking, the defensive bonuses (villages +25%, cities +50%), a tie, and armies that meet halfway.
4. **Fog of war:** what you see in full and from afar, and exploring to find the rival.
5. **The interface:** the camera controls, the production pie, the list, and how a game is won.

The **Lessons** menu (top right) jumps to any lesson; **Back** and **Next** move between steps; **Exit tutorial** leaves.

## How it works

- A task step shows the player what to do with a pointer that drags across the tiles, over and over (it goes away when they start dragging themselves). The clock can run from the start of a step, stay stopped, or wait until the player's first order. Nothing moves the player on: they press Next.
- `tutorial/lessons.ts` is the script: each lesson is a small board (drawn as rows of characters, see `tutorial/maps.ts`), optional scripted rivals, and a list of steps. A step has the guide's text, what to point out (tiles on the board, or a part of the HUD), whether the clock runs while it is on screen, and an optional **task**: a function of the game that says when the player has done what was asked. Steps without a task are just read.
- `tutorial/localMatch.ts` is a match that runs in the browser with the real rules (`resolveTick`) and speaks the server's protocol (`snapshot`, `tick`, `queued`), so the board, HUD and animations are the same code that plays real games. Its clock can be stopped and started, so nothing happens while a step is being read.
- `tutorial/runner.ts` runs a lesson: it sets the scene for each step, checks the task after every message, moves on a moment after it is done, and puts the player back (with a message) if a step goes wrong. Each step remembers the state it began from, for retries and for going back.
- `ui/Tutorial.tsx` draws the guide's card, the lesson menu, and the pulsing outline around parts of the HUD; the board draws the outlines around tiles.

`tutorial/tutorial.test.ts` plays every lesson through with scripted orders, so a lesson that cannot be finished fails the tests.
