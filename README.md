# Hexxar

Online multiplayer conquest game on a shared hex map, played in the browser at **hexxar.io**.

Players command armies by placing orders into a **queue**. Orders don't execute immediately: every tick (~2 seconds) the server pops one order from each player's queue and resolves them all simultaneously. Planning ahead, queue management, and reading your opponents' moves are the core of the game.

> **Status:** planning only. Nothing is set up yet. This document is the proposal to agree on before scaffolding.

---

## Design pillars

1. **Server-authoritative.** The server owns the truth. Clients send intent, never results.
2. **Deterministic simulation.** Given a state and a set of orders, a tick always produces the same next state. This makes testing, replays, and debugging easy.
3. **Shared game logic.** Hex math, order validation, and tick resolution live in one package used by both server and client (the client uses it for instant order validation and queue previews).
4. **Thin clients.** The client renders state and collects input. This keeps a future mobile/desktop port cheap.

## Core mechanics (draft)

- **Matches:** the game is played in separate, self-contained matches (no persistent world). Planned modes:
  - **Duel / small match:** 2-6 players on a **symmetrical** board, so every player starts with an equal position. Duels are ranked and require an account.
  - **Royale:** up to ~100 players on a **randomly generated** board. Guests can join.
  - Board generation is seeded and deterministic: `generate(mode, playerCount, seed) -> initial state`.
