# Working in this repo

Hexxar, a multiplayer hex strategy game at https://hexxar.io (pnpm monorepo: `apps/client`, `apps/server`, `packages/`). The README describes the game and layout, `docs/` explains the game systems and `deploy/README.md` is the production runbook. This file holds what a new Claude session needs on top of that: how the owner likes to work and decisions that are not obvious from the code.

The owner is Hendrik (GitHub `hendrikmelse`). The repo is public, so never commit the production server's IP address, credentials, or anything from `.env`.

## How to work with the owner

- **"UI tweaking mode"** (when the owner says so): only edit files. Do not run tests, typecheck or builds, and do not commit, so Vite hot-reloads fast. Outside that mode, tests, commits and pushes are fine. Check which mode you are in before running checks or committing.
- **Queued batches:** when the owner queues up a batch of work and leaves, ask all questions up front, then work on your own, make the calls yourself and report the decisions afterwards.
- **Pushing to `main` deploys to production.** Ask before pushing to `main`.
- `git fetch` before pushing: the owner also merges PRs on GitHub, so a push can be rejected and need a rebase.
- Verify your own UI work with screenshots: `puppeteer-core` with the system Chrome (`C:/Program Files/Google/Chrome/Application`). Freeze CSS animations for pixel diffs.
- Commit messages end with the `Co-Authored-By` line and PR bodies with the "Generated with Claude Code" line that the session's system reminder gives.

## Checks

- Run plain `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm format:check`, and read the output. **Do not use `pnpm -s`**: it once swallowed a real tsc error.

## Shell quirks (Windows)

- Bash heredocs break on non-ASCII characters (arrows, ellipses) and on bodies with many apostrophes or quotes ("unexpected EOF while looking for matching `'`"). Write such scripts and files with the Write tool, then run them.

## Map generation docs

Keep `docs/map-generation.md` detailed and in sync with the code on every map generation change (royale, duel, trio, quad, sextet, terrain, the previewer's fog). Describe exactly how everything works, with the real numbers. Update the doc in the same commit as the change, and re-read the code rather than editing from memory. The owner once found it badly out of date after many tweaks.

## License

**All rights reserved** (decided 2026-10-16): the `LICENSE` file, `"license": "UNLICENSED"` in every `package.json`, and a README section. The repo is public as a portfolio piece but is explicitly not open source: the owner does not want a clone of hexxar.io. Do not add or suggest open-source license headers, and keep new files unlicensed. If third-party assets (sounds, fonts) are added, check their terms.

## Deployment

Every push to `main` deploys (GitHub Actions: check, build image, push to ghcr.io, SSH forced-command deploy). The server is the same VPS as the owner's other apps (personal-website, flashcards, scoreplot), reached as `ssh deploy@hexxar.io` with the owner's SSH key.

- On the server: `/srv/hexxar` (`compose.yaml`, `deploy.sh`, `ci-entrypoint.sh`, `.env`). The shared Caddy config in `/srv/caddy/Caddyfile` has the `hexxar.io` block. The container is named `hexxar`; one port (8080) serves the client, `/healthz` and the WebSocket at `/ws`.
- The files in `deploy/server/` mirror the server and are copied over by hand (scp); CI does not touch them.
- To ship: commit and push to `main` (after asking), then check `gh run list`.
- Running matches survive a deploy (see `deploy/README.md`). Restart timings are recorded in `/data/restarts.json`.

## Analytics

Events, feedback and internal visitors are stored in the shared server Postgres (database and role `hexxar`; `DATABASE_URL` is in `/srv/hexxar/.env`). The admin panel has an Analytics tab. The client keeps a visitor id in localStorage. Dev database: `docker compose up -d db` (port 5433).

Decisions: no IP addresses are stored; Do Not Track means nothing is recorded; admins are excluded via the `internal_visitors` table (auto-marked on first admin login per browser, plus a checkbox in the Analytics tab).

## Things still open (as of 2026-10-16; verify before relying on them)

- The privacy page (`apps/client/src/ui/Privacy.tsx`) does not yet describe the analytics. It is to be updated last, once analytics is settled.
- The old `hexxar_data` Docker volume was to be removed once the server's `compose.yaml` joined the `db` network (`docker volume rm hexxar_data`).
