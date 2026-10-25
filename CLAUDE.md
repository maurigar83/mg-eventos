# Sitio MG Eventos (mgeventos.co) — contexto para Claude

Frontend estático (HTML, CSS y JS puros, sin build) publicado con GitHub Pages
en **https://mgeventos.co** (archivo `CNAME`). El backend es el repo hermano
`ticketera-apps-script` (Google Apps Script + Google Sheets); su `CLAUDE.md`
tiene el contexto completo del negocio, la protección de datos (Ley 1581) y el
flujo de deploy del backend. Dueño: Mauricio García Rivera, MG Eventos.

**⚠️ Importante:** varias conversaciones de Claude editan estos repos en
paralelo. En las sesiones en la nube no se commitea directo a `main`: se trabaja
en la rama `claude/...` de la sesión y se abre un PR para que Mauricio lo revise
y lo fusione. Al fusionar a `main`, GitHub Pages publica solo (no hay más pasos).

## Qué es cada cosa

- `config.js`: URL única de la API (la implementación de Apps Script que
  atiende login, panel, Ventas, Reportes, lector y webhook). Las tres claves
  apuntan a la misma URL; no crear otra implementación.
- Páginas públicas: `index.html` (inicio con intro animada y video),
  `eventos/` (cartelera) y `eventos/adviento/` (evento actual: Retiro de
  Adviento, 28/11/2026), `servicios/`, `contacto/`, `politica-privacidad.html`,
  `terminos-servicio.html`, `eliminacion-datos.html`. Política versión
  2026-10-24 (auditoría B1 y norma M2): dice "entradas", nombra Cloudflare
  Web Analytics y avisa que los enlaces de PDF por WhatsApp se cierran al
  día siguiente del evento; Eliminación de Datos pide la cédula. Si cambia
  un proveedor (por ejemplo Bold o Wompi al integrarse), actualizar la
  política y su versión.
- Páginas de operación (con sesión): `panel.html` (login y panel de gestión),
  `reportes.html` (consulta de ventas, compradores y reenvío de entradas;
  desde el 24/10/2026 la búsqueda pide 3 caracteres y muestra máximo 20,
  auditoría A4),
  `usuarios.html` (usuarios y roles), `activar.html` (enlace de un solo uso
  para definir la contraseña), `politica-password.js` (política de claves).
- `lector/`: lector de QR de la puerta (`mgeventos.co/lector`). Vive aquí porque
  la sesión se guarda por dominio. Librería html5-qrcode guardada en
  `lector/vendor/` y CSP estricta. El repo `validacion-tickets` solo redirige
  aquí. Desde el 23/10/2026 (preparación de la puerta, Plan MT8): usa el lector
  nativo del navegador (BarcodeDetector) donde existe y solo busca QR; botón
  "Admin: validar por serial" (solo visible para el rol SUPERADMIN) para
  validar a mano por serial o número más la cédula completa del documento,
  que el servidor compara con la del comprador (acción `validar_serial`;
  el serial y los últimos 4 dígitos de la cédula salen impresos en la
  entrada, así que solos no prueban nada), y contador "Ingresaron X de Y" (acción
  `conteo_ingresos`, cada 30 s). Si el servidor responde "NO FUE POSIBLE
  VALIDAR" o falla la red, el lector reintenta una vez con el mismo
  `scanId` antes de mostrar el error (X12, 23/10/2026). El backend de esas acciones está en
  `ticketera-apps-script/Codigo.js`. Al cambiar `lector.js`/`lector.css`,
  subir el `?v=` en `lector/index.html`.
- `assets/`: encabezado y pie compartidos (`mg-header.*`) e intro del eslogan
  (`intro-eslogan.*`).
- `images/` y `videos/`: flyers, pósters y videos del evento. El flyer vigente
  de Adviento es `flyer_adviento_v4.jpg` (y su versión de 600 px para
  tarjetas); los videos van en 720p con faststart para que carguen rápido.
- Cloudflare Web Analytics en el `<head>` de todas las páginas (sin cookies,
  decisión de Mauricio del 06/10/2026: no usar Google Analytics por Ley 1581),
  menos en `lector/`: su CSP estricta lo bloqueaba igual, así que se quitó el
  23/10/2026 (es una página interna, no aporta visitas).

## Dominio y correo (Cloudflare)

El dominio `mgeventos.co` está comprado y con DNS en Cloudflare (Cloudflare
Registrar). Revisión de la auditoría del 25/10/2026 (SEG-V2 del Plan):

- Todos los registros van en **"Solo DNS"** (nube gris). No activar el proxy
  (nube naranja) aunque Cloudflare lo sugiera: GitHub Pages dejaría de renovar
  el certificado HTTPS y los registros de Brevo dejarían de servir.
- GitHub Pages: dominio propio `mgeventos.co` con "Enforce HTTPS" activo.
- Correo: SPF `include:_spf.mx.cloudflare.net include:_spf.brevo.com ~all`,
  DKIM de Brevo (`brevo1`/`brevo2._domainkey`) y DMARC en **`p=quarantine`**
  (reportes a Brevo). Todo correo que salga como `@mgeventos.co` tiene que
  pasar por Brevo; si no, se va a spam. Gmail (mgeventos.co@gmail.com) envía
  como contacto@mgeventos.co por el SMTP de Brevo (la clave vence el
  24/10/2027 o a los 90 días sin uso; recordatorio en el Calendar de
  Mauricio). El correo que llega a contacto@ lo reenvía Cloudflare Email
  Routing a mgeventos.co@gmail.com.
- Brevo: seguimiento de correos transaccionales en modo **anónimo** (no asocia
  aperturas ni clics a cada comprador, Ley 1581).
- DNSSEC activado el 25/10/2026. Si algún día se cambia de registrador o de
  DNS, **desactivar DNSSEC antes** y esperar a que se quite el registro DS;
  apagarlo con el DS puesto tumba el sitio, el lector y el correo.

## Ambiente de pruebas

El repo `mg-eventos-pruebas` es una copia de este sitio para revisar cambios de
diseño antes de publicarlos: sin `CNAME`, oculto a buscadores y con la API
desactivada (`config.js` vacío), así que login, Ventas y lector no funcionan
allí a propósito. Flujo habitual: probar el cambio en `mg-eventos-pruebas`,
y cuando Mauricio lo aprueba, llevar el mismo cambio a este repo.

## Lenguaje de cara al cliente

Todo texto que lee el comprador dice **"entrada(s)"**, no "boleta(s)"
(decisión de Mauricio del 05/10/2026). El contacto público es
contacto@mgeventos.co.

## Trazabilidad

Regla de Mauricio (23/10/2026): todo cambio queda documentado en este archivo
(si cambia la estructura o una decisión) **y** en el Plan de auditoría
(Google Sheet "Plan_Auditoria_Ticketera_MG_Eventos", pestaña "Plan de trabajo",
id `1YnAFnOSULsJO4Ieg8fyX3opJRYzmvcshfinGDyAgmts`).

## Convenciones

- Todo en español: textos, comentarios y mensajes de commit (qué y por qué).
- Pensado primero para celular; probar el ancho de un teléfono antes de subir.
- Imágenes y videos optimizados para la web antes de subirlos.
- Nunca poner llaves, tokens ni datos personales en el código:
  lo que se sube aquí se publica tal cual en la web.
