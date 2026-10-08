# Hexxar

Online multiplayer conquest game on a shared hex map, played in the browser at **hexxar.io** (currently a closed beta: visitors need an access code).

Players command armies by placing orders into a **queue**. Orders don't execute immediately: every tick (1.5 seconds by default) the server pops one order from each player's queue and resolves them all simultaneously. Planning ahead, queue management, and reading your opponents' moves are the core of the game.

## Design pillars

1. **Server-authoritative.** The server owns the truth. Clients send intent, never results.
2. **Deterministic simulation.** Given a state and a set of orders, a tick always produces the same next state. This makes testing, replays, and debugging easy.
3. **Shared game logic.** Hex math, order validation, and tick resolution live in one package used by both server and client (the client uses it to predict tile progress between ticks).
4. **Thin clients.** The client renders state and collects input.

## How the game works

- **Matches:** separate, self-contained games with no persistent world. A **Duel** is 2 players on a symmetrical board; a **Battle Royale** is 3 to 12 players on a random board sized to the number of players. Every board has a random outline (rough coast, lakes) and is generated from a seed, so it is reproducible. See [`docs/map-generation.md`](docs/map-generation.md).
- **Map:** a grid of hexes using axial coordinates `(q, r)`. Each tile has a **type** (farmland, village, city) with its own rules for troop generation and defensive bonus, plus an optional owner. Types are data in `packages/shared/src/tiles.ts`. Neutral tiles hold a small defensive-only garrison. Only cities and villages produce troops, faster the more farmland around them you own. Each producer's progress is shown to its owner as a ring of segments.
- **Orders:** `move(from, to)` sends all but one troop to an adjacent hex. Each player has **one global queue** with **no length limit**. Orders are append-only: **no reordering and no cancelling**. Once queued, an order is a commitment.
- **Ticks:** every tick the server takes the head of every queue and resolves them all at once. Invalid orders are dropped. The full rules are in [`docs/tick-resolution.md`](docs/tick-resolution.md).
- **Planning period:** a match is created when the room starts, and the first tick comes 5 seconds later (`PREP_MS`). You can look over the map and queue your opening orders meanwhile; a quick animation points out where you start.
- **Winning:** last player standing. A player is beaten once they own no cities or villages and every farm they have left holds a single troop. You can surrender at any time (an immediate message, not a queued order).
- **Match settings:** every match carries its own `MatchConfig` (`packages/shared/src/config.ts`): tick interval, troop generation speed, starting troops, fog mode. Private games let the host change them.
- **Lobbies:** quick play, private games by code or link, a vote to start a Battle Royale early, and reconnects with auto-surrender after two minutes away. See [`docs/lobby.md`](docs/lobby.md).
- **Fog of war:** you see your own tiles and the ring around them in full, the next ring as owner and type only, and clouds beyond that. The server only ever sends clients the output of `visibleState`, so hidden information never reaches them. The scoreboard (production pie and list) is not fogged. See [`docs/fog.md`](docs/fog.md).
- **Replays:** the sim is deterministic, so a match is fully described by its seed, players and per-tick orders. The server already keeps that log; storing it is not built yet.

## Stack

| Layer    | Choice                                                                                 |
| -------- | -------------------------------------------------------------------------------------- |
| Language | TypeScript everywhere, in a **pnpm** workspace                                         |
| Client   | **Vite**, **PixiJS** for the board, **React** for menus; the in-match HUD is plain DOM |
| Server   | **Node.js** with `ws`; also serves the built client and a health check                 |
| Protocol | JSON over a WebSocket at `/ws`, validated with **zod** (schemas in `shared`)           |
| Testing  | **Vitest**                                                                             |
| Hosting  | Docker on a VPS behind Caddy, deployed by GitHub Actions (see below)                   |

```
hexxar/
├── apps/
│   ├── client/        # Vite + PixiJS board, React menus, DOM HUD
│   └── server/        # lobby, rooms, matches, tick loop, HTTP + WebSocket
├── packages/
│   └── shared/        # pure TS: hex math, tiles, orders, tick resolution, map generation, protocol
├── deploy/            # server-side files and the deployment runbook
├── docs/              # rules and design notes
└── Dockerfile
```

`packages/shared` has **no** Node or DOM dependencies, so it runs in the server, the browser, and tests.

## Getting started

Requires Node 22+ and [pnpm](https://pnpm.io) 10 (`corepack enable` or `npm i -g pnpm`).

```sh
pnpm install
pnpm dev          # server on port 8080 (WebSocket at /ws), client on http://localhost:5173
```

Other scripts: `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm format`, `pnpm build`.

Open `http://localhost:5173` in two browser tabs (each tab is its own guest) and press **Duel** in both (or three or more tabs on **Battle Royale**, which starts after a short wait or a vote), or create a private game in one and join it with the code or link from the other.

**Controls:** left-drag from one of your tiles across neighboring hexes to queue a path of moves (a preview is shown while you drag; the moves are queued when you release, and Esc cancels). You can start a drag from the end of your queued path to extend it. Right-drag (or middle-drag) pans, the wheel zooms, and the buttons at the bottom right zoom, show the whole board, or jump to your land. The left button never pans, so a stray drag can't queue anything by accident.

### Server settings

Environment variables, or a `.env` file in the repository root (see `.env.example`):

| Variable             | Default | Meaning                                                                             |
| -------------------- | ------- | ----------------------------------------------------------------------------------- |
| `BETA_CODE`          | (empty) | Access code visitors must enter before they can play. Empty means open to everyone. |
| `PORT`               | 8080    | Port for the page, health check and WebSocket                                       |
| `STATIC_DIR`         | (unset) | Folder with the built client to serve (the Docker image sets it)                    |
| `PREP_MS`            | 5000    | Planning period between a match being created and its first tick                    |
| `EARLY_START_MS`     | 60000   | How long a public Battle Royale waits for more players once it has 3                |
| `JOIN_WAIT_MS`       | 10000   | A join tops that wait up to at least this                                           |
| `VOTE_START_MS`      | 5000    | The wait after a successful vote to start early                                     |
| `AFK_MS`             | 120000  | How long a disconnected player has before surrendering                              |
| `FINISHED_LINGER_MS` | 600000  | How long a finished game's room stays open                                          |
| `STATS_MS`           | 2000    | How often the menu's online counts are refreshed                                    |

`VITE_SERVER_URL` points the client at a different WebSocket server (used by tests and screenshots).

## Deployment

Pushes to `main` run the checks, build a Docker image, push it to GitHub Container Registry and deploy it to the VPS over SSH. The runbook, including DNS, the server layout and rolling back, is in [`deploy/README.md`](deploy/README.md).

## Not built yet

Accounts and ranked play, persistence (match history, replay storage and a viewer), more tile types and orders, spectators, bots, a public game list, and mobile-friendly UI. All tile and generation numbers are placeholders to be balanced by playing.
