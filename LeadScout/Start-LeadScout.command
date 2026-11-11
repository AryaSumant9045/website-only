#!/bin/bash
# LeadScout — double-click this file to start the app.
# Close this Terminal window (or press Ctrl+C) to stop it.

cd "$(dirname "$0")" || exit 1

# Start the browser a moment after the server boots.
( sleep 1.6; open "http://127.0.0.1:8787" ) &

echo ""
echo "  LeadScout starting…  →  http://127.0.0.1:8787"
echo "  Is window ko band karne se app ruk jayega (Ctrl+C)."
echo ""

exec node server.mjs
