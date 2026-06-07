#!/usr/bin/env bash
# Task Router client shim (POSIX). Forwards to client.js via node.
exec node "$(dirname "$0")/client.js" "$@"
