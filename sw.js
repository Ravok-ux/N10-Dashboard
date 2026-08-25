// Service Worker — N-10 ERP
// Estrategia: Cache-first para assets estáticos, Network-first para datos dinámicos

const CACHE_NAME = 'n10-erp-v90';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/css/styles.css',
  '/js/app.js',
  '/js/auth.js',
  '/js/firebase-config.js',
  '/js/firebase-storage.js',
  '/js/dashboard.js',
  '/js/pedidos.js',
  '/js/cobranza.js',
  '/js/ingenieros.js',
  '/js/usuarios.js',
  '/js/compras.js',
  '/js/precios.js',
  '/js/reportes.js',
  '/js/comisiones.js',
  '/js/remisiones.js',
  '/js/intereses-engine.js',
  '/js/config-intereses.js',
  '/js/feed.js',
  '/js/mapa.js',
  '/js/mapa-clientes.js',
  '/js/asignaciones.js',
  '/js/geocercas.js',
  '/js/metas.js',
  '/js/autorizaciones.js',
  '/js/formularios.js',
  '/js/promociones.js',
  '/js/precios-segmento.js',
  '/js/productos-control.js',
  '/js/comentarios.js',
  '/js/preferencias.js',
  '/js/erp-cache.js',
  '/js/clientes.js',
  '/js/proveedores.js',
  '/js/excel-utils.js',
  '/js/kardex.js',
  '/js/cartera.js',
  '/js/visitas.js',
  '/js/cotizaciones-panel.js',
  '/js/devoluciones.js',
  '/js/notificaciones.js',
  '/js/fcm.js',
  '/js/juridico.js',
  '/js/observabilidad.js',
  '/js/mi-rh.js',
  '/js/chat.js',
  '/js/rh.js',
  '/js/auditoria.js',
  '/js/inventario.js',
  '/js/crm.js',
  '/js/caja.js',
  '/js/gastos.js',
  '/js/reabasto.js',
  '/js/logistica.js',
  '/js/reportes-custom.js',
  '/js/manuales.js',
  '/js/lib/xlsx.min.js',
  '/js/config.js',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg',
  '/manifest.json'
];

// Instalar — pre-cachear assets estáticos
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.allSettled(STATIC_ASSETS.map(url =>
        cache.add(url).catch(e => console.warn('[SW] No se pudo cachear:', url, e))
      ))
    ).then(() => self.skipWaiting())
  );
});

// Activar — limpiar caches viejos
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch — Cache-first para assets, Network-first para Firebase/APIs
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Firebase, googleapis, gstatic → siempre red (datos en tiempo real)
  if (url.hostname.includes('firebase') ||
      url.hostname.includes('googleapis') ||
      url.hostname.includes('gstatic') ||
      url.hostname.includes('firebaseapp')) {
    return; // fetch nativo sin interceptar
  }

  // Assets locales → cache-first con fallback a red
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response.ok && event.request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
    }).catch(() => {
      // Offline y no hay cache → devolver index.html para SPA
      if (event.request.mode === 'navigate') {
        return caches.match('/index.html');
      }
    })
  );
});