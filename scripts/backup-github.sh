#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

# Este script se ejecutará desde cron una vez al día.
# Requiere que el proyecto sea un repositorio Git y que el remoto origin
# esté configurado con autenticación SSH.

git add database/efemerides.db

if git diff --cached --quiet; then
  echo "Sin cambios en la base de datos."
  exit 0
fi

git commit -m "Actualizar base de datos de efemérides"
git push origin main
