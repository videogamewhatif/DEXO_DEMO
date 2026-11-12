#!/usr/bin/env bash
# PostgreSQL local para pruebas de integración (sin Docker).
# Requiere binarios de PostgreSQL 15+ (initdb, pg_ctl). Puerto por defecto 54329.
set -euo pipefail
cd "$(dirname "$0")/.."
PGBIN="${PGBIN:-$(dirname "$(command -v pg_ctl 2>/dev/null || ls -d /usr/lib/postgresql/*/bin/pg_ctl | tail -1)")}"
DATA_DIR="${LOCAL_PG_DIR:-.local-pg}"
PORT="${LOCAL_PG_PORT:-54329}"
case "${1:-}" in
  start)
    if [ ! -d "$DATA_DIR/data" ]; then
      mkdir -p "$DATA_DIR"
      if [ "$(id -u)" = "0" ]; then
        id -u nexopg >/dev/null 2>&1 || useradd -r -M nexopg
        chown -R nexopg "$DATA_DIR"
        su nexopg -s /bin/bash -c "$PGBIN/initdb -D $DATA_DIR/data -U postgres --auth=trust -E UTF8 >/dev/null"
      else
        "$PGBIN/initdb" -D "$DATA_DIR/data" -U postgres --auth=trust -E UTF8 >/dev/null
      fi
    fi
    if [ "$(id -u)" = "0" ]; then
      su nexopg -s /bin/bash -c "$PGBIN/pg_ctl -D $DATA_DIR/data -o '-p $PORT -k /tmp' -l $DATA_DIR/pg.log -w start"
    else
      "$PGBIN/pg_ctl" -D "$DATA_DIR/data" -o "-p $PORT -k /tmp" -l "$DATA_DIR/pg.log" -w start
    fi
    echo "PostgreSQL en postgres://postgres@127.0.0.1:$PORT/postgres"
    ;;
  stop)
    if [ "$(id -u)" = "0" ]; then su nexopg -s /bin/bash -c "$PGBIN/pg_ctl -D $DATA_DIR/data -m fast stop"; else "$PGBIN/pg_ctl" -D "$DATA_DIR/data" -m fast stop; fi
    ;;
  *) echo "uso: $0 start|stop"; exit 1;;
esac
