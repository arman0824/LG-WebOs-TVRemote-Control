#!/bin/zsh
cd "$(dirname "$0")" || exit 1
npm run start:bg
open "http://127.0.0.1:${PORT:-4173}"
echo
echo "Local LG TV Remote is running."
echo "Double-click stop.command when you want to stop it."
