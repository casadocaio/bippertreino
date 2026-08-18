// Bump esta versão sempre que index.html/manifest/ícones mudarem,
// para forçar os clientes a buscar os arquivos novos.
const CACHE_VERSION = "v2";
const CACHE_NAME = `bippertreino-${CACHE_VERSION}`;

const ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png",
  "./apple-touch-icon.png",
  "./favicon.png",
];

// Pré-armazena os arquivos essenciais assim que o SW é instalado.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Remove caches de versões antigas.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

// Estratégia stale-while-revalidate: responde do cache na hora (funciona
// offline) e, se houver rede, atualiza o cache em segundo plano.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached || caches.match("./index.html"));

      // Se está em cache, entrega na hora e atualiza em background.
      // Se não está, espera a rede (ou cai no fallback acima quando offline).
      return cached || networkFetch;
    })
  );
});
