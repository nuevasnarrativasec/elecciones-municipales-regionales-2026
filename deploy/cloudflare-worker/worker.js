/**
 * Cloudflare Worker — sirve las fotos desde Backblaze B2 con caché en el edge.
 *
 * Por qué: B2 gratis solo da 1 GB de descarga/día. Al pasar por Cloudflare,
 * el egreso B2 -> Cloudflare es gratis (Bandwidth Alliance) y cada foto se
 * cachea en el edge, así casi nunca se vuelve a pedir a B2. Aguanta picos de
 * tráfico y NO necesita dominio propio: usa el subdominio *.workers.dev gratis.
 *
 * Ruta: https://elecciones-fotos.TU-SUBDOMINIO.workers.dev/fotos/<DNI>.jpg
 */
export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const url = new URL(request.url);
    const key = url.pathname.replace(/^\/+/, ''); // "fotos/12345678.jpg"
    if (!key) return new Response('Not found', { status: 404 });

    // 1) ¿Ya está en el caché del edge?
    const cache = caches.default;
    const hit = await cache.match(request);
    if (hit) return hit;

    // 2) Traer de B2 (bucket público). El egreso B2 -> Cloudflare es gratis.
    const origin = env.B2_PUBLIC_BASE.replace(/\/+$/, '') + '/' + key;
    const originResp = await fetch(origin, {
      cf: { cacheEverything: true, cacheTtl: 31536000 }
    });

    // 3) Reenviar con caché larga + CORS abierto (las <img> cargan cross-origin).
    const resp = new Response(originResp.body, originResp);
    resp.headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    resp.headers.set('Access-Control-Allow-Origin', '*');
    resp.headers.delete('x-bz-file-id');
    resp.headers.delete('x-bz-file-name');

    // 4) Guardar en el edge para las siguientes visitas.
    if (originResp.ok) ctx.waitUntil(cache.put(request, resp.clone()));
    return resp;
  }
};
