#!/bin/sh
# Halo for Linux — the one-line installer.
#
#   curl -fsSL https://halo.example/install.sh | sh
#
# What it does: asks this site's download manifest for the build that runs on this machine,
# checks its SHA-256, and installs it for you alone — the program in ~/.local/bin, a `halo`
# command beside it, and a menu entry and icon under ~/.local/share. No root, nothing written
# outside your home, and your settings are never touched.
#
#   * The AppImage is preferred, because it is the build that needs no privileges at all.
#   * A machine with only a .deb published gets the package installed with apt, which asks for
#     your password. That is the one place this script cannot avoid root.
#
# Options:
#   sh install.sh --uninstall     remove the program, the command, the menu entry and the icon
#   HALO_MANIFEST=<url>           read a different manifest (a preview deploy, a fork)
#   HALO_DOWNLOADS_BASE=<url>     fetch the files from somewhere else (a GitHub Release)
#
# The installers are published by .github/workflows/build.yml. Until a Linux build is attached
# to a release this stops and says so, rather than installing half of something.
set -eu

APP_NAME="Halo"
APP_ID="halo"
# The address this file was deployed with. tools/web-config.js rewrites both defaults from
# HALO_SITE_URL and HALO_DOWNLOADS_BASE at build time; the environment still wins, which is what
# makes a preview deploy, a fork or a LAN test work without editing this file.
SITE="${HALO_SITE_URL:-https://halo.example}"
BASE="${HALO_DOWNLOADS_BASE:-}"
MANIFEST="${HALO_MANIFEST:-$SITE/downloads.json}"

BIN_DIR="${XDG_BIN_HOME:-$HOME/.local/bin}"
DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}"
APPS_DIR="$DATA_DIR/applications"
ICON_DIR="$DATA_DIR/icons/hicolor/512x512/apps"
TARGET="$BIN_DIR/$APP_NAME.AppImage"
DESKTOP_FILE="$APPS_DIR/$APP_ID.desktop"

say() { printf '  %s\n' "$1"; }
die() { printf '\n  %s\n\n' "$1" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

# ---- uninstall --------------------------------------------------------------

if [ "${1:-}" = "--uninstall" ]; then
  rm -f "$DESKTOP_FILE" "$ICON_DIR/$APP_ID.png" "$BIN_DIR/$APP_ID" "$TARGET"
  if have update-desktop-database; then
    update-desktop-database "$APPS_DIR" >/dev/null 2>&1 || true
  fi
  say "$APP_NAME is uninstalled."
  say "Your settings and history in ${XDG_CONFIG_HOME:-$HOME/.config}/Halo were left alone."
  if have dpkg && dpkg -s halo >/dev/null 2>&1; then
    say "The .deb is still installed; remove it with:  sudo apt remove halo"
  fi
  exit 0
fi

# ---- what machine is this ---------------------------------------------------

case "$(uname -m)" in
  x86_64|amd64) ARCH=x64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) ARCH="$(uname -m)" ;;
esac

have curl || die "curl is needed to download the build, and it is not on PATH.
  Install it (Debian/Ubuntu: sudo apt install curl) and run this again."

# ---- what has been published ------------------------------------------------

TMP="$(mktemp -d 2>/dev/null || mktemp -d -t halo)" || die "Could not make a temporary folder."
trap 'rm -rf "$TMP"' EXIT INT TERM

curl -fsSL "$MANIFEST" -o "$TMP/downloads.json" \
  || die "Could not read the download list at $MANIFEST
  Nothing is installed. Check the address, or open it in a browser to see what it says."

# The manifest is written by tools/release-manifest.js, which puts each build on its own line
# and indents every field, so a build can be found without a JSON parser: the objects are split
# onto separate lines here and matched by the three fields that identify one.
FLAT="$(tr -d '\n' < "$TMP/downloads.json" | sed 's/}[[:space:]]*,[[:space:]]*{/}\n{/g')"
obj() {
  printf '%s\n' "$FLAT" \
    | grep -F '"platform": "linux"' \
    | grep -F "\"arch\": \"$ARCH\"" \
    | grep -F "\"kind\": \"$1\"" \
    | head -n 1 || true
}
field() { printf '%s\n' "$1" | sed -n "s/.*\"$2\": \"\\([^\"]*\\)\".*/\\1/p"; }

KIND=AppImage
ASSET="$(obj AppImage)"
if [ -z "$ASSET" ]; then
  KIND=deb
  ASSET="$(obj deb)"
fi
[ -n "$ASSET" ] || die "No Linux build is published for this machine ($ARCH).
  The download page lists what does exist: $SITE/download
  Building it yourself is two commands: npm install && npm run build:linux"

URL="$(field "$ASSET" url)"
FILE="$(field "$ASSET" file)"
SHA="$(field "$ASSET" sha256)"
[ -n "$URL" ] || die "The download list has a Linux build with no address in it. Nothing is installed."
[ -n "$FILE" ] || FILE="halo-$KIND"

