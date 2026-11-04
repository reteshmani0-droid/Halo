#!/usr/bin/env bash
# Halo for Linux — one click.
#
#     curl -fsSL https://halo-iota-three.vercel.app/install.sh | sh
#
# What this does, and what it deliberately does not:
#
#   * It installs the build that fits this machine, in this order of preference:
#       Flatpak   — if flatpak is installed and a Flatpak is published. It carries its own
#                   runtime, so it is the one that does not care which distribution this is.
#       AppImage  — otherwise. One file, no root, no package manager to fall over on.
#       .deb      — never installed automatically, because it needs root. The command is
#                   printed for you to run.
#   * It downloads from the site that served this script, reads the published manifest
#     (downloads.json) to find the right file, and checks the file against the SHA-256 in
#     that manifest. A download that does not match is deleted, not installed.
#   * It writes into your own home: ~/.local/bin for the program, ~/.local/share for the
#     menu entry and the icon. Nothing here needs sudo, and nothing outside your home is
#     touched. The Flatpak route installs for the current user too (`--user`).
#   * It does not delete or rewrite your settings. They live in ~/.config/Halo (or
#     $XDG_CONFIG_HOME/Halo), or ~/.var/app/com.halo.Halo/config/Halo for the Flatpak, and
#     belong to the app, not to the installer.
#
# Usage:
#   sh install.sh                     install the best build for this machine
#   sh install.sh --flatpak           insist on the Flatpak
#   sh install.sh --appimage          insist on the AppImage
#   sh install.sh --deb               download the .deb and print the apt line for it
#   sh install.sh --list              show the Linux builds that are published
#   sh install.sh path/to/Halo.flatpak  install a file you already have
#   sh install.sh --uninstall         remove the program, menu entry and icon
#
# Building from source instead:  npm run build:linux  &&  npm run build:flatpak
#   ...then run this script from the repository and it installs what is in dist/.
set -euo pipefail

APP_NAME="Halo"
APP_ID="halo"
FLATPAK_ID="com.halo.Halo"
BASE="${HALO_BASE_URL:-https://halo-iota-three.vercel.app}"
BIN_DIR="${XDG_BIN_HOME:-$HOME/.local/bin}"
DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}"
APPS_DIR="$DATA_DIR/applications"
ICON_DIR="$DATA_DIR/icons/hicolor/512x512/apps"
DESKTOP_FILE="$APPS_DIR/$APP_ID.desktop"
TARGET="$BIN_DIR/$APP_NAME.AppImage"
MY_ARCH="$(uname -m)"
# When this script is piped to sh there is no file next to it, so there is no dist/ to look
# in — that is the normal case for the one-liner, and the reason for the download path below.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]:-$PWD/install.sh}")" 2>/dev/null && pwd || pwd)"
WORK=""

say() { printf '  %s\n' "$1"; }
die() { printf '\n  %s\n\n' "$1" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }
cleanup() { [ -n "$WORK" ] && rm -rf "$WORK"; }
trap cleanup EXIT

# ---- uninstall ------------------------------------------------------------

uninstall() {
  rm -f "$DESKTOP_FILE" "$ICON_DIR/$APP_ID.png" "$BIN_DIR/$APP_ID" "$TARGET"
  if have update-desktop-database; then
    update-desktop-database "$APPS_DIR" >/dev/null 2>&1 || true
  fi
  if have flatpak && flatpak info "$FLATPAK_ID" >/dev/null 2>&1; then
    flatpak uninstall --user -y "$FLATPAK_ID" >/dev/null 2>&1 || true
    say "The Flatpak was removed as well."
  fi
  say "Halo is uninstalled."
  say "Your settings and history in ${XDG_CONFIG_HOME:-$HOME/.config}/Halo were left alone."
  exit 0
}

# ---- read the published manifest -----------------------------------------
#
# downloads.json is a flat array of one line per asset, so it is read here without needing
# jq, python or node on the machine: newlines are removed, the objects are split back apart,
# and each field is pulled out of the one-line object. The site writes the file; this script
# only reads it, which is what keeps the published list and the installer in step.

