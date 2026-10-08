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
- Games live in the server's memory. **A deploy ends every running match** (players land
  back in the menu), so prefer deploying when nobody is playing.

Files in `deploy/server/` mirror what lives on the server and are copied there by hand;
CI does not touch them.

## Beta access code

Visitors have to enter a code before they can play. It is `BETA_CODE` in
`/srv/hexxar/.env` (see `deploy/server/hexxar/.env.example`). To change it:

```bash
ssh deploy@<ip>
nano /srv/hexxar/.env
cd /srv/hexxar && IMAGE=$(cat current-image) docker compose up -d --force-recreate
```

Everyone who is connected keeps playing until their next reconnect; then the new code is
needed. Leave `BETA_CODE` empty to open the game to everybody.

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
