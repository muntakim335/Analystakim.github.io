#!/usr/bin/env bash
# NimbusCRM one-shot installer for Linux / macOS with Docker installed.
#   curl -fsSL https://raw.githubusercontent.com/muntakim335/Analystakim.github.io/claude/crm-platform-build-ym8vua/crm-platform/deploy/setup.sh | bash
# Everything lands in ~/NimbusCRM. Safe to re-run (keeps your data and secrets).
set -euo pipefail

BRANCH='claude/crm-platform-build-ym8vua'
REPO='muntakim335/Analystakim.github.io'
DEST="$HOME/NimbusCRM"

echo '=== NimbusCRM setup ==='

# 1. Docker must be up
if ! docker info >/dev/null 2>&1; then
  echo 'Docker is not running (or not installed). Start Docker, then re-run.' >&2
  exit 1
fi
echo '[1/5] Docker is running'

# 2. Fetch the code (works with or without git)
mkdir -p "$DEST"
echo '[2/5] Downloading NimbusCRM…'
TMP=$(mktemp -d)
curl -fsSL "https://github.com/$REPO/archive/refs/heads/$BRANCH.tar.gz" | tar xz -C "$TMP"
cp -R "$TMP"/*/crm-platform/. "$DEST"/
rm -rf "$TMP"
echo "      Code is in $DEST"

# 3. Secrets — created once, then left alone
ENVF="$DEST/deploy/.env"
if [ ! -f "$ENVF" ]; then
  echo '[3/5] Generating secrets'
  {
    echo "POSTGRES_PASSWORD=$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
    echo "JWT_SECRET=$(head -c 48 /dev/urandom | od -An -tx1 | tr -d ' \n')"
    echo 'PUBLIC_ORIGIN=*'
    echo 'WEB_PORT=8080'
    echo 'SMTP_FROM="NimbusCRM <no-reply@example.com>"'
    echo 'MAX_UPLOAD_MB=10'
  } > "$ENVF"
else
  echo '[3/5] Keeping existing secrets (.env already present)'
fi

# 4. Build & start
echo '[4/5] Building and starting containers (first run takes a few minutes)…'
cd "$DEST/deploy"
docker compose up -d --build

# 5. Wait until healthy
echo '[5/5] Waiting for the app to come up…'
for _ in $(seq 1 60); do
  sleep 3
  if curl -fsS http://localhost:8080/readyz >/dev/null 2>&1; then
    IP=$(hostname -I 2>/dev/null | awk '{print $1}' || ipconfig getifaddr en0 2>/dev/null || true)
    echo
    echo '=== NimbusCRM is running ==='
    echo '  On this machine:      http://localhost:8080'
    [ -n "${IP:-}" ] && echo "  From other devices:   http://$IP:8080  (same network)"
    echo "  First step:           open it and click 'Create your organization'"
    echo "  Stop:                 cd $DEST/deploy && docker compose down"
    echo '  Update:               re-run this script'
    echo "  Backup:               cd $DEST/deploy && docker compose exec -T postgres pg_dump -U crm -d crm -Fc > crm-backup.dump"
    exit 0
  fi
done

echo 'Something did not come up. Diagnose with:' >&2
echo "  cd $DEST/deploy && docker compose ps && docker compose logs api" >&2
exit 1