fetch_manifest() {
  have curl || die "curl is needed to download Halo — install it (apt install curl) and run this again."
  WORK="${WORK:-$(mktemp -d)}"
  curl -fsSL "$BASE/downloads.json" -o "$WORK/downloads.json" 2>/dev/null \
    || die "Could not read $BASE/downloads.json — the site is unreachable, or nothing is published yet."
  # The newline at the end matters: `while read` skips a final line that has none, which
  # would silently hide the last published build from every choice below.
  { tr -d '\n' < "$WORK/downloads.json" | sed -E 's/}[[:space:]]*,[[:space:]]*\{/}\n{/g'; printf '\n'; } > "$WORK/assets"
}

field() { sed -n 's/.*"'"$2"'": "\([^"]*\)".*/\1/p' <<<"$1"; }

# Whether a manifest arch is this machine. The two spellings are both in use on purpose: the
# Flatpak is named after `uname -m` (x86_64, aarch64) and electron-builder after its own
# names (x64, arm64).
arch_ok() {
  case "$MY_ARCH:$1" in
    x86_64:x86_64|x86_64:x64|amd64:x86_64|amd64:x64) return 0 ;;
    aarch64:aarch64|aarch64:arm64|arm64:aarch64|arm64:arm64) return 0 ;;
  esac
  return 1
}

# The first published Linux asset of the first kind asked for, as one manifest line.
choose() {
  local kind line
  for kind in "$@"; do
    while IFS= read -r line; do
      [ -n "$line" ] || continue
      case "$line" in *'"platform": "linux"'*) ;; *) continue ;; esac
      [ "$(field "$line" kind)" = "$kind" ] || continue
      arch_ok "$(field "$line" arch)" || continue
      printf '%s\n' "$line"
      return 0
    done < "$WORK/assets"
  done
  return 1
}

list_assets() {
  fetch_manifest
  local line found=0
  say "Linux builds published at $BASE:"
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    case "$line" in *'"platform": "linux"'*) ;; *) continue ;; esac
    found=1
    say "  $(field "$line" kind)  $(field "$line" arch)  $(field "$line" file)"
  done < "$WORK/assets"
  # Saying there is nothing is the point of this flag: a finished-looking list that is
  # silently empty sends people to a 404.
  [ "$found" = "1" ] || say "  (none yet — the builds are added to this list when they are released)"
}

