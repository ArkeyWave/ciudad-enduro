#!/bin/sh
# Migrate, then start the API. A failed migration stops the container.
set -e
node dist/db/migrate.js
exec node dist/main.js