# Relative addresses are joined to whatever serves them: the release named by
# downloads.baseUrl, or this site's own folder when there is none.
case "$URL" in
  http://*|https://*) FULL="$URL" ;;
  /*) FULL="$SITE$URL" ;;
  *) if [ -n "$BASE" ]; then FULL="${BASE%/}/${URL#downloads/}"; else FULL="$SITE/$URL"; fi ;;
esac
# A space is legal in a file name and has to be encoded in a URL.
FULL="$(printf '%s' "$FULL" | sed 's/ /%20/g')"

say "Downloading $APP_NAME for $ARCH ..."
curl -fL --progress-bar "$FULL" -o "$TMP/$FILE" \
  || die "Could not download $FULL
  Nothing is installed. The file may have moved to a new release; see $SITE/download"

if [ -n "$SHA" ]; then
  GOT=''
  if have sha256sum; then GOT="$(sha256sum "$TMP/$FILE" | cut -d' ' -f1)"
  elif have shasum; then GOT="$(shasum -a 256 "$TMP/$FILE" | cut -d' ' -f1)"; fi
  if [ -z "$GOT" ]; then
    say "No sha256 tool on this machine, so the download was not checked."
  elif [ "$GOT" != "$SHA" ]; then
    die "The download does not match the hash published for it.
  Expected $SHA
  Got      $GOT
  Nothing is installed. Try again, and if it keeps happening, do not run the file."
  fi
fi

# ---- install ----------------------------------------------------------------

if [ "$KIND" = deb ]; then
  have apt-get || die "This machine has no apt, so the published .deb cannot be installed here.
  The AppImage is the build that needs nothing: $SITE/download"
  say "Installing the package — this asks for your password ..."
  sudo apt-get install -y "$TMP/$FILE" || die "apt refused the package. Nothing is installed."
  printf '\n'
  say "$APP_NAME is installed."
  say "  command  $APP_ID   (from the package)"
  exit 0
fi

mkdir -p "$BIN_DIR" "$APPS_DIR" "$ICON_DIR"
chmod +x "$TMP/$FILE"
cp "$TMP/$FILE" "$TARGET"
chmod 755 "$TARGET"
ln -sf "$TARGET" "$BIN_DIR/$APP_ID"

# The menu icon comes out of the AppImage itself, so a machine that has only this script still
# gets a real icon rather than a generic one.
( cd "$TMP" && "$TARGET" --appimage-extract '*.png' >/dev/null 2>&1 ) || true
ICON_SRC="$(find "$TMP/squashfs-root" -type f -name '*.png' -size +1k 2>/dev/null | head -n 1 || true)"
if [ -n "$ICON_SRC" ]; then
  cp "$ICON_SRC" "$ICON_DIR/$APP_ID.png"
  ICON="$ICON_DIR/$APP_ID.png"
else
  ICON=utilities-terminal
fi

# Ubuntu 24.04 and later refuse unprivileged user namespaces to unconfined apps, which is how
# Chromium's sandbox starts. An AppImage dies there before drawing a window, with a message that
# reads like a broken install. The flag goes in the menu entry so the icon actually opens it.
SANDBOX=''
RESTRICT=/proc/sys/kernel/apparmor_restrict_unprivileged_userns
if [ -r "$RESTRICT" ] && [ "$(cat "$RESTRICT" 2>/dev/null || echo 0)" = "1" ]; then
  SANDBOX='--no-sandbox'
fi

# Exec quoting: the path can contain spaces, and a .desktop Exec is not a shell — it needs its
# own quoting, which is the double quotes around the path.
cat > "$DESKTOP_FILE" <<EOF
[Desktop Entry]
Type=Application
Name=$APP_NAME
GenericName=AI assistant
Comment=Chat with an assistant that can work on this PC
Exec="$TARGET" $SANDBOX %U
Icon=$ICON
Terminal=false
Categories=Utility;
StartupWMClass=$APP_NAME
EOF
chmod 644 "$DESKTOP_FILE"

if have update-desktop-database; then
  update-desktop-database "$APPS_DIR" >/dev/null 2>&1 || true
fi

printf '\n'
say "$APP_NAME is installed."
say "  program  $TARGET"
say "  command  $APP_ID   (in $BIN_DIR)"
case ":$PATH:" in
  *":$BIN_DIR:"*) say "  run it   $APP_ID" ;;
  *) say "  run it   $TARGET"
     say "  add $BIN_DIR to your PATH to run '$APP_ID' from a terminal." ;;
esac
if [ -n "$SANDBOX" ]; then
  say "  note     this system restricts unprivileged user namespaces (Ubuntu 24.04+),"
  say "           which is why the menu entry starts Halo with --no-sandbox."
fi
printf '\n'
