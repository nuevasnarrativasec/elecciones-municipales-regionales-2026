/**
 * Cloudflare Worker — sirve las fotos desde Backblaze B2 con caché en el edge.
 *
 * Por qué: B2 gratis solo da 1 GB de descarga/día. Al pasar por Cloudflare,
 * el egreso B2 -> Cloudflare es gratis (Bandwidth Alliance) y cada foto se
 * cachea en el edge, así casi nunca se vuelve a pedir a B2. Aguanta picos de
 * tráfico y NO necesita dominio propio: usa el subdominio *.workers.dev gratis.
 *
 * Ruta: https://elecciones-fotos.TU-SUBDOMINIO.workers.dev/fotos/<DNI>.jpg
 *
 * IMPORTANTE (caché de "no encontrado"):
 *   Solo se cachea largo cuando la imagen EXISTE (2xx). Los 404/errores NO se
 *   cachean, así una foto recién subida a B2 aparece de inmediato.
 *   Si subes una foto para un DNI que alguien ya consultó con la versión vieja
 *   del Worker (que cacheaba el 404 por 1 año), sube CACHE_BUST en 1 y redeploy
 *   para invalidar esas entradas viejas del edge.
 */
const CACHE_BUST = '2'; // súbelo (3, 4, …) solo si necesitas invalidar el edge

export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const url = new URL(request.url);
    const key = url.pathname.replace(/^\/+/, ''); // "fotos/12345678.jpg"
    if (!key) return new Response('Not found', { status: 404 });

    // 1) ¿Ya está en el caché del edge? (solo guardamos imágenes que existen)
    const cache = caches.default;
    const hit = await cache.match(request);
    if (hit) return hit;

    // 2) Traer de B2 (bucket público). El egreso B2 -> Cloudflare es gratis.
    //    El ?cb= cambia la clave de caché del subrequest: invalida los 404
    //    viejos que quedaron cacheados con la versión anterior del Worker.
    const origin = env.B2_PUBLIC_BASE.replace(/\/+$/, '') + '/' + key + '?cb=' + CACHE_BUST;
    const originResp = await fetch(origin, {
      cf: {
        cacheEverything: true,
        // cachea 1 año SOLO las respuestas OK; nunca los errores.
        cacheTtlByStatus: { '200-299': 31536000, '300-399': 0, '400-499': 0, '500-599': 0 }
      }
    });

    // 3) Reenviar con CORS abierto (las <img> cargan cross-origin).
    const resp = new Response(originResp.body, originResp);
    resp.headers.set('Access-Control-Allow-Origin', '*');
    resp.headers.delete('x-bz-file-id');
    resp.headers.delete('x-bz-file-name');

    if (originResp.ok) {
      // 4a) Imagen encontrada: caché larga + guardar en el edge.
      resp.headers.set('Cache-Control', 'public, max-age=31536000, immutable');
      ctx.waitUntil(cache.put(request, resp.clone()));
    } else {
      // 4b) No encontrado / error: NO cachear, para que reintente al subirla.
      resp.headers.set('Cache-Control', 'no-store');
    }
    return resp;
  }
};
