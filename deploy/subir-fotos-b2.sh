#!/usr/bin/env bash
#
# Sube las fotos (assets/fotos/) a un bucket de Backblaze B2 con caché larga.
# Requiere rclone (https://rclone.org/downloads/) y un remote de B2 ya configurado.
# Guía paso a paso: deploy/README-cdn-fotos-b2.md
#
# Uso:
#   ./deploy/subir-fotos-b2.sh
#
# Ajusta estas tres variables si cambiaste los nombres:
REMOTE="b2"                 # nombre del remote de rclone (type = b2)
BUCKET="elecciones-fotos"   # nombre del bucket en Backblaze B2
PREFIX="fotos"              # carpeta dentro del bucket -> ruta final: .../fotos/<DNI>.jpg
# ------------------------------------------------------------------------------

set -euo pipefail
cd "$(dirname "$0")/.."   # raíz del proyecto

SRC="assets/fotos"
DEST="${REMOTE}:${BUCKET}/${PREFIX}"

echo "Subiendo ${SRC} -> ${DEST}"
echo "Archivos locales: $(find "$SRC" -name '*.jpg' | wc -l)"

rclone copy "$SRC" "$DEST" \
  --header-upload "Cache-Control: public, max-age=31536000, immutable" \
  --transfers 32 \
  --checkers 32 \
  --fast-list \
  --progress

echo "Listo."
echo "Prueba directa (B2 nativo): https://<TU-ENDPOINT-B2>/file/${BUCKET}/${PREFIX}/<DNI>.jpg"
echo "Prueba por el Worker:        https://elecciones-fotos.TU-SUBDOMINIO.workers.dev/${PREFIX}/<DNI>.jpg"

# Notas:
# - Es idempotente: reejecutar solo sube lo que falte o cambió (comparación por tamaño/fecha).
# - --header-upload fija Cache-Control para que el edge de Cloudflare cachee ~1 año
#   (las fotos por DNI no cambian nunca).
# - Para forzar re-subida de todo con nueva cabecera: agrega --ignore-times.
