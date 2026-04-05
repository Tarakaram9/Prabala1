#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# setup-github-secrets.sh
# Sets all required GitHub Actions secrets for the Prabala Studio deployment.
#
# Prerequisites:
#   - Azure CLI (az) — already installed & logged in
#   - GitHub CLI (gh) — installed by this script if missing
#
# Usage:
#   chmod +x setup-github-secrets.sh
#   ./setup-github-secrets.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO="Tarakaram9/Prabala1"

# ── Install gh CLI if missing ──────────────────────────────────────────────────
if ! command -v gh &>/dev/null; then
  echo "Installing GitHub CLI..."
  brew install gh
fi

# ── Ensure gh is authenticated ─────────────────────────────────────────────────
if ! gh auth status &>/dev/null; then
  echo "Please log in to GitHub CLI:"
  gh auth login
fi

# ── Gather Azure values ────────────────────────────────────────────────────────
echo "Gathering Azure credentials..."

AZURE_CREDENTIALS=$(az ad sp create-for-rbac \
  --name "prabala-studio-deploy" \
  --sdk-auth \
  --role contributor \
  --scopes /subscriptions/e279a7f2-f39a-4997-91af-3abc6ab2726e/resourceGroups/rg-iot-ot-portal-dev \
  2>/dev/null)

REGISTRY_PASSWORD=$(az acr credential show \
  --name acriototportaldev \
  --query "passwords[0].value" -o tsv 2>/dev/null)

# ── Set secrets ────────────────────────────────────────────────────────────────
echo ""
echo "Setting GitHub Actions secrets for ${REPO}..."

set_secret() {
  printf '%s' "$2" | gh secret set "$1" --repo "$REPO" && \
    echo "  ✅  $1" || echo "  ❌  $1"
}

set_secret "AZURE_CREDENTIALS"        "$AZURE_CREDENTIALS"
set_secret "REGISTRY_LOGIN_SERVER"    "acriototportaldev.azurecr.io"
set_secret "REGISTRY_USERNAME"        "acriototportaldev"
set_secret "REGISTRY_PASSWORD"        "$REGISTRY_PASSWORD"
set_secret "AZURE_RESOURCE_GROUP"     "rg-iot-ot-portal-dev"
set_secret "AZURE_CONTAINER_APP_NAME" "prabala-studio"
set_secret "AZURE_CONTAINER_APP_ENV"  "cae-iot-ot-portal-dev"

echo ""
echo "All secrets set! Trigger deployment at:"
echo "  https://github.com/${REPO}/actions"