- **Map:** a grid of hexes using axial coordinates `(q, r)`. Each tile has a **type** (farmland, village, city; more later) with its own rules for troop generation and defensive bonus, plus an optional owner. Types are data in `packages/shared/src/tiles.ts`. Neutral tiles start with a small defensive-only garrison. Only cities and villages produce troops, faster the more of the farmland around them you own (details in [`docs/tick-resolution.md`](docs/tick-resolution.md)). Each producer has its own progress, shown to its owner as a ring of segments.
- **Armies:** each tile holds one army, a troop count belonging to the tile's owner.
- **Orders:** e.g. `move(from, to)` (all but one troop, one adjacent hex per tick), later `attack`, `fortify`, `build`. Each player has **one global queue**, with **no length limit**. Orders are append-only: **no reordering and no cancelling**. Once queued, an order is a commitment, which is what makes the queue the central strategic element. (The server still needs a sanity cap against abuse/spam; it's an anti-abuse limit, not a game rule.)
- **Tick:** every 2s by default (configurable, see below) the server takes the head of every player's queue, validates it against the current state, and resolves all of them simultaneously.
- **Conflict resolution:** each tick resolves in four phases: (1) commanded armies depart, (2) armies arriving on friendly territory reinforce, (3) armies arriving on hostile territory attack, (4) on each contested tile the strongest participant fights the second strongest and all others are removed. Full spec and edge cases in [`docs/tick-resolution.md`](docs/tick-resolution.md). Resolution never depends on player ordering or connection speed.
- **Winning:** last player standing. Players may surrender at any time (an immediate message, not a queued order).
- **Match settings:** every match carries its own config (`MatchConfig` in `packages/shared/src/config.ts`): tick interval (default 2s), troop generation speed, starting troops, fog mode. Defaults apply for anything unspecified, which is the foundation for user-created custom games. The server's `TICK_MS` is a temporary global override until matches exist.
- **Invalid orders:** if an order is invalid at execution time (target gone, army dead), it is dropped and the tick passes without it.
- **Fog of war:** not in the first versions, but designed in from the start. The shared package exposes `visibleState(state, playerId)`, and the server only ever sends clients the output of that function. Initially it returns the full state; later it filters by vision. Diffs are computed per player for the same reason.
- **Replays:** because the sim is deterministic, a match is fully described by `(mode, seed, players, per-tick orders)`. Storing that gives replays for free, no recording of state needed.

## Proposed stack

| Layer          | Choice                                                                                                 | Why                                                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Language       | **TypeScript** everywhere                                                                              | One language, shared types and game logic between client and server.                                                                 |
| Monorepo       | **pnpm workspaces**                                                                                    | Simple, fast, no extra tooling needed at this size.                                                                                  |
| Client build   | **Vite**                                                                                               | Fast dev loop, minimal config.                                                                                                       |
| Rendering      | **PixiJS** (WebGL, canvas fallback)                                                                    | Handles large hex maps, zoom/pan, and animation well. UI chrome (queue panel, menus) is plain **React** (or Preact) over the canvas. |
| Server runtime | **Node.js**                                                                                            | Matches the shared TS code; the game loop is a simple `setInterval`-style tick.                                                      |
| Transport      | **WebSocket** (`ws`)                                                                                   | Bidirectional, low latency, works everywhere. No need for WebRTC with a 2s tick.                                                     |
| Message format | JSON at first, with schema validation (**zod**)                                                        | Easy to debug. Can move to a binary format later if bandwidth matters.                                                               |
| Persistence    | **SQLite** first, **Postgres** if/when we scale out                                                    | Live match state stays in memory; the DB holds accounts, ratings, match results, and replay data (seed + order log).                 |
| Auth           | Guest sessions (signed token) + accounts (email/OAuth, via a library such as Lucia/Auth.js or similar) | Guests can join unranked matches instantly; accounts unlock duels/ranked, stats, history, and replays.                               |
| Hosting        | A single VPS or **Fly.io** container, static client on a CDN (Cloudflare)                              | Cheap, and a single process can handle a lot of players at 0.5 ticks/sec.                                                            |
| Testing        | **Vitest**                                                                                             | Same toolchain as Vite; the shared sim package is pure functions and highly testable.                                                |

### Why not a game framework (Colyseus, Phaser, Unity WebGL, etc.)?

The interesting part of this game is the tick/queue model, which is simple and custom. A framework would give us rooms and state sync that we'd end up bypassing. Starting with raw `ws` keeps everything understandable. Colyseus is the main alternative worth revisiting if matchmaking/rooms get complicated.

### Future platforms

- **Mobile:** wrap the web client with **Capacitor** (reuses the whole client), or go PWA first.
- **Desktop:** **Tauri** (or Electron) wrapping the same client.
- Because the client is thin and the rules live in `shared`, a native rewrite stays possible but shouldn't be needed.

## Proposed repo layout

```
hexxar/
├── apps/
│   ├── client/        # Vite + PixiJS + React UI
│   └── server/        # Node game server: WebSocket, tick loop, persistence
├── packages/
│   └── shared/        # Pure TS: hex math, types, orders, tick resolution, protocol schemas
├── docs/              # Game design notes, protocol docs
├── package.json
├── pnpm-workspace.yaml
└── README.md
```

`packages/shared` must have **no** Node or DOM dependencies, so it runs in the server, browser, and tests.

## Architecture sketch

```
 Browser client                         Game server
 ┌──────────────┐   WS: submit/cancel   ┌─────────────────────────┐
 │ Pixi render  │ ────── orders ──────▶ │ validate + enqueue      │
 │ Queue UI     │                       │ per-player queues       │
 │ local preview│ ◀── tick results ──── │ tick loop (every ~2s):  │
 └──────────────┘   (state / diffs)     │   pop heads → resolve   │
        │                               │   → new state → broadcast│
        └──── shared/ (hex, rules) ─────┴─────────────────────────┘
```

- **Clock:** the server broadcasts the tick number and the next tick's timestamp, so clients can show a countdown and a smooth progress animation.
- **Sync:** send a full snapshot on join, then per-tick diffs (what changed). Diffs are small at this tick rate.
- **Queue ownership:** queues live on the server. The client can only append orders; the server confirms them and the client displays its own queue as it drains. Optimistic UI is fine, but the server's version wins.
- **Match lifecycle:** a lobby/matchmaking layer creates `Match` instances (mode, seed, player slots). Each match owns its state, queues, and tick timer, and is destroyed (after saving results and the replay log) when it ends. A single server process hosts many matches.
- **Identity:** every connection has a guest or account identity. Ranked/duel matchmaking checks for an account; guest-friendly modes don't.
- **Reconnects:** a player's session is tied to their token, so reconnecting just re-sends their (filtered) snapshot. Their queue keeps running while they're away.
- **Scaling:** a match is the unit of isolation. With at most ~100 players per match and a 2s tick, one process can host many matches; scaling out later just means running more processes and routing players to the one hosting their match.

## Milestones

1. **Scaffold:** monorepo, TypeScript config, lint/format, CI, empty client and server that talk over WebSocket.
2. **Shared core:** ✅ hex math, tile types, match config, order validation, `resolveTick`, surrender, a symmetric board generator (3 or 6 players rotational; 2 or 4 mirrored (2 can also be rotational); 5 unsupported), and tests (no networking).
3. **Playable local loop:** ✅ server matches with per-player queues and a tick loop; client renders the map, queued-move arrows and a tick countdown, and queues moves by clicking.
4. **Multiplayer matches:** ✅ rooms, a main menu, quick play and private games by code or link, host-start and auto-start, a countdown, reconnects with auto-surrender after two minutes away, and a results screen (duels only for now; see [`docs/lobby.md`](docs/lobby.md)). Guests can play.
5. **Modes and maps:** symmetrical board generator for 2-6 players, random generator for royale, victory conditions.
6. **Accounts and persistence:** auth, ranked duels, ratings, stats, match history, replay storage and a replay viewer.
7. **Game depth:** combat, terrain, economy, and fog of war (the groundwork is already in place).
8. **Polish and launch:** deploy to hexxar.io, onboarding, mobile-friendly UI.

## Decisions

- **Separate matches, not a persistent world.** Duels/small matches (2-6 players, symmetrical boards) and royale (up to ~100 players, random boards).
- **Scale target:** ~100 players max per match; most matches much smaller.
- **Fog of war:** designed in from the start (per-player state views), implemented later.
- **Queues:** one global queue per player, unlimited length, append-only (no reorder/cancel).
- **Accounts:** guests can join unranked matches immediately; accounts are required for duels/ranked, stats, history, and replays.
- **Win condition:** last player standing; surrender allowed at any time.
- **Tick rate:** 2s default for every mode, adjustable globally and potentially per mode later.
- **Art:** minimalist flat style (simple vector shapes, flat colors), which suits PixiJS and scales cleanly to mobile.

## Open questions

- **Tick resolution details:** a few edge cases (what happens to a surrendered player's troops, draws) are listed at the bottom of [`docs/tick-resolution.md`](docs/tick-resolution.md).
- **Balance:** all tile and generation numbers are placeholders.
- **Ranked rating system:** to be discussed when accounts are implemented.

## Getting started

Requires Node 22+ and [pnpm](https://pnpm.io) 10 (`corepack enable` or `npm i -g pnpm`).

```sh
pnpm install
pnpm dev          # server on ws://localhost:8080, client on http://localhost:5173
```

Other scripts: `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm format`, `pnpm build`.

Open `http://localhost:5173` in two browser tabs (each tab is its own guest) and press **Quick play** in both, or create a private game in one and join it with the code or link from the other. Controls: left-drag from one of your tiles across neighboring hexes to queue a path of moves (a preview is shown while you drag; moves are queued when you release, and Esc cancels). You can also start a drag from the end of your queued path to extend it. Right-drag (or middle-drag) pans the map and the wheel zooms; the left button never pans, so a stray drag can't queue or move anything by accident. Orders are append-only and run one per tick.

The menu's **Preview generated maps** link (temporary) shows generated boards locally. Rules for generation are in [`docs/map-generation.md`](docs/map-generation.md).

Server settings (environment variables): `RADIUS` (default board size, default 7), `TICK_MS` (default 2000), `COUNTDOWN_MS` (default 5000), `AFK_MS` (time a disconnected player has before surrendering, default 120000), `FINISHED_LINGER_MS` (how long a finished game's room stays open, default 600000), `PORT` (default 8080). Set `VITE_SERVER_URL` to point the client at a different server.
