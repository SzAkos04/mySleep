#!/bin/sh
# Pairs mySleep Night with the server, from the Mac (the server has no page to pair from):
#   scripts/pair.sh
# Prints the link and copies it: paste it on the iPhone (Universal Clipboard: Notes, Messages) and
# tap it; the app asks nothing, it is paired. Pairing again replaces the old pairing. The token is
# kept in the iPhone's Keychain, which the weekly reinstall does not touch.
set -eu
link=$(ssh szakos@csodabogar2 'cd ~/mySleep && docker compose exec -T api node scripts/pair.mjs')
printf '%s\n' "$link"
printf '%s' "$link" | pbcopy
echo "(copied)"
