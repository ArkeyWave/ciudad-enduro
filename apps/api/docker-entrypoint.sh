#!/bin/sh
# Migrate, then start the API.
set -e
node dist/db/migrate.js
exec node dist/main.js
