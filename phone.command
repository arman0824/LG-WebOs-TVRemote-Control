#!/bin/zsh
cd "$(dirname "$0")" || exit 1
npm run start:phone
echo
echo "Open the URL shown above on your phone."
echo "Connect your phone, laptop and TV to the same Wi-Fi or phone hotspot."
