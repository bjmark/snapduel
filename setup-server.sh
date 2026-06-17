#!/usr/bin/env bash
# First-time server setup for Snap Duel.
# Run this once from your local machine after pushing to GitHub.
set -euo pipefail

SERVER_HOST="${SERVER_HOST:-yijv-server}"
REMOTE_SITE_DIR="${REMOTE_SITE_DIR:-/var/www/snapduel}"
REPO_URL="${REPO_URL:-git@github.com:bjmark/snapduel.git}"
DOMAIN="snapduel.wenqing.online"

echo "==> Setting up ${DOMAIN} on ${SERVER_HOST}..."

ssh "${SERVER_HOST}" \
  "REMOTE_SITE_DIR='${REMOTE_SITE_DIR}' REPO_URL='${REPO_URL}' DOMAIN='${DOMAIN}' bash -s" <<'ENDSSH'
set -euo pipefail

# ── Node.js (via nvm if not already installed) ──────────────
if ! command -v node &>/dev/null; then
  echo "Installing Node.js via nvm..."
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
  export NVM_DIR="$HOME/.nvm"
  # shellcheck disable=SC1091
  source "$NVM_DIR/nvm.sh"
  nvm install --lts
  nvm use --lts
fi

NODE_VERSION=$(node --version)
echo "Node: ${NODE_VERSION}"

# ── PM2 ─────────────────────────────────────────────────────
if ! command -v pm2 &>/dev/null; then
  echo "Installing PM2..."
  npm install -g pm2
fi

# ── Clone repo ───────────────────────────────────────────────
if [[ -d "${REMOTE_SITE_DIR}/.git" ]]; then
  echo "Repo already exists at ${REMOTE_SITE_DIR}, pulling latest..."
  git -C "${REMOTE_SITE_DIR}" pull --ff-only origin main
else
  echo "Cloning repo..."
  git clone "${REPO_URL}" "${REMOTE_SITE_DIR}"
fi

cd "${REMOTE_SITE_DIR}"
npm ci --omit=dev

# ── Start with PM2 ───────────────────────────────────────────
if pm2 describe snapduel &>/dev/null; then
  pm2 restart snapduel
else
  PORT=3000 pm2 start server.js --name snapduel
fi
pm2 save

# Enable PM2 on boot (prints a command you may need to run as root)
pm2 startup | tail -1

# ── nginx config ─────────────────────────────────────────────
NGINX_CONF="/etc/nginx/sites-available/snapduel"
if [[ ! -f "${NGINX_CONF}" ]]; then
  echo "Copying nginx config..."
  sudo cp "${REMOTE_SITE_DIR}/nginx.conf" "${NGINX_CONF}"
  sudo ln -sf "${NGINX_CONF}" /etc/nginx/sites-enabled/snapduel
  sudo nginx -t
  sudo systemctl reload nginx
  echo "nginx reloaded"
else
  echo "nginx config already exists at ${NGINX_CONF}, skipping"
fi

echo ""
echo "==> Setup done. Next step — get HTTPS cert:"
echo "    sudo certbot --nginx -d ${DOMAIN}"
ENDSSH

echo ""
echo "Server setup complete."
echo "If PM2 startup printed a 'sudo env ...' command, SSH in and run it to enable autostart."
echo "Then run: ssh ${SERVER_HOST} 'sudo certbot --nginx -d ${DOMAIN}'"
