#!/bin/sh
# Linux/macOS: ./iniciar.sh
cd "$(dirname "$0")"
exec python3 servidor.py "$@"
