#!/bin/sh
# Creates the development database with PostGIS on first container start.
# Test databases are created on demand by the API test global setup.
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<'SQL'
CREATE DATABASE ciudad_enduro;
\connect ciudad_enduro
CREATE EXTENSION IF NOT EXISTS postgis;
SQL
