// SERVICE WORKER DEL LECTOR (auditoría F-06, 14/11/2026)
//
// Para qué: si un portero cierra el lector o lo recarga sin internet, la
// página igual abre (con la sesión guardada del rol LECTOR y la lista del
// celular, ver lector.js y puerta.js).
//
// Reglas, para que nunca deje un celular pegado en una versión vieja:
// - Solo atiende pedidos GET del mismo sitio dentro de /lector/ (y los
//   archivos que esa página carga, como ../config.js). Google, Cloudflare
//   y todo lo de otros dominios pasa directo, sin tocarlo.
// - Siempre intenta internet primero. La copia guardada solo se usa si
//   no hay red o si la red tarda más de 5 s.
// - Cada vez que baja algo bien de internet, actualiza la copia.
//
// INTERRUPTOR DE APAGADO: si algún día hay que quitarlo, cambiar APAGADO
// a true y publicar. La próxima vez que cada celular abra el lector con
// internet, el service worker borra su copia, se da de baja y deja pasar
// todo directo a internet (la página queda como antes de este cambio).
// Para quitarlo del todo, después borrar también el registro al final de
// lector.js.
"use strict";

const APAGADO = false;
const CACHE = "mg-lector-v1";
const ESPERA_RED_MS = 5000;

self.addEventListener("install", function(evento) {
  self.skipWaiting();
  if (!APAGADO) {
    evento.waitUntil(precargar().catch(function(error) {
      console.log("Lector: no se pudo precargar la copia sin conexión:", error);
    }));
  }
});

self.addEventListener("activate", function(evento) {
  evento.waitUntil((async function() {
    const nombres = await caches.keys();
    await Promise.all(nombres.filter(function(n) {
      return APAGADO || (n.indexOf("mg-lector-") === 0 && n !== CACHE);
    }).map(function(n) { return caches.delete(n); }));
    if (APAGADO) {
      // Sin recargar las páginas: la que está abierta sigue funcionando
      // (este service worker ya no intercepta nada).
      await self.registration.unregister();
      return;
    }
    await self.clients.claim();
  })());
});

// Guarda la página del lector y todo lo que carga (scripts, estilos,
// librería), leyendo los src/href del HTML para no tener que repetir aquí
// los números de versión (?v=).
async function precargar() {
  const cache = await caches.open(CACHE);
  const base = self.registration.scope;
  const pagina = await fetch(base, { cache: "no-store" });
  if (!pagina.ok) {
    return;
  }
  const html = await pagina.clone().text();
  await cache.put(base, pagina);
  const rutas = [];
  const patron = /(?:src|href)="([^"]+)"/g;
  let m;
  while ((m = patron.exec(html)) !== null) {
    const url = new URL(m[1], base);
    if (url.origin === self.location.origin && rutas.indexOf(url.href) === -1) {
      rutas.push(url.href);
    }
  }
  await Promise.all(rutas.map(async function(ruta) {
    try {
      const r = await fetch(ruta, { cache: "no-store" });
      if (r.ok) {
        await cache.put(ruta, r);
      }
    } catch (error) {
      // Se guardará cuando la página lo pida con internet.
    }
  }));
}

// La página se guarda sin ?lector=1 ni otros parámetros.
function clave(pedido) {
  if (pedido.mode === "navigate") {
    const url = new URL(pedido.url);
    return url.origin + url.pathname;
  }
  return pedido.url;
}

self.addEventListener("fetch", function(evento) {
  const pedido = evento.request;
  if (APAGADO || pedido.method !== "GET" || new URL(pedido.url).origin !== self.location.origin) {
    return; // directo a internet, sin tocarlo
  }
  evento.respondWith(redPrimero(evento, pedido));
});

async function redPrimero(evento, pedido) {
  const cache = await caches.open(CACHE);
  const llave = clave(pedido);
  const desdeRed = fetch(pedido).then(function(respuesta) {
    if (respuesta && respuesta.ok && respuesta.type === "basic") {
      const copia = respuesta.clone();
      evento.waitUntil(cache.put(llave, copia).catch(function() {}));
    }
    return respuesta;
  });
  desdeRed.catch(function() {}); // el error se maneja abajo

  let reloj;
  const tiempo = new Promise(function(resolver) {
    reloj = setTimeout(function() { resolver(null); }, ESPERA_RED_MS);
  });

  try {
    const primera = await Promise.race([desdeRed, tiempo]);
    if (primera) {
      clearTimeout(reloj);
      return primera;
    }
    // La red tarda: si hay copia, se usa ya; si no, se sigue esperando.
    const guardada = await buscar(cache, pedido, llave);
    return guardada || await desdeRed;
  } catch (error) {
    clearTimeout(reloj);
    const guardada = await buscar(cache, pedido, llave);
    if (guardada) {
      return guardada;
    }
    throw error;
  }
}

async function buscar(cache, pedido, llave) {
  return (await cache.match(llave)) ||
    (pedido.mode === "navigate" ? await cache.match(self.registration.scope) : null) ||
    (await cache.match(llave, { ignoreSearch: true }));
}
