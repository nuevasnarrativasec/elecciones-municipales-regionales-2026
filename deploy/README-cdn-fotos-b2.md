# Servir las fotos desde Backblaze B2 + Cloudflare Worker (gratis, sin dominio)

Las fotos (`assets/fotos/`, ~92.000 archivos, 1,7 GB) son demasiadas para GitHub
(el sitio publicado en GitHub Pages tiene un tope de 1 GB). Se suben **una sola vez**
a **Backblaze B2** y se sirven detrás de un **Cloudflare Worker** en un subdominio
gratuito `*.workers.dev`.

## Por qué así (y no Drive, ni R2, ni GitHub)

- **GitHub Pages**: tope de 1 GB por sitio -> no entra. Además 92k archivos hacen lento a git.
- **Google Drive**: rompe los hotlinks y limita el tráfico. No sirve para producción.
- **Cloudflare R2**: técnicamente ideal, pero exige registrar una tarjeta para activarse.
- **Backblaze B2**: 10 GB gratis **sin tarjeta**. Su límite es 1 GB de descarga/día...
  ...pero al ponerle Cloudflare delante, el egreso B2 -> Cloudflare es **gratis**
  (Bandwidth Alliance) y el Worker **cachea en el edge**, así ese tope casi nunca se toca.
  El Worker corre en `*.workers.dev` **sin dominio propio** y da 100.000 peticiones/día gratis.

Resultado: cada foto queda en `https://elecciones-fotos.TU-SUBDOMINIO.workers.dev/fotos/<DNI>.jpg`

---

## 1. Crear la cuenta y el bucket en Backblaze B2

1. Regístrate en https://www.backblaze.com/sign-up/cloud-storage (no pide tarjeta).
2. Panel -> **B2 Cloud Storage** -> **Buckets** -> **Create a Bucket**.
   - Nombre: `elecciones-fotos` (si lo cambias, ajústalo en `subir-fotos-b2.sh` y `wrangler.toml`).
   - **Files in Bucket are: Public** (necesario para que el Worker las lea).
3. Anota el **Endpoint** que aparece en el bucket, p. ej. `s3.us-west-004.backblazeb2.com`.
   La región (`us-west-004`) va en `wrangler.toml`.

## 2. Crear una App Key (para subir con rclone)

1. **Account** -> **Application Keys** -> **Add a New Application Key**.
2. Alcance: solo el bucket `elecciones-fotos`. Permiso: **Read and Write**.
3. Copia **keyID** y **applicationKey** (la key solo se muestra una vez).

## 3. Configurar rclone

Instala rclone (https://rclone.org/downloads/) y añade este remote a tu `rclone.conf`
(`rclone config file` te dice dónde está; guárdalo **fuera del repo**):

```ini
[b2]
type = b2
account = TU_keyID
key = TU_applicationKey
```

## 4. Subir las fotos

Desde la raíz del proyecto:

```bash
./deploy/subir-fotos-b2.sh
```

Sube en paralelo (32 a la vez), reanuda si se corta y fija
`Cache-Control: public, max-age=31536000, immutable` en cada objeto.
Tarda según tu velocidad de subida (1,7 GB en archivos chicos).

Verifica una foto directa de B2:
`https://s3.us-west-004.backblazeb2.com/elecciones-fotos/fotos/<DNI>.jpg`

## 5. Desplegar el Cloudflare Worker (el CDN gratis, sin dominio)

1. Crea una cuenta gratis en https://dash.cloudflare.com (no requiere tarjeta para Workers).
2. Edita `deploy/cloudflare-worker/wrangler.toml` y pon tu región/bucket reales en
   `B2_PUBLIC_BASE` (p. ej. `https://s3.us-west-004.backblazeb2.com/elecciones-fotos`).
3. Despliega:

```bash
cd deploy/cloudflare-worker
npx wrangler login      # solo la primera vez (abre el navegador)
npx wrangler deploy
```

Al terminar, wrangler te muestra la URL:
`https://elecciones-fotos.TU-SUBDOMINIO.workers.dev`
Prueba: `.../fotos/<DNI>.jpg` debe devolver la imagen.

## 6. Apuntar el sitio al Worker

En `assets/js/app.js` (arriba) ya está la línea; solo reemplaza `TU-SUBDOMINIO`:

```js
const FOTOS = 'https://elecciones-fotos.TU-SUBDOMINIO.workers.dev/fotos/';
// const FOTOS = 'assets/fotos/'; // <- para desarrollo local
```

Las fotos se llaman `<DNI>.jpg`, así que no hay que tocar nada más.
Los candidatos sin foto siguen mostrando sus iniciales (el `onerror` ya lo maneja).

## 7. Subir el resto del sitio a GitHub

El `.gitignore` ya excluye `assets/fotos/`. Commitea normal:

```bash
git add -A
git commit -m "CDN de fotos en B2 + Cloudflare Worker"
git push
```

---

## Límites y costos (referencia 2026, plan gratis)

- **Backblaze B2**: 10 GB de almacenamiento gratis (usamos 1,7 GB). 1 GB de descarga/día...
  ...pero casi todo el tráfico lo absorbe la caché de Cloudflare, así que a B2 casi
  no le llegan descargas. Sin tarjeta, sin cargos.
- **Cloudflare Workers (gratis)**: 100.000 peticiones/día. Con la caché del edge, la
  mayoría de vistas ni ejecutan mucho. Suficiente para el especial.
- **Egreso B2 -> Cloudflare**: gratis (Bandwidth Alliance). Egreso Cloudflare -> usuario: gratis.

## Si algún día consigues un dominio

Puedes conectar un dominio propio en Cloudflare y apuntar el Worker a
`fotos.tudominio.com` (Workers -> tu worker -> **Triggers** -> **Custom Domains**),
luego cambiar `FOTOS` a esa URL. No es necesario para lanzar.
