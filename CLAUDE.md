# Sitio MG Eventos (mgeventos.co) — contexto para Claude

Frontend estático (HTML, CSS y JS puros, sin build) publicado con GitHub Pages
en **https://mgeventos.co** (archivo `CNAME`). El backend es el repo hermano
`ticketera-apps-script` (Google Apps Script + Google Sheets).

**Este repo es público:** todo lo que se escribe aquí, incluido este archivo y
su historial, lo puede leer cualquiera. El contexto interno (negocio,
protección de datos, dominio y correo, ambiente de pruebas, historial de
decisiones, Plan de auditoría) está en el `CLAUDE.md` de
`ticketera-apps-script`, que es privado: leerlo antes de cambiar algo aquí.
No volver a poner en este archivo correos personales, ids de hojas o
carpetas, configuración de cuentas ni detalles de la operación.

**⚠️ Importante:** varias conversaciones de Claude editan estos repos en
paralelo. En las sesiones en la nube no se commitea directo a `main`: se trabaja
en la rama `claude/...` de la sesión y se abre un PR para revisión. Al fusionar
a `main`, GitHub Pages publica solo (no hay más pasos).

## Qué es cada cosa

- `config.js`: URL única de la API (la implementación de Apps Script). Las tres
  claves apuntan a la misma URL; no crear otra implementación.
- `_config.yml`: le dice a GitHub Pages que no publique este `CLAUDE.md`.
- Páginas públicas: `index.html` (inicio con intro animada y video),
  `eventos/` (cartelera), `eventos/adviento/` (evento actual; los videos de los
  sacerdotes están en la lista `SLIDES` al final del HTML), `servicios/`,
  `contacto/`, `politica-privacidad.html`, `terminos-servicio.html`,
  `eliminacion-datos.html`. Si cambia un proveedor que trata datos, actualizar
  la política y su versión.
- Páginas de operación (con sesión): `panel.html` (login y panel),
  `reportes.html` (ventas, compradores, reenvío de entradas, "Ventas por
  fecha", almuerzos; escribir «cortesías» en Buscar comprador las lista todas; `reportes.html#ventas` abre esa pestaña), `usuarios.html`
  (usuarios y roles), `activar.html` (enlace de un solo uso para definir la
  contraseña), `politica-password.js` (política de claves).
- `lector/`: lector de QR de la puerta (`mgeventos.co/lector`). Vive aquí porque
  la sesión se guarda por dominio. Librería html5-qrcode guardada en
  `lector/vendor/` y CSP estricta. `lector/puerta.js` valida en el Worker de
  Cloudflare con respaldo en Apps Script y en una lista guardada en el
  celular; la franja `#estadoPuerta` dice qué capa está activa. Reglas:
  - Al cambiar `lector.js`, `puerta.js` o `lector.css`, subir su `?v=` en
    `lector/index.html`.
  - La CSP solo deja conectar a Google y a la dirección exacta del Worker: si
    cambia, cambiarla en `lector/index.html`.
  - Los archivos `config-pruebas.js` y `entrar.*` del repo de pruebas no se
    copian aquí.
- `envivo/`: página de la transmisión en vivo (`mgeventos.co/envivo`) para
  quien compró una entrada virtual: pide el código personal (o lo trae el QR
  con `?c=`), habla con el Worker de la transmisión (`config-envivo.js`) y
  muestra el video firmado de Cloudflare Stream. Reglas:
  - Copia exacta de `mg-eventos-pruebas/envivo/`: los cambios se prueban
    allá primero.
  - hls.js **completo** en `vendor/` (el *light* no lee la pista de audio
    aparte de Stream). La firma solo se renueva en las listas `.m3u8`.
  - CSP estricta y sin analítica. Al cambiar `envivo.js` o `envivo.css`,
    subir su `?v=` en `envivo/index.html`; si cambia la dirección del
    Worker, cambiarla en `config-envivo.js` y en la CSP.
  - `envivo/panel/`: panel de quien transmite (señal, pregunta del
    momento y resultados; solo SUPERADMIN). Carga `../../config.js`; en
    pruebas, `../../lector/config-pruebas.js` (única diferencia con la
    copia de pruebas).
- `adviento/almuerzo/`: destino del botón "Pedir mi almuerzo" de la plantilla
  de WhatsApp (Meta no acepta enlaces wa.me en los botones). La página
  redirige al chat de quien toma los pedidos. No cambiar la URL mientras la
  plantilla esté en uso; el número sí se puede cambiar aquí.
- `assets/`: encabezado y pie compartidos (`mg-header.*`) e intro del eslogan
  (`intro-eslogan.*`).
- `images/` y `videos/`: flyers, pósters y videos del evento. El flyer vigente
  de Adviento es `flyer_adviento_v4.jpg` (y su versión de 600 px).
  `flyer-almuerzo-adviento.jpg` es el encabezado de la plantilla de WhatsApp
  del almuerzo: Meta lo descarga de esta URL en cada envío, no renombrarlo ni
  borrarlo mientras la campaña esté activa. Videos en 720p con faststart.
- Cloudflare Web Analytics en el `<head>` de todas las páginas (sin cookies; no
  usar Google Analytics), menos en `lector/` y `envivo/`, cuyas CSP lo bloquean.

## Lenguaje de cara al cliente

Todo texto que lee el comprador dice **"entrada(s)"**, no "boleta(s)". El
contacto público es contacto@mgeventos.co.

## Trazabilidad

Todo cambio queda documentado en el `CLAUDE.md` de `ticketera-apps-script` (si
cambia la estructura o una decisión) y en el Plan de auditoría (el enlace está
en ese archivo). Aquí solo se actualiza lo técnico de la lista de arriba.

## Convenciones

- Todo en español: textos, comentarios y mensajes de commit (qué y por qué).
- Pensado primero para celular; probar el ancho de un teléfono antes de subir.
- Imágenes y videos optimizados para la web antes de subirlos.
- Nunca poner llaves, tokens ni datos personales en el código:
  lo que se sube aquí se publica tal cual en la web.
