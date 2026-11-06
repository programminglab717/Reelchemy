#!/usr/bin/env bash
# Reelchemy single-host deployment helper (Ubuntu + Docker Engine + Compose v2).
#
#   deploy/reelchemy.sh install --url https://studio.example.com [--smtp-host H --smtp-port 587 --smtp-user U --smtp-from 'Reelchemy <a@b>'] [--port 3001] [--closed-signup]
#   deploy/reelchemy.sh update                 # rebuild from the current checkout, migrate, restart
#   deploy/reelchemy.sh status | logs [service]
#   deploy/reelchemy.sh create-account EMAIL "Name"   # prompts for the password
#   deploy/reelchemy.sh reset-password EMAIL           # prompts for the password
#   deploy/reelchemy.sh backup /absolute/backup/dir    # stops writers, snapshots, restarts
#
# Secrets live only in .deploy/reelchemy.env (mode 600, git-ignored). The SMTP
# password is prompted for and stored there; AI keys are NOT configured here —
# each studio saves its own encrypted key in Account settings.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)
ENV_DIR="$ROOT/.deploy"
ENV_FILE="$ENV_DIR/reelchemy.env"
IMAGE=reelchemy:local
PRIVACY_VOLUME_DEFAULT=reelchemy-privacy
die() { echo "error: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 is required. $2"; }
compose() {
  local profiles=()
  if [ "$(get EMAIL_DELIVERY_ENABLED)" = "true" ]; then profiles=(--profile smtp); fi
  docker compose --env-file "$ENV_FILE" -p reelchemy "${profiles[@]}" -f "$ROOT/compose.yaml" "$@"
}
get() { [ -f "$ENV_FILE" ] && grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- || true; }
set_var() {
  local key=$1 value=$2
  touch "$ENV_FILE"; chmod 600 "$ENV_FILE"
  if grep -qE "^$key=" "$ENV_FILE"; then
    local tmp; tmp=$(mktemp "$ENV_DIR/.env.XXXXXX")
    awk -v k="$key" -v v="$value" 'BEGIN{FS=OFS="="} $1==k{print k"="v; next} {print}' "$ENV_FILE" > "$tmp"
    chmod 600 "$tmp"; mv "$tmp" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}
build() {
  echo "Building the application image (this takes a few minutes the first time)…"
  # REELCHEMY_BUILD_ARGS: optional extra docker build arguments.
  # shellcheck disable=SC2086
  docker build ${REELCHEMY_BUILD_ARGS:-} --target app --tag "$IMAGE" "$ROOT"
}
wait_healthy() {
  local port; port=$(get REELCHEMY_HTTP_PORT)
  echo "Waiting for the studio to become ready on 127.0.0.1:$port…"
  for _ in $(seq 1 90); do
    if curl -fsS "http://127.0.0.1:$port/api/health" >/dev/null 2>&1; then
      echo "Ready."; return 0
    fi
    sleep 2
  done
  compose ps
  die "The studio did not become ready. Check: deploy/reelchemy.sh logs"
}
read_password() {
  local prompt=$1 first second
  read -r -s -p "$prompt: " first; echo >&2
  read -r -s -p "Repeat: " second; echo >&2
  [ "$first" = "$second" ] || die "The entries did not match."
  printf '%s' "$first"
}
start_services() {
  compose run --rm --no-deps migrate
  local services=(web render ingest privacy)
  if [ "$(get EMAIL_DELIVERY_ENABLED)" = "true" ]; then services+=(mail); fi
  compose up -d --no-build --remove-orphans "${services[@]}"
  wait_healthy
}