# Download an asset and refuse it unless it matches the published SHA-256. Only the path of
# the finished file goes to stdout, because every caller captures it with $(...): the progress
# and the chatter have to go to stderr or they end up inside the file name.
grab() {
  local line="$1" url file sha full actual
  url="$(field "$line" url)"
  file="$(field "$line" file)"
  sha="$(field "$line" sha256)"
  [ -n "$url" ] || die "The published entry has no download address — the manifest is incomplete."
  case "$url" in
    http://*|https://*) full="$url" ;;
    /*) full="$BASE$url" ;;
    *) full="$BASE/$url" ;;
  esac
  WORK="${WORK:-$(mktemp -d)}"
  say "downloading $file" >&2
  curl -fL --progress-bar "$full" -o "$WORK/$file" \
    || die "Could not download $full"
  if [ -n "$sha" ] && have sha256sum; then
    actual="$(sha256sum "$WORK/$file" | cut -d' ' -f1)"
    if [ "$actual" != "$sha" ]; then
      rm -f "$WORK/$file"
      die "The download does not match the published SHA-256 and was deleted.
  expected  $sha
  got       $actual
  This means the file changed in transit or was replaced; try again, and if it keeps
  happening do not install it — download it by hand from $BASE/download."
    fi
    say "checksum matches" >&2
  fi
  printf '%s\n' "$WORK/$file"
}

# ---- install the three kinds ---------------------------------------------

install_flatpak() {
  local file="$1" src
  if [ -d "$file" ]; then src="$file"; else src="$(grab "$file")"; fi
  have flatpak || die "flatpak is not installed — the AppImage needs no package manager:
  sh install.sh --appimage"
  say "installing the Flatpak"
  flatpak install --user -y "$src" || die "flatpak install failed. The bundle is at $src"
  say "Halo is installed."
  say "  run      flatpak run $FLATPAK_ID"
  say "  settings ${XDG_CONFIG_HOME:-$HOME/.config}/Halo, inside the Flatpak's own folder"
  say "  remove   sh install.sh --uninstall"
}

install_deb() {
  local file="$1" src
  if [ -d "$file" ]; then src="$file"; else src="$(grab "$file")"; fi
  # Handing somebody a sudo prompt from a script they piped into sh is not a thing to do
  # quietly, so the command is printed and the script stops.
  echo ""
  say "The .deb is downloaded and checked. Installing it needs root, so run:"
  say "  sudo apt install \"$src\""
  echo ""
  say "No root? Use the AppImage or the Flatpak instead:  sh install.sh --appimage"
}

install_appimage() {
  local APPIMAGE="$1"
  [ -f "$APPIMAGE" ] || die "There is no file at $APPIMAGE"

  mkdir -p "$BIN_DIR" "$APPS_DIR" "$ICON_DIR"
  install -m 755 "$APPIMAGE" "$TARGET"
  ln -sf "$TARGET" "$BIN_DIR/$APP_ID"

  # The menu icon. The repository has one at full size; an install from a downloaded
  # AppImage alone extracts the icon it already carries, so a single file is still a
  # complete install.
  local ICON_SRC="$HERE/assets/icon-1024.png"
  if [ ! -f "$ICON_SRC" ]; then
    local TMP_ICON
    TMP_ICON="$(mktemp -d)"
    ( cd "$TMP_ICON" && "$TARGET" --appimage-extract '*.png' >/dev/null 2>&1 ) || true
    ICON_SRC="$(find "$TMP_ICON" -type f -name '*.png' -size +1k 2>/dev/null | head -n 1 || true)"
    # Only the directory this script made: a squashfs-root left in /tmp by somebody else's
    # AppImage is not ours to delete.
    rm -rf "$TMP_ICON"
  fi

  local ICON_VALUE
  if [ -n "${ICON_SRC:-}" ] && [ -f "$ICON_SRC" ]; then
    cp "$ICON_SRC" "$ICON_DIR/$APP_ID.png"
    ICON_VALUE="$ICON_DIR/$APP_ID.png"
  else
    # A missing icon must not fail the install; the menu shows a generic one instead.
    ICON_VALUE="utilities-terminal"
  fi

  # Ubuntu 24.04 and later refuse unprivileged user namespaces to unconfined apps, which is
  # how Chromium's sandbox starts. On that kernel an AppImage dies before drawing a window,
  # with a message about the SUID sandbox helper that reads like a broken install. The .deb
  # is unaffected (it installs the helper as root), so this is the one place the routes
  # differ — and the flag goes in the menu entry so clicking the icon actually opens Halo.
  local SANDBOX_FLAG="" SANDBOX_NOTE=""
  local RESTRICT=/proc/sys/kernel/apparmor_restrict_unprivileged_userns
  if [ -r "$RESTRICT" ] && [ "$(cat "$RESTRICT" 2>/dev/null || echo 0)" = "1" ]; then
    SANDBOX_FLAG="--no-sandbox"
    SANDBOX_NOTE="1"
  fi

  # Exec quoting: the path can contain spaces (`~/My Apps`), and a .desktop Exec is not
  # a shell — it needs its own quoting, which is the double quotes around the path.
  cat > "$DESKTOP_FILE" <<EOF
[Desktop Entry]
Type=Application
Name=$APP_NAME
GenericName=AI assistant
Comment=Chat with an assistant that can work on this PC
Exec="$TARGET" ${SANDBOX_FLAG:-} %U
Icon=$ICON_VALUE
Terminal=false
Categories=Utility;
StartupWMClass=$APP_NAME
EOF
  chmod 644 "$DESKTOP_FILE"

  if have update-desktop-database; then
    update-desktop-database "$APPS_DIR" >/dev/null 2>&1 || true
  fi

  echo ""
  say "Halo is installed."
  say "  program  $TARGET"
  say "  command  $APP_ID   (symlinked in $BIN_DIR)"
  say "  menu     $DESKTOP_FILE"
  case ":$PATH:" in
    *":$BIN_DIR:"*) ;;
    *) say "Add $BIN_DIR to your PATH to run '$APP_ID' from a terminal." ;;
  esac

  if [ "$SANDBOX_NOTE" = "1" ]; then
    echo ""
    say "Note: this system restricts unprivileged user namespaces (Ubuntu 24.04+),"
    say "which is why the menu entry starts Halo with --no-sandbox. The Flatpak does not"
    say "need it:  sh install.sh --flatpak"
  fi
  echo ""
}

# A file given on the command line is installed as it is, whatever kind it is.
install_file() {
  local file="$1"
  case "$file" in
    *.flatpak) install_flatpak "$file" ;;
    *.deb) install_deb "$file" ;;
    *.AppImage) install_appimage "$file" ;;
    *) die "I do not know how to install \"$file\" — expected a .flatpak, .deb or .AppImage" ;;
  esac
}

# ---- what was asked for ---------------------------------------------------

MODE="auto"
case "${1:-}" in
  --uninstall) uninstall ;;
  --help|-h)
    sed -n '2,24p' "${BASH_SOURCE[0]:-$0}" 2>/dev/null || true
    exit 0 ;;
  --list) list_assets; exit 0 ;;
  --flatpak) MODE="flatpak" ;;
  --appimage) MODE="appimage" ;;
  --deb) MODE="deb" ;;
  "") ;;
  -*) die "Unknown option \"$1\". Try  sh install.sh --help" ;;
  *) install_file "$1"; exit 0 ;;
esac

# ---- a build in the repository, for whoever is working on it --------------
#
# `npm run build:linux` and `npm run build:flatpak` leave their output in dist/, and running
# this script from the checkout should install that rather than a published release.
local_build() {
  local pattern="$1" files
  files=("$HERE"/dist/$pattern)
  [ -e "${files[0]}" ] || return 1
  # `|| true` because `head` closing the pipe early can SIGPIPE `ls`, and with `pipefail`
  # that would abort the whole install on a successful match.
  ls -t "${files[@]}" 2>/dev/null | head -n 1 || true
}

case "$MODE" in
  flatpak) LOCAL="$(local_build '*.flatpak' || true)" ;;
  deb) LOCAL="$(local_build '*.deb' || true)" ;;
  *) LOCAL="$(local_build '*.AppImage' || local_build '*.flatpak' || true)" ;;
esac

if [ -n "${LOCAL:-}" ] && [ -f "$LOCAL" ]; then
  say "using the build in dist/"
  install_file "$LOCAL"
  exit 0
fi

# ---- otherwise download what is published --------------------------------

fetch_manifest

case "$MODE" in
  flatpak)
    LINE="$(choose flatpak || true)"
    [ -n "$LINE" ] || die "No Flatpak is published for $(uname -m) yet. What is published:
$(list_assets)"
    install_flatpak "$LINE"
    ;;
  appimage)
    LINE="$(choose AppImage || true)"
    [ -n "$LINE" ] || die "No AppImage is published for $(uname -m) yet. What is published:
$(list_assets)"
    install_appimage "$(grab "$LINE")"
    ;;
  deb)
    LINE="$(choose deb || true)"
    [ -n "$LINE" ] || die "No .deb is published for $(uname -m) yet. What is published:
$(list_assets)"
    install_deb "$LINE"
    ;;
  auto)
    # The Flatpak first, but only when flatpak is actually installed: handing somebody a
    # browser download they cannot open is not an install.
    if have flatpak && LINE="$(choose flatpak || true)" && [ -n "${LINE:-}" ]; then
      install_flatpak "$LINE"
    elif LINE="$(choose AppImage || true)" && [ -n "${LINE:-}" ]; then
      install_appimage "$(grab "$LINE")"
    elif LINE="$(choose deb || true)" && [ -n "${LINE:-}" ]; then
      install_deb "$LINE"
    else
      die "No Linux build is published for $(uname -m) yet, so there is nothing to install.
  What is published:
$(list_assets)
  Until then, the Windows builds and the source are at $BASE/download"
    fi
    ;;
esac
