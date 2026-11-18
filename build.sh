#!/bin/sh
# Rebuild index.html from shell.template.html (puts the public anon key in). Run from this folder.
KEY=$(grep -o '"key": "[^"]*"' outstanding/index.html | head -1 | sed 's/"key": "\(.*\)"/\1/')
python3 - "$KEY" <<'PY'
import sys
s=open('shell.template.html').read().replace('__KEY__',sys.argv[1])
open('index.html','w').write(s)
PY
