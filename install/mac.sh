#!/bin/bash
#
# YouCloned one-click install for macOS - full stack.
# Installs (or skips if already present):
#   - Homebrew
#   - Node.js
#   - Python 3 (required for NotebookLM integration and several skills)
#   - Git
#   - Obsidian
#   - Cursor
#   - Claude Code CLI
#   - YouCloned starter skills
# Creates a default Obsidian vault folder if you accept the default.
# Drops the starter CLAUDE.md into that vault if not already there.
#
# Usage (run line 1, wait, run line 2):
#   curl -fsSL https://youcloned.bnsn.ai/install/mac.sh -o /tmp/yc-install.sh
#   bash /tmp/yc-install.sh
#
# Idempotent. Safe to re-run. Will not overwrite an existing CLAUDE.md.
#

set -e

ORANGE='\033[0;33m'
GREEN='\033[0;32m'
RED='\033[0;31m'
BOLD='\033[1m'
RESET='\033[0m'

say()  { echo -e "${ORANGE}${BOLD}YouCloned:${RESET} $1"; }
ok()   { echo -e "${GREEN}OK${RESET}   $1"; }
warn() { echo -e "${RED}WARN${RESET} $1"; }

say "Starting full-stack install for macOS"
say ""

# ----- Intel Macs: steps 1 to 6 without Homebrew -----
# Since September 2026 Homebrew's install script stops on every Intel Mac with
# "Homebrew on macOS is only supported on Apple Silicon processors!" (#296).
# So on an Intel Mac each tool comes from its maker's own download instead.
# Apple Silicon Macs skip this block and run steps 1 to 6 below as before.
if [ "$(/usr/bin/uname -m)" = "x86_64" ]; then
    YC_TMP=$(mktemp -d /tmp/yc-intel.XXXXXX)
    yc_dmg_app() {  # $1 = downloaded .dmg, $2 = the .app inside it
        local mnt; mnt=$(mktemp -d /tmp/yc-mnt.XXXXXX)
        hdiutil attach -nobrowse -quiet -mountpoint "$mnt" "$1"
        ditto "$mnt/$2" "/Applications/$2" 2>/dev/null || sudo ditto "$mnt/$2" "/Applications/$2"
        hdiutil detach -quiet "$mnt" || true
    }
    say "Intel Mac found. Homebrew no longer installs on Intel Macs, so each tool comes from its maker's own download."
    say "(You may be prompted for your Mac password.)"

    # Git comes with Apple's Command Line Tools (Homebrew used to install these for you).
    if xcode-select -p >/dev/null 2>&1; then
        ok "Git already installed ($(git --version | head -1)). Skipping."
    else
        say "Installing Apple's Command Line Tools (this gives you Git). This can take a few minutes..."
        sudo /usr/bin/touch /tmp/.com.apple.dt.CommandLineTools.installondemand.in-progress
        CLT=$(/usr/sbin/softwareupdate -l 2>/dev/null | grep -B 1 -E 'Command Line Tools' | awk -F'*' '/^ *\*/ {print $2}' | sed -e 's/^ *Label: //' -e 's/^ *//' | sort -V | tail -n1)
        if [ -n "$CLT" ] && sudo /usr/sbin/softwareupdate -i "$CLT"; then
            sudo /usr/bin/xcode-select --switch /Library/Developer/CommandLineTools
            ok "Git installed: $(git --version | head -1)"
        else
            warn "Could not install the Command Line Tools here. Opening Apple's installer: click Install, then re-run this script."
            xcode-select --install || true
        fi
        sudo /bin/rm -f /tmp/.com.apple.dt.CommandLineTools.installondemand.in-progress
    fi

    if command -v node >/dev/null 2>&1; then
        ok "Node.js already installed ($(node --version)). Skipping."
    else
        say "Installing Node.js (from nodejs.org)..."
        NODE_PKG=$(curl -fsSL https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt | awk '/\.pkg$/ {print $2}')
        curl -fsSL "https://nodejs.org/dist/latest-v22.x/$NODE_PKG" -o "$YC_TMP/node.pkg"
        sudo /usr/sbin/installer -pkg "$YC_TMP/node.pkg" -target /
        export PATH="/usr/local/bin:$PATH"
        ok "Node.js installed: $(node --version)"
    fi

    if [ -x /usr/local/bin/python3 ]; then
        ok "Python 3 already installed ($(/usr/local/bin/python3 --version)). Skipping."
    else
        say "Installing Python 3 (from python.org, required for NotebookLM and several YouCloned skills)..."
        curl -fsSL https://www.python.org/ftp/python/3.13.16/python-3.13.16-macos11.pkg -o "$YC_TMP/python.pkg"
        sudo /usr/sbin/installer -pkg "$YC_TMP/python.pkg" -target /
        "/Applications/Python 3.13/Install Certificates.command" >/dev/null 2>&1 || warn "Python certificates step skipped."
        ok "Python 3 installed: $(/usr/local/bin/python3 --version)"
    fi

    if [ -d "/Applications/Obsidian.app" ]; then
        ok "Obsidian already installed at /Applications/Obsidian.app. Skipping."
    else
        say "Installing Obsidian (from obsidian.md's GitHub releases)..."
        OBS_V=$(curl -fsSIL -o /dev/null -w '%{url_effective}' https://github.com/obsidianmd/obsidian-releases/releases/latest)
        OBS_V=${OBS_V##*/v}
        curl -fsSL "https://github.com/obsidianmd/obsidian-releases/releases/download/v$OBS_V/Obsidian-$OBS_V.dmg" -o "$YC_TMP/obsidian.dmg"
        yc_dmg_app "$YC_TMP/obsidian.dmg" Obsidian.app
        ok "Obsidian installed."
    fi

    if [ -d "/Applications/Cursor.app" ]; then
        ok "Cursor already installed at /Applications/Cursor.app. Skipping."
    else
        say "Installing Cursor (from cursor.com)..."
        curl -fsSL https://api2.cursor.sh/updates/download/golden/darwin-x64/cursor/latest -o "$YC_TMP/cursor.dmg"
        yc_dmg_app "$YC_TMP/cursor.dmg" Cursor.app
        ok "Cursor installed."
    fi
    rm -rf "$YC_TMP"
else

# ----- Step 1: Homebrew -----
if command -v brew >/dev/null 2>&1; then
    ok "Homebrew already installed."
else
    say "Homebrew not found. Installing (you will be prompted for your Mac password)..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    if [ -d /opt/homebrew/bin ]; then
        eval "$(/opt/homebrew/bin/brew shellenv)"
    elif [ -d /usr/local/bin ]; then
        eval "$(/usr/local/bin/brew shellenv)"
    fi
    ok "Homebrew installed."
fi

# ----- Step 2: Node.js -----
if command -v node >/dev/null 2>&1; then
    ok "Node.js already installed ($(node --version)). Skipping."
else
    say "Installing Node.js..."
    brew install node
    ok "Node.js installed: $(node --version)"
fi

# ----- Step 3: Python 3 (Homebrew) -----
# macOS ships with /usr/bin/python3 but it has TCC restrictions and version
# pinning issues. Install a clean Homebrew Python so NotebookLM and other
# Python-based skills can run cleanly.
if brew list python@3.12 >/dev/null 2>&1 || brew list python@3.13 >/dev/null 2>&1 || brew list python >/dev/null 2>&1; then
    ok "Python 3 already installed via Homebrew ($(python3 --version 2>/dev/null || echo unknown)). Skipping."
else
    say "Installing Python 3 (required for NotebookLM and several YouCloned skills)..."
    brew install python
    ok "Python 3 installed: $(python3 --version)"
fi

# ----- Step 4: Git -----
if command -v git >/dev/null 2>&1; then
    ok "Git already installed ($(git --version | head -1)). Skipping."
else
    say "Installing Git..."
    brew install git
    ok "Git installed: $(git --version | head -1)"
fi

# ----- Step 5: Obsidian -----
if [ -d "/Applications/Obsidian.app" ]; then
    ok "Obsidian already installed at /Applications/Obsidian.app. Skipping."
else
    say "Installing Obsidian..."
    brew install --cask obsidian
    ok "Obsidian installed."
fi

# ----- Step 6: Cursor -----
if [ -d "/Applications/Cursor.app" ]; then
    ok "Cursor already installed at /Applications/Cursor.app. Skipping."
else
    say "Installing Cursor..."
    brew install --cask cursor
    ok "Cursor installed."
fi
fi  # end of the Apple Silicon steps 1 to 6

# ----- Step 7: Claude Code CLI -----
# If Node was installed via the nodejs.org pkg installer (not Homebrew), the
# global npm dir at /usr/local/lib/node_modules is owned by root and a normal
# `npm install -g` will fail with EACCES. We detect that, switch to a
# user-owned npm prefix (~/.npm-global), add it to PATH for the current
# session AND the user's shell rc files (idempotent), then retry. No sudo.
if command -v claude >/dev/null 2>&1; then
    ok "Claude Code already installed at $(command -v claude). Skipping."
else
    say "Installing Claude Code CLI..."
    NPM_ERR_LOG="/tmp/yc-npm-err.log"
    if npm install -g @anthropic-ai/claude-code 2>"$NPM_ERR_LOG"; then
        cat "$NPM_ERR_LOG" >&2 2>/dev/null || true
        ok "Claude Code installed."
    elif grep -q "EACCES" "$NPM_ERR_LOG" 2>/dev/null; then
        warn "Global npm dir is not writable by your user (likely a nodejs.org installer setup)."
        say "Switching to a user-owned npm prefix at ~/.npm-global and retrying..."
        mkdir -p "$HOME/.npm-global"
        npm config set prefix "$HOME/.npm-global"
        export PATH="$HOME/.npm-global/bin:$PATH"
        for rc in "$HOME/.zshrc" "$HOME/.bash_profile" "$HOME/.bashrc"; do
            if [ -f "$rc" ] && ! grep -q ".npm-global/bin" "$rc"; then
                printf '\n# YouCloned: user-level npm prefix\nexport PATH="$HOME/.npm-global/bin:$PATH"\n' >> "$rc"
            fi
        done
        if npm install -g @anthropic-ai/claude-code; then
            ok "Claude Code installed to ~/.npm-global/bin."
        else
            warn "Retry failed. Run manually: npm install -g @anthropic-ai/claude-code"
            exit 1
        fi
    else
        cat "$NPM_ERR_LOG" >&2
        warn "npm install failed for a reason other than permissions. See output above."
        exit 1
    fi
fi

# ----- Step 8: Obsidian vault folder + starter CLAUDE.md -----
say ""
say "Where is your Obsidian vault located?"
say "(Hit Enter for the default ~/Documents/Obsidian Vault. If the folder does not exist, it will be created.)"
read -r VAULT_PATH
VAULT_PATH=${VAULT_PATH:-"$HOME/Documents/Obsidian Vault"}
VAULT_PATH="${VAULT_PATH/#\~/$HOME}"

if [ ! -d "$VAULT_PATH" ]; then
    say "Creating $VAULT_PATH ..."
    mkdir -p "$VAULT_PATH"
    ok "Vault folder created."
fi

if [ -f "$VAULT_PATH/CLAUDE.md" ]; then
    ok "CLAUDE.md already exists at $VAULT_PATH/CLAUDE.md. Leaving it alone."
else
    curl -fsSL https://youcloned.bnsn.ai/install/CLAUDE.md -o "$VAULT_PATH/CLAUDE.md"
    ok "Starter CLAUDE.md placed at $VAULT_PATH/CLAUDE.md"
fi

# ----- Step 9: Starter .env (slot waiting for Supabase + ElevenLabs) -----
if [ -f "$VAULT_PATH/.env" ]; then
    ok ".env already exists at $VAULT_PATH/.env. Leaving it alone."
else
    cat > "$VAULT_PATH/.env" <<'ENV_EOF'
# YouCloned environment file
# Your AI clone reads this at session start.
# Fill in a value as you reach each module. Empty slots are fine.

# Supabase database connection string
# Get from supabase.com -> your project -> Connect (session pooler)
DATABASE_URL=

# ElevenLabs voice synthesis
ELEVENLABS_API_KEY=

# OpenAI (some skills support both providers)
OPENAI_API_KEY=
ENV_EOF
    ok "Starter .env placed at $VAULT_PATH/.env"
fi

# ----- Step 10: YouCloned skills pack -----
say ""
say "Updating your YouCloned skills pack..."
SKILLS_ZIP="/tmp/youcloned-starter-skills.zip"
SKILLS_DIR="$HOME/.claude/skills"
SKILLS_STAGE="/tmp/yc-skills-stage"
mkdir -p "$SKILLS_DIR"
rm -rf "$SKILLS_STAGE"; mkdir -p "$SKILLS_STAGE"

if curl -fsSL https://youcloned.bnsn.ai/install/skills/youcloned-starter-skills.zip -o "$SKILLS_ZIP"; then
    unzip -oq "$SKILLS_ZIP" -d "$SKILLS_STAGE"
    NEW=0; UPDATED=0
    for d in "$SKILLS_STAGE"/skills/*/; do
        [ -d "$d" ] || continue
        name=$(basename "$d")
        if [ -f "$d/SKILL.md" ]; then
            if [ -e "$SKILLS_DIR/$name" ]; then UPDATED=$((UPDATED+1)); else NEW=$((NEW+1)); fi
        fi
        rm -rf "$SKILLS_DIR/$name"
        cp -R "$d" "$SKILLS_DIR/$name"
    done
    rm -rf "$SKILLS_STAGE"
    ok "Skills pack updated: $NEW new, $UPDATED refreshed to latest. (Your own custom skills were left untouched.)"
    echo "     Design + image + presentation skills now installed:"
    echo "     /design, /slides, /branding, /banner-design, /impeccable-impeccable,"
    echo "     /ui-ux-pro-max, /book-layout, /pdf-creator, and more."
else
    warn "Could not download the skills pack. You can re-run this installer later; the core stack is still installed."
fi

# ----- Step 11: Verify -----
say ""
say "Verifying claude command..."
if command -v claude >/dev/null 2>&1; then
    ok "claude command is on your PATH."
else
    warn "claude command is not on your PATH yet. Try restarting your terminal and running: claude"
fi

# ----- Done. Next steps. -----
say ""
say "All set. Next steps:"
echo ""
echo "  1. Open Obsidian. When it asks for a vault, point it at:"
echo "     $VAULT_PATH"
echo ""
echo "  2. Open Cursor. Choose File > Open Folder, and pick that same vault folder."
echo ""
echo "  3. In Cursor, open the integrated terminal (View > Terminal) and type:"
echo "     claude"
echo "     Your clone will load CLAUDE.md and be ready to work."
echo ""
say "Optional accounts the YouCloned course also uses (sign up when you get to those modules):"
echo "  - NotebookLM (long-term memory):  https://notebooklm.google.com"
echo "  - Supabase (your database):       https://supabase.com"
echo "  - Wispr Flow (voice-to-text):     https://wisprflow.ai"
echo "  - ElevenLabs (voice synthesis):   https://elevenlabs.io"
echo ""
say "Done."
