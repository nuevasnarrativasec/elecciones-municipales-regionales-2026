# Servir las fotos desde Cloudflare R2 (CDN)

Las fotos (`assets/fotos/`, ~92.000 archivos, 1,7 GB) son demasiadas para versionar en GitHub.
Se suben una sola vez a **Cloudflare R2** y se sirven por un **dominio propio** (no por la URL `r2.dev`,
que está limitada y no es para producción). Con dominio propio el egress es gratis y el edge de
Cloudflare cachea las imágenes, así que aguanta mucho tráfico sin bloqueos.

URL final de cada foto: `https://cdn.TU-DOMINIO.com/fotos/<DNI>.jpg`

---

## Estado actual (ya configurado)

- ✅ R2 activado en la cuenta (Account ID `8c9b6b663cde080d8426dfcab3ae44fa`).
- ✅ Bucket `elecciones-fotos` creado.
- ✅ Token `rclone-elecciones-fotos` (Object Read & Write, solo ese bucket) creado.
- ✅ **Public Development URL (r2.dev) activada — versión de prueba:**
  `https://pub-aca8777cd77a4e64892372dc0412c6ab.r2.dev`
  El sitio (`app.js` → `FOTOS`) ya apunta a `…r2.dev/fotos/`.
- ⏳ **Falta: subir las fotos** (paso 4) para que la URL las sirva.
- ⏳ Pendiente producción: conectar el dominio propio de `lapistaclave.com` (ver paso 5).

> La URL r2.dev es **rate-limited** (429 bajo carga): sirve para revisar, no para el
> lanzamiento. Para producción se conecta el dominio propio (paso 5) y se cambia `FOTOS`
> a `https://elecciones-municipales-regionales-2026.lapistaclave.com/fotos/`.

---

## 1. Crear el bucket

1. Panel de Cloudflare → **R2** → **Create bucket**.
2. Nombre: `elecciones-fotos` (o el que prefieras; si lo cambias, ajústalo en `subir-fotos-r2.sh`).
3. Región: Automatic.

## 2. Crear el token de API (para rclone)

1. R2 → **Manage R2 API Tokens** → **Create API token**.
2. Permiso: **Object Read & Write**, alcance: el bucket creado.
3. Copia **Access Key ID**, **Secret Access Key** y tu **Account ID**
   (el endpoint es `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`).

## 3. Configurar rclone

Instala rclone (https://rclone.org/downloads/) y añade este remote a tu `rclone.conf`
(`rclone config file` te dice dónde está):

```ini
[r2]
type = s3
provider = Cloudflare
access_key_id = TU_ACCESS_KEY_ID
secret_access_key = TU_SECRET_ACCESS_KEY
endpoint = https://8c9b6b663cde080d8426dfcab3ae44fa.r2.cloudflarestorage.com
region = auto
acl = private
```

> El bucket `elecciones-fotos` y el token `rclone-elecciones-fotos`
> (permiso *Object Read & Write*, solo ese bucket) ya están creados.
> Solo faltan tus llaves: cópialas de la pantalla del token en Cloudflare
> — **Access Key ID** → `access_key_id`, **Secret Access Key** → `secret_access_key`.
> Guarda este archivo donde indique `rclone config file` (normalmente
> `~/.config/rclone/rclone.conf`), **fuera del repositorio**.

## 4. Subir las fotos

Desde la raíz del proyecto:

```bash
./deploy/subir-fotos-r2.sh
```

Sube en paralelo (32 a la vez), reanuda si se corta y fija `Cache-Control: public,
max-age=31536000, immutable` en cada objeto. Tarda según tu conexión de subida.

## 5. Conectar el dominio propio (paso clave para producción)

> El dominio debe estar gestionado en Cloudflare (mismo panel).

1. R2 → tu bucket → **Settings** → **Public access** → **Custom Domains** → **Connect Domain**.
2. Ingresa `cdn.TU-DOMINIO.com`. Cloudflare crea el registro DNS y enruta por su CDN.
3. Espera a que quede **Active**.

No uses la opción "**r2.dev** subdomain" para el sitio: esa URL está *rate-limited* (429 bajo
carga) y es solo para pruebas.

## 6. (Recomendado) Regla de caché

R2 respeta el `Cache-Control` que subimos, pero puedes reforzarlo:
**Caching** → **Cache Rules** → nueva regla para el hostname `cdn.TU-DOMINIO.com`:
*Eligible for cache* + *Edge TTL: respetar el header de origen*. Así casi todas las vistas
se sirven desde el edge y ni tocan R2.

## 7. Apuntar el sitio al CDN

En `assets/js/app.js`, arriba, cambia la base de las fotos:

```js
// const FOTOS = 'https://cdn.TU-DOMINIO.com/fotos/';   // <- descomenta y pon tu dominio
const FOTOS = 'assets/fotos/';                           // <- comenta esta
```

Deja solo la línea de producción activa. Las fotos se llaman `<DNI>.jpg`, así que no hay que
tocar nada más. Los ~109 sin foto (declaraciones sin imagen) siguen mostrando iniciales.

---

## Costos (referencia 2026)

- **Egress: gratis**, sin importar el tráfico.
- **Almacenamiento**: 1,7 GB entra en los **10 GB gratis** (luego ~$0.015/GB-mes).
- **Lecturas (Class B)**: 10 millones/mes gratis, y **solo cuentan los cache miss**
  (los hits del edge no llegan a R2). Con caché larga, prácticamente gratis.

No hace falta CORS: las etiquetas `<img>` cargan cross-origin sin problema.
