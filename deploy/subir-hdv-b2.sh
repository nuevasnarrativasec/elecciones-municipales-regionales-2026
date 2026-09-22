#!/usr/bin/env bash
#
# Sube las hojas de vida en PDF (ya renombradas a <DNI>.pdf) al MISMO bucket
# de Backblaze B2 que ya usan las fotos ("elecciones-fotos"), bajo el prefijo
# "hdv/". El Worker de Cloudflare ya existente las sirve sin ningún cambio:
#   https://elecciones-fotos.TU-SUBDOMINIO.workers.dev/hdv/<DNI>.pdf
#
# Requiere el mismo remote de rclone "b2" que ya configuraste para las fotos
# (ver deploy/README-cdn-fotos-b2.md). Si es una Mac nueva, instala rclone:
#   brew install rclone
# y agrega a tu rclone.conf (fuera del repo):
#   [b2]
#   type = b2
#   account = TU_keyID
#   key = TU_applicationKey
#
# Uso:
#   ./deploy/subir-hdv-b2.sh /ruta/a/PDFHV/_HDV_FLAT
#
REMOTE="b2"
BUCKET="elecciones-fotos"
PREFIX="hdv"
# ------------------------------------------------------------------------------

set -euo pipefail

SRC="${1:-}"
if [ -z "$SRC" ]; then
  echo "Uso: $0 /ruta/a/PDFHV/_HDV_FLAT"
  exit 1
fi
if [ ! -d "$SRC" ]; then
  echo "No existe la carpeta: $SRC"
  exit 1
fi

DEST="${REMOTE}:${BUCKET}/${PREFIX}"

echo "Subiendo ${SRC} -> ${DEST}"
echo "Archivos locales: $(find "$SRC" -name '*.pdf' | wc -l)"

rclone copy "$SRC" "$DEST" \
  --header-upload "Cache-Control: public, max-age=31536000, immutable" \
  --header-upload "Content-Type: application/pdf" \
  --transfers 16 \
  --checkers 16 \
  --fast-list \
  --progress

echo "Listo."
echo "Prueba directa (B2 nativo): https://<TU-ENDPOINT-B2>/file/${BUCKET}/${PREFIX}/<DNI>.pdf"
echo "Prueba por el Worker:        https://elecciones-fotos.TU-SUBDOMINIO.workers.dev/${PREFIX}/<DNI>.pdf"

# Notas:
# - Es idempotente: reejecutar solo sube lo que falte o cambió.
# - Reutiliza el mismo bucket y el mismo Worker que las fotos: no hay que
#   crear ni desplegar nada nuevo en Cloudflare ni en Backblaze.
# - Costo: ~13 GB adicionales en un bucket que ya usa ~1.7 GB. El plan
#   gratuito de B2 cubre 10 GB; el excedente (~5 GB) cuesta centavos al mes
#   (~$6/TB/mes), pero Backblaze pedirá una tarjeta registrada para cobrar
#   ese excedente aunque sea mínimo.
