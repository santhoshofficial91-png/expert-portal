#!/bin/sh
# Rebuild index.html from shell.template.html (puts the public anon key and a build stamp in). Run from this folder before every commit.
KEY=$(grep -o '"key": "[^"]*"' outstanding/index.html | head -1 | sed 's/"key": "\(.*\)"/\1/')
BUILD=$(date -u +%Y%m%d%H%M%S)
python3 - "$KEY" "$BUILD" <<'PY'
import sys
s=open('shell.template.html').read().replace('__KEY__',sys.argv[1]).replace('__BUILD__',sys.argv[2])
open('index.html','w').write(s)
PY
