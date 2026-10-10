#!/bin/sh
# Выполняется один раз при создании базы.
# Приложение работает под обычной ролью elka, а не под суперпользователем:
# так защиту журнала движений (триггеры) нельзя отключить из приложения.
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<SQL
CREATE ROLE elka LOGIN PASSWORD '${ELKA_DB_PASSWORD}';
CREATE DATABASE elka OWNER elka;
SQL
