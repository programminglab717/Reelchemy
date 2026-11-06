# Deploying Reelchemy on your own Ubuntu server (Cloudflare Tunnel)

This guide sets up a private test installation on a single Ubuntu server reached through a Cloudflare Tunnel. Everything runs in Docker; the web service listens only on `127.0.0.1`, so the tunnel is the only way in.

## What you need

- Ubuntu Server 22.04/24.04 with at least **4 CPU cores, 8 GB RAM and 60 GB free disk** (one five-minute HD export uses about 2 cores and 1.3–1.7 GB of memory for 11–13 minutes).
- Docker Engine with the Compose plugin: <https://docs.docker.com/engine/install/ubuntu/> (then `sudo usermod -aG docker $USER` and log in again).
- `git`, `curl` and `openssl` (`sudo apt-get install -y git curl openssl`).
- A Cloudflare Tunnel (`cloudflared`) on the server and a public hostname such as `studio.example.com`.
- Optional: SMTP details for verification/reset emails. Without SMTP you can still create accounts with the command below.

## 1. Get the code

```bash
git clone https://github.com/programminglab717/Reelchemy.git
cd Reelchemy
git checkout work
```

## 2. Install and start

With SMTP (recommended once you have the details; you will be prompted for the SMTP password):

```bash
deploy/reelchemy.sh install --url https://studio.example.com --smtp-host smtp.example.com --smtp-port 587 --smtp-user accounts@example.com --smtp-from "Reelchemy <accounts@example.com>"
```

Without SMTP for now:

```bash
deploy/reelchemy.sh install --url https://studio.example.com
```

Add `--closed-signup` to stop strangers from creating accounts on your public URL (recommended while testing with your own AI key; you create accounts yourself).

The script:

1. writes generated secrets to `.deploy/reelchemy.env` (private, never committed);
2. builds the application image;
3. creates and initializes the independent privacy authority volume `reelchemy-privacy` (once);
4. runs the database migration and starts `web`, `render`, `ingest`, `privacy` (and `mail` when SMTP is configured);
5. waits until `http://127.0.0.1:3001/api/health` is ready.

**Back up `.deploy/reelchemy.env`** somewhere safe. It holds the sign-in signing secret (which also protects saved AI keys) and the privacy authority pins. Losing it means saved AI keys must be re-entered and the privacy authority cannot be matched.

## 3. Connect the Cloudflare Tunnel

In the Cloudflare Zero Trust dashboard (Networks → Tunnels → your tunnel → Public hostnames), add:

- **Hostname:** `studio.example.com` (the same address you passed to `--url`)
- **Service:** `http://localhost:3001`

Or in `cloudflared`'s `config.yml`:

```yaml
ingress:
  - hostname: studio.example.com
    service: http://localhost:3001
  - service: http_status:404
```

The installation trusts Cloudflare's `CF-Connecting-IP` header for sign-in rate limits. Keep port 3001 closed to the network; the script already binds it to loopback only.

**Upload sizes through the tunnel.** Cloudflare refuses any single request body over 100 MB on Free and Pro plans, tunnels included. Reelchemy therefore sends files over 32 MB in resumable 32 MB pieces, so creators can upload videos up to 2 GB (audio 256 MB, project archives 256 MB). An interrupted upload continues where it stopped when the same file is chosen again. Downloads are not limited.

**Disk.** A new install allows each studio 10 GB of stored media (20 GB across all studios), set as `REELCHEMY_MEDIA_STORAGE_BYTES` and `REELCHEMY_MEDIA_SHARED_STORAGE_BYTES` in `.deploy/reelchemy.env`. Uploads in progress and waiting for processing can use up to twice `REELCHEMY_MEDIA_RAW_BYTES` (default 4 GB) of additional temporary space. Change a value, then run `deploy/reelchemy.sh update`.

## 4. Create your account and add your AI key

```bash
deploy/reelchemy.sh create-account you@example.com "Your name"
```

Open `https://studio.example.com`, sign in, go to **Account settings → AI director → Add my AI provider key**, choose Anthropic, OpenAI, Google Gemini or another OpenAI-compatible provider, and enter:

- the model ID from your provider;
- the API key (encrypted on the server, never shown again in full, deletable at any time);
- the model's input/output price per million tokens (from the provider's pricing page) and a daily spending limit.

Without a key, the studio uses the built-in demo director.

## Everyday operations

| Task                      | Command                                                           |
| ------------------------- | ----------------------------------------------------------------- |
| Status and health         | `deploy/reelchemy.sh status`                                      |
| Logs (all or one service) | `deploy/reelchemy.sh logs` / `deploy/reelchemy.sh logs render`    |
| Update after `git pull`   | `deploy/reelchemy.sh update`                                      |
| Reset a password          | `deploy/reelchemy.sh reset-password you@example.com`              |
| Coordinated backup        | `sudo deploy/reelchemy.sh backup /srv/reelchemy-backups`          |
| Stop / start everything   | `docker compose -p reelchemy stop` / `deploy/reelchemy.sh update` |

`update` rebuilds from the current checkout, stops writers, runs the additive migration and restarts. Upgrades and rollbacks between versions are exercised by `node scripts/check-runtime.ts --image <new> --upgrade-from <old>`; take a backup before updating real data.

Backups stop the services briefly, write a verified snapshot (databases, referenced media and finished exports) and restart. Copy snapshots off the server; for encrypted off-site copies see `OPERATIONS.md` (`backup:encrypted`).

## Later: platform AI for paying users

The operator ("platform") AI is configured in `.deploy/reelchemy.env` with `AI_PROVIDER`, `AI_BASE_URL`, `AI_MODEL`, `AI_API_KEY` and the `REELCHEMY_AI_*` prices and allowances (see `.env.example`). `REELCHEMY_PLATFORM_AI` controls who may use it: `off` (default for this guide), `all`, or `granted` (only studios granted with `npm run ai:entitlement -- grant --workspace ID --daily-usd 10`). A studio's own saved key always takes priority. Usage per source is reported by `npm run ai:usage`.
