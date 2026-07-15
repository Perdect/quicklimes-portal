#!/usr/bin/env bash
# ── verify-deploy.sh ────────────────────────────────────────────────────────
# Proves the LIVE site is byte-identical to the tree this build produced.
#
# Why: on 2026-07-15 an FTPS sync died part-way. New HTML asking for
# qlx.css?v=m6 went live while the CSS did not, so browsers cached that URL with
# the OLD body and kept the stale asset even after a rerun. Nothing reported the
# SITE as broken — only a hand-check found it.
#
# A status check CANNOT catch this. Versioning here is a QUERY STRING and the
# server ignores it: qlx.css?v=DOES_NOT_EXIST returns 200 with 49,992 bytes
# (measured). So the only honest test is CONTENT — fetch each file and compare
# its md5 against the artifact we just deployed.
set -uo pipefail

APP="${APP_BASE:-https://app.quicklimes.com}"
WWW="${WWW_BASE:-https://quicklimes.com}"
ASSETS_DIR="${ASSETS_DIR:-deploy}"          # non-html tree
HTML_DIR="${HTML_DIR:-deploy_html}"         # html tree
FAILS=$(mktemp); CHECKS=$(mktemp)           # subshell-safe tallies (while-read pipes fork)

cb() { echo "nc=$(date +%s%N)$RANDOM"; }    # bypass any edge cache — test the origin
md5of() { if command -v md5sum >/dev/null; then md5sum "$1" | cut -d' ' -f1; else md5 -q "$1"; fi; }

# cmp_remote <url> <local_file> <label>
cmp_remote() {
  local url="$1" lf="$2" label="$3" tmp; tmp=$(mktemp)
  if [ ! -f "$lf" ]; then echo "   ✗ NOT IN BUILD: $label → expected $lf" | tee -a "$FAILS"; rm -f "$tmp"; return; fi
  echo x >> "$CHECKS"
  # An FTPS write can still be settling right after upload. Retry a real
  # mismatch before failing the build: a FALSE red teaches everyone to ignore
  # this check, which is worse than having no check at all. Only a mismatch
  # that survives ~45s is called a half-deploy.
  local a b code try
  for try in 1 2 3 4; do
    # &t=$try keeps every retry a distinct URL, so a cached copy of the first
    # (failed) fetch can never be replayed back to us as a pass or a fail.
    code=$(curl -sL -H 'Cache-Control: no-cache' -o "$tmp" -w '%{http_code}' "${url}&t=${try}")
    a=$(md5of "$tmp"); b=$(md5of "$lf")
    { [ "$code" = "200" ] && [ "$a" = "$b" ]; } && break
    [ "$try" -lt 4 ] && { echo "   … $label mismatch, settling ($try/3)"; sleep 15; }
  done
  if [ "$code" != "200" ]; then
    echo "   ✗ HTTP $code → $label" | tee -a "$FAILS"; rm -f "$tmp"; return
  fi
  if [ "$a" != "$b" ]; then
    { echo "   ✗ STALE → $label"
      echo "       live  $(wc -c <"$tmp" | tr -d ' ')B  $a"
      echo "       built $(wc -c <"$lf"  | tr -d ' ')B  $b"
      echo "       Server is serving a DIFFERENT file than this build produced —"
      echo "       a half-deploy. Re-run the deploy before users load the page."
    } | tee -a "$FAILS"
  else
    echo "   ✓ $label"
  fi
  rm -f "$tmp"
}

# check_page <live_url> <local_html> <site_root_dir>  <label>
#   site_root_dir = local dir that maps to that host's "/" (for /absolute refs)
check_page() {
  local url="$1" hf="$2" root="$3" label="$4"
  echo "── $label"
  cmp_remote "$url?$(cb)" "$hf" "$label (page)"
  [ -f "$hf" ] || return
  local reldir base
  reldir=$(dirname "${hf#$HTML_DIR/}"); [ "$reldir" = "." ] && reldir=""
  base=$(dirname "$url")
  local refs; refs=$(grep -oE '(src|href)="\.?/?[^"]+\.(js|css)\?v=[^"]*"' "$hf" | sed -E 's/^(src|href)="//; s/"$//' | sort -u)
  [ -z "$refs" ] && { echo "   … no versioned assets referenced"; return; }
  while IFS= read -r a; do
    [ -z "$a" ] && continue
    local path full lf
    path="${a%%\?*}"                                   # drop ?v=…
    case "$path" in
      /*)  full="$(echo "$url" | cut -d/ -f1-3)$path"; lf="$root$path" ;;
      ./*) full="$base/${path#./}"; lf="$ASSETS_DIR/${reldir:+$reldir/}${path#./}" ;;
      *)   full="$base/$path";      lf="$ASSETS_DIR/${reldir:+$reldir/}$path" ;;
    esac
    cmp_remote "$full?$(cb)" "$lf" "$(basename "$a")"
  done <<< "$refs"
}

echo "══ verifying the live site is byte-identical to this build ══"
[ -d "$ASSETS_DIR" ] || { echo "‼️  $ASSETS_DIR/ missing — run this after the build step"; exit 1; }

check_page "$APP/v2/dashboard" "$HTML_DIR/app/v2/dashboard.html" "$ASSETS_DIR/app" "app · dashboard"
check_page "$APP/v2/purchase"  "$HTML_DIR/app/v2/purchase.html"  "$ASSETS_DIR/app" "app · purchase"
check_page "$WWW/"             "$HTML_DIR/index.html"            "$ASSETS_DIR"     "marketing · home"

echo "── api · ping"
pc=$(curl -sL -o /dev/null -w '%{http_code}' "$APP/api/ping.php?$(cb)")
if [ "$pc" = "200" ]; then echo "   ✓ /api/ping.php 200"; else echo "   ✗ /api/ping.php HTTP $pc" | tee -a "$FAILS"; fi

n_fail=$(grep -c '✗' "$FAILS" 2>/dev/null || true); n_fail=${n_fail:-0}
n_chk=$(wc -l < "$CHECKS" 2>/dev/null || echo 0); n_chk=$(echo "$n_chk" | tr -d ' ')
rm -f "$FAILS" "$CHECKS"
echo
if [ "$n_fail" -gt 0 ]; then
  echo "❌ VERIFY FAILED — $n_fail problem(s) across $n_chk checks. Live site ≠ this build."
  exit 1
fi
echo "✅ verified $n_chk files — live site is byte-identical to this build"
