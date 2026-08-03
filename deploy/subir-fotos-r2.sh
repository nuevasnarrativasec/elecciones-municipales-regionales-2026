#!/usr/bin/env bash
#
# Sube las fotos (assets/fotos/) a un bucket de Cloudflare R2 con caché larga.
# Requiere rclone (https://rclone.org/downloads/) y un remote de R2 ya configurado.
#
# Uso:
#   ./deploy/subir-fotos-r2.sh
#
# Ajusta estas dos variables:
REMOTE="r2"                 # nombre del remote de rclone (ver rclone.conf de la guía)
BUCKET="elecciones-fotos"   # nombre del bucket en R2
PREFIX="fotos"              # carpeta dentro del bucket -> URL final: .../fotos/<DNI>.jpg
# ------------------------------------------------------------------------------

set -euo pipefail
cd "$(dirname "$0")/.."   # raíz del proyecto

SRC="assets/fotos"
DEST="${REMOTE}:${BUCKET}/${PREFIX}"

echo "Subiendo ${SRC} -> ${DEST}"
echo "Archivos locales: $(find "$SRC" -name '*.jpg' | wc -l)"

rclone copy "$SRC" "$DEST" \
  --header-upload "Cache-Control: public, max-age=31536000, immutable" \
  --s3-no-check-bucket \
  --transfers 32 \
  --checkers 32 \
  --fast-list \
  --progress

echo "Listo. Verifica una foto en: https://cdn.TU-DOMINIO.com/${PREFIX}/<DNI>.jpg"

# Notas:
# - Es idempotente: reejecutar solo sube lo que falte o cambió (comparación por tamaño/fecha).
# - --header-upload fija Cache-Control en cada objeto para que el edge de Cloudflare
#   las cachee ~1 año (las fotos por DNI no cambian).
# - Para forzar re-subida con nueva cabecera: agrega --metadata-set no aplica a S3;
#   usa 'rclone copy ... --ignore-times' para reprocesar todo.
