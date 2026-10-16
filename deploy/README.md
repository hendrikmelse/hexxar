# Deployment runbook

Runs the game at **https://hexxar.io** (and redirects `www`) on the same VPS as the
other apps. It reuses that server's setup: Docker Compose, with a shared Caddy in front
for HTTPS. The server, its users, firewall, Docker and Caddy are set up as described in
the flashcards runbook
(<https://github.com/hendrikmelse/flashcards/blob/main/deploy/README.md>); this file covers
only what is specific to Hexxar. Keep it up to date with anything that changes.

## How it fits together

```
internet ─▶ Caddy (80/443, automatic HTTPS) ─▶ hexxar (Node, port 8080)
                                                  ├─ GET /        the built client
                                                  ├─ GET /healthz health check
                                                  └─ WS  /ws      the game
```

- **One image** holds the game server, which also serves the built client, so the page
  and the WebSocket share one origin. CI builds it and pushes it to GitHub Container
  Registry as `ghcr.io/hendrikmelse/hexxar:<commit-sha>`.
- **One compose project** on the server, independent of the others:

  | Path on server | Purpose                                                           |
  | -------------- | ----------------------------------------------------------------- |
  | `/srv/hexxar`  | The game. `deploy.sh` does pull, restart, health check, rollback. |

- The container joins the shared `web` Docker network so Caddy can reach it by name.
  Its port is never published.
- Games live in the server's memory, but a deploy does not end them. On SIGTERM the server
  writes every running match to `/data/state.json` (the `state` volume), and the next one
  reads it back and resumes: players see a few seconds of reconnecting and carry on, with
  the game clock paused for the time between. Only running matches are kept (lobbies and
  results are not, so those players land in the menu), a file older than 60 seconds is
  ignored, and it is used once. A crash saves nothing. The new code runs the old match, so a
  rule change applies from the next tick; only if the saved data could no longer be read at
  all is `SNAPSHOT_VERSION` (`apps/server/src/snapshot.ts`) bumped, which drops the games.
  What players see: as the old server stops it sends every client a `restarting` message, and
  the page shows "The server is restarting to apply an update" and how long that usually takes,
  as "less than N seconds", rounded up to 5. That is the median of the last 9 restarts, timed from SIGTERM to
  the new server listening and kept in `/data/restarts.json`; 10s is assumed until there are some. The new server then holds
  each resumed match for `RESUME_MS` (5s, or the time left of its old wait if longer) with the
  "Resumes in" countdown on the timer, and only then ticks.
  **The first deploy with this feature must be preceded by copying the new `compose.yaml`
  to the server** (it adds the volume), and the deploy before it still ends its games.

- Feedback and analytics events are kept in the shared Postgres (database `hexxar`, reached
  over the internal `db` network), so they survive deploys, and `/srv/postgres/backup.sh`
  backs them up with everything else. The container itself writes nothing to disk but that state file.

Files in `deploy/server/` mirror what lives on the server and are copied there by hand;
CI does not touch them.

## Admin panel and the daily feedback email

`/?admin` on the site opens the admin panel once `ADMIN_PASSWORD` (in `/srv/hexxar/.env`) is
entered. Its Analytics tab reads the `events` table (see "Analytics" in the main README). The same `.env` holds `RESEND_API_KEY` and `FEEDBACK_TO` for the 7am email (Los Angeles
time unless `DIGEST_TIMEZONE` says otherwise), which only goes out when something is unresolved.
Put a long password in: it is the only thing protecting the panel.

## One-time setup (already done, for reference)

1. **DNS** at the registrar for `hexxar.io`: an `A` record for `@` pointing at the server's
   IPv4, and a `CNAME` for `www` pointing at `hexxar.io.`. Caddy can only get a certificate
   once these resolve to the server.
2. **App directory**, as the deploy user:

   ```bash
   mkdir -p /srv/hexxar
   scp deploy/server/hexxar/{compose.yaml,deploy.sh,ci-entrypoint.sh} deploy@<ip>:/srv/hexxar/
   ssh deploy@<ip> 'chmod +x /srv/hexxar/*.sh'
   # then create /srv/hexxar/.env from deploy/server/hexxar/.env.example (chmod 600)
   ```

3. **Caddy**: add the blocks from `deploy/server/caddy/Caddyfile.snippet` to
   `/srv/caddy/Caddyfile`, then `docker exec caddy caddy reload --config /etc/caddy/Caddyfile`.
4. **CI deploy key**: `ssh-keygen -t ed25519 -f hexxar-deploy -C github-actions-hexxar`; the
   public key goes in the deploy user's `~/.ssh/authorized_keys` as a forced command, so it
   can run nothing else:

   ```
   restrict,command="/srv/hexxar/ci-entrypoint.sh" ssh-ed25519 AAAA... github-actions-hexxar
   ```

5. **GitHub**: an environment named `production` with the secrets `DEPLOY_HOST`,
   `DEPLOY_USER`, `DEPLOY_SSH_KEY` (the private key) and `DEPLOY_KNOWN_HOSTS` (output of
   `ssh-keyscan -t ed25519 <host>`), and the repository variable `DEPLOY_ENABLED=true`.

6. **Database**: the game keeps analytics events (and, once moved, feedback) in the shared
   Postgres (`/srv/postgres`), in its own database and login role like every other app. As
   the deploy user, with the password generated on the server so it is never typed or shown:

   ```bash
   cd /srv/hexxar
   PW=$(openssl rand -hex 24)
   docker exec postgres psql -U postgres -v ON_ERROR_STOP=1 \
     -c "CREATE ROLE hexxar LOGIN PASSWORD '$PW'" \
     -c "CREATE DATABASE hexxar OWNER hexxar" \
     -c "REVOKE CONNECT ON DATABASE hexxar FROM PUBLIC"
   echo "DATABASE_URL=postgres://hexxar:$PW@postgres:5432/hexxar" >> .env
   chmod 600 .env
   ```

   The container must also join the `db` network (see `deploy/server/hexxar/compose.yaml`).
   `/srv/postgres/backup.sh` dumps every database, so `hexxar` is backed up and copied
   offsite with the others, with no extra work. The tables are created by the server itself on
   start-up (migrations), so there is nothing else to run.

Pushes to `main` then test, build, push the image and deploy it. Pull requests only run
the checks and build the image.

## Deploying by hand, and rolling back

```bash
/srv/hexxar/deploy.sh ghcr.io/hendrikmelse/hexxar:<40-char-commit-sha>
```

`/srv/hexxar/current-image` holds the image that is running. Rolling back is the same
command with the previous tag; `deploy.sh` also rolls back by itself if the new version
never becomes healthy. The first time, the server may need `docker login ghcr.io` with a
token that can read packages.

## Logs

Container logs go to the host journal and survive deploys:

```bash
sudo journalctl -t hexxar
```
