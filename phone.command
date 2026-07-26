#!/bin/zsh
cd "$(dirname "$0")" || exit 1
npm run start:phone
echo
echo "Open the URL shown above on your phone."
echo "Your phone and Mac must be on the same Wi-Fi."
