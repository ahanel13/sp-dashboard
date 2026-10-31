#!/bin/bash
set -euo pipefail

PROJECT="$1"
OUTPUT="build/$PROJECT/index.html"
html-minifier-terser \
    --collapse-whitespace \
    --remove-comments \
    --remove-optional-tags \
    --remove-attribute-quotes \
    --collapse-boolean-attributes \
    --minify-css true \
    --minify-js '{"compress":{"passes":3},"mangle":{"toplevel":true}}' \
    -o "$OUTPUT" "$PROJECT/index.html"

# Uploaded plugins have a 100 KB per-file limit in Super Productivity.
# Fail the build instead of producing a ZIP that the app cannot install.
SIZE=$(wc -c < "$OUTPUT" | tr -d '[:space:]')
if [ "$SIZE" -gt 100000 ]; then
    echo "Error: $OUTPUT is $SIZE bytes; it must not exceed 100000 bytes." >&2
    exit 1
fi