cmd_install() {
  need docker "Install Docker Engine: https://docs.docker.com/engine/install/ubuntu/"
  docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is required (docker compose)."
  need curl "sudo apt-get install -y curl"
  need openssl "sudo apt-get install -y openssl"
  local url="" port=3001 smtp_host="" smtp_port=587 smtp_user="" smtp_from="" signup=true
  while [ $# -gt 0 ]; do
    case "$1" in
      --url) url=$2; shift 2 ;;
      --port) port=$2; shift 2 ;;
      --smtp-host) smtp_host=$2; shift 2 ;;
      --smtp-port) smtp_port=$2; shift 2 ;;
      --smtp-user) smtp_user=$2; shift 2 ;;
      --smtp-from) smtp_from=$2; shift 2 ;;
      --closed-signup) signup=false; shift ;;
      *) die "Unknown option $1" ;;
    esac
  done
  mkdir -p "$ENV_DIR"; chmod 700 "$ENV_DIR"
  [ -n "$url" ] || url=$(get BETTER_AUTH_URL)
  [[ "$url" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?$ ]] || die "Use --url with your public HTTPS address, e.g. https://studio.example.com"
  [[ "$port" =~ ^[0-9]{2,5}$ ]] || die "Invalid --port"
  set_var BETTER_AUTH_URL "$url"
  set_var REELCHEMY_HTTP_PORT "$port"
  [ -n "$(get BETTER_AUTH_SECRET)" ] || set_var BETTER_AUTH_SECRET "$(openssl rand -base64 48 | tr -d '\n=+/' | cut -c1-64)"
  [ -n "$(get REELCHEMY_PRIVACY_VOLUME)" ] || set_var REELCHEMY_PRIVACY_VOLUME "$PRIVACY_VOLUME_DEFAULT"
  set_var REELCHEMY_CLIENT_IP_HEADER cf-connecting-ip
  set_var REELCHEMY_PUBLIC_SIGNUP "$signup"
  [ -n "$(get REELCHEMY_PLATFORM_AI)" ] || set_var REELCHEMY_PLATFORM_AI off
  [ -n "$(get AI_PROVIDER)" ] || set_var AI_PROVIDER mock
  if [ -n "$smtp_host" ]; then
    [ -n "$smtp_from" ] || die "--smtp-from is required with --smtp-host"
    set_var SMTP_HOST "$smtp_host"; set_var SMTP_PORT "$smtp_port"
    set_var SMTP_USER "$smtp_user"; set_var EMAIL_FROM "$smtp_from"
    if [ -n "$smtp_user" ]; then
      set_var SMTP_PASSWORD "$(read_password "SMTP password for $smtp_user")"
    fi
    set_var EMAIL_DELIVERY_ENABLED true
  elif [ -z "$(get SMTP_HOST)" ]; then
    # Accounts can still be created with create-account; no mail is sent.
    set_var SMTP_HOST smtp.invalid; set_var EMAIL_FROM "Reelchemy <no-reply@invalid>"
    set_var EMAIL_DELIVERY_ENABLED false
  fi
  build
  local volume; volume=$(get REELCHEMY_PRIVACY_VOLUME)
  if [ -z "$(get REELCHEMY_PRIVACY_ID)" ]; then
    if docker volume inspect "$volume" >/dev/null 2>&1; then
      die "Privacy volume $volume exists but its ID is not recorded in $ENV_FILE. Restore the recorded REELCHEMY_PRIVACY_ID and REELCHEMY_PRIVACY_KEY_FINGERPRINT; never re-initialize it."
    fi
    docker volume create --label reelchemy.privacy-authority=true "$volume" >/dev/null
    # Temporary syntactically valid pins only let Compose parse for the init.
    set_var REELCHEMY_PRIVACY_ID 00000000-0000-4000-8000-000000000000
    set_var REELCHEMY_PRIVACY_KEY_FINGERPRINT "$(printf '0%.0s' $(seq 1 64))"
    local result
    result=$(compose run --rm --no-deps migrate node --import tsx scripts/privacy-vault.ts init --directory /app/private-privacy)
    local id fingerprint
    id=$(printf '%s' "$result" | grep -o '"id":"[a-f0-9-]*"' | head -1 | cut -d'"' -f4)
    fingerprint=$(printf '%s' "$result" | grep -o '"keyFingerprint":"[a-f0-9]*"' | head -1 | cut -d'"' -f4)
    [ -n "$id" ] && [ -n "$fingerprint" ] || die "Privacy authority initialization failed."
    set_var REELCHEMY_PRIVACY_ID "$id"
    set_var REELCHEMY_PRIVACY_KEY_FINGERPRINT "$fingerprint"
    echo "Initialized the independent privacy authority ($volume). Back up $ENV_FILE securely."
  fi
  start_services
  cat <<EOF

Reelchemy is running on http://127.0.0.1:$port (web listens on loopback only).
Point your Cloudflare Tunnel public hostname for $url at:  http://localhost:$port
Create your account:  deploy/reelchemy.sh create-account you@example.com "Your name"
Then sign in at $url and add your AI key under Account settings.
EOF
}
cmd_update() {
  [ -f "$ENV_FILE" ] || die "Run install first."
  build
  echo "Stopping writers for the migration…"
  compose stop web render ingest privacy mail 2>/dev/null || true
  start_services
}
cmd_account() {
  local action=$1 email=$2 name=${3:-}
  [ -f "$ENV_FILE" ] || die "Run install first."
  local password; password=$(read_password "Password (12+ characters)")
  if [ "$action" = create ]; then
    printf '%s' "$password" | compose exec -T web npm run --silent account:create -- --email "$email" --name "$name" --password-stdin
  else
    printf '%s' "$password" | compose exec -T web npm run --silent account:password -- --email "$email" --password-stdin
  fi
}
cmd_backup() {
  local target=${1:-}
  [[ "$target" = /* ]] || die "Use an absolute backup directory."
  mkdir -p "$target"; chown 1000:1000 "$target" 2>/dev/null || true
  local name; name="reelchemy-$(date -u +%Y%m%dT%H%M%SZ)"
  echo "Stopping writers for a coordinated snapshot…"
  compose stop web render ingest privacy mail 2>/dev/null || true
  local status=0
  compose run --rm --no-deps -v "$target:/backups" migrate npm run --silent backup -- create "/backups/$name" || status=$?
  start_services
  [ "$status" -eq 0 ] || die "Backup failed; services were restarted."
  echo "Backup written to $target/$name. Copy it off this machine; it contains private data."
}
case "${1:-}" in
  install) shift; cmd_install "$@" ;;
  update) cmd_update ;;
  status) compose ps; curl -fsS "http://127.0.0.1:$(get REELCHEMY_HTTP_PORT)/api/health"; echo ;;
  logs) shift; compose logs --tail 200 -f "$@" ;;
  create-account) [ $# -eq 3 ] || die "Usage: create-account EMAIL \"Name\""; cmd_account create "$2" "$3" ;;
  reset-password) [ $# -eq 2 ] || die "Usage: reset-password EMAIL"; cmd_account password "$2" ;;
  backup) shift; cmd_backup "${1:-}" ;;
  *) sed -n '2,13p' "$0"; exit 64 ;;
esac
