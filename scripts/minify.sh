#!/bin/bash
set -euo pipefail

# Super Productivity caps a plugin's index.html at MAX_PLUGIN_MANIFEST_SIZE — 102400
# bytes — and serves it to the iframe via srcdoc, so nothing can be split into a
# sibling file. Everything below exists to fit the budget; `make build` fails loudly
# if the result goes over. Hosts that give index.html its own larger cap (see
# super-productivity#10578 / #11062) can be targeted with SP_INDEX_LIMIT=<bytes>.

# Runnable directly as well as through `npm run build:min`, which is the only reason
# node_modules/.bin would already be on PATH.
PATH="$(cd "$(dirname "$0")/.." && pwd)/node_modules/.bin:$PATH"

PROJECT="$1"
SRC="$PROJECT/index.html"
OUT="build/$PROJECT/index.html"
LIMIT="${SP_INDEX_LIMIT:-102400}"
STAGE="$(mktemp -t sp-dashboard-src.XXXXXX.html)"
trap 'rm -f "$STAGE"' EXIT

# Two regions are development-only and never run inside the host app:
#   MOCK          — the file:// fallback data (host always provides PluginAPI)
#   TEST-EXPORTS  — window.* assignments the JSDOM suite reads (tests run on source)
# Both are marked in the source so this stays a delete, not a parse.
sed -e '/BUILD:MOCK-START/,/BUILD:MOCK-END/d' \
    -e '/BUILD:TEST-EXPORTS-START/,/BUILD:TEST-EXPORTS-END/d' \
    "$SRC" > "$STAGE"

for MARKER in BUILD:MOCK-START BUILD:MOCK-END BUILD:TEST-EXPORTS-START BUILD:TEST-EXPORTS-END; do
    if ! grep -q "$MARKER" "$SRC"; then
        echo "✗ $SRC is missing the $MARKER marker; refusing to build a half-stripped file" >&2
        exit 1
    fi
done

# mangle.toplevel is safe because the script is not a module: everything the host or
# the markup reaches is a DOM listener or a PluginAPI callback, never a global by name.
# debugLog/debugWarn are pure — dropping the calls drops their message strings too.
html-minifier-terser \
    --collapse-whitespace \
    --remove-comments \
    --remove-optional-tags \
    --collapse-boolean-attributes \
    --remove-redundant-attributes \
    --remove-attribute-quotes \
    --minify-css true \
    --minify-js '{"ecma":2020,"mangle":{"toplevel":true},"compress":{"ecma":2020,"toplevel":true,"passes":10,"booleans_as_integers":true,"keep_fargs":false,"hoist_props":true,"pure_getters":true,"pure_funcs":["debugLog","debugWarn"]},"format":{"ecma":2020}}' \
    -o "$OUT" "$STAGE"

SIZE=$(wc -c < "$OUT")
PCT=$((SIZE * 100 / LIMIT))
if [ "$SIZE" -gt "$LIMIT" ]; then
    echo "✗ $OUT is $SIZE bytes — over Super Productivity's $LIMIT byte limit by $((SIZE - LIMIT))" >&2
    exit 1
fi
echo "✓ $OUT: $SIZE / $LIMIT bytes (${PCT}% of the plugin index.html budget)"
