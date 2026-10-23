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
  `terminos-servicio.html`, `eliminacion-datos.html`.
- Páginas de operación (con sesión): `panel.html` (login y panel de gestión),
  `reportes.html` (consulta de ventas, compradores y reenvío de entradas),
  `usuarios.html` (usuarios y roles), `activar.html` (enlace de un solo uso
  para definir la contraseña), `politica-password.js` (política de claves).
- `lector/`: lector de QR de la puerta (`mgeventos.co/lector`). Vive aquí porque
  la sesión se guarda por dominio. Librería html5-qrcode guardada en
  `lector/vendor/` y CSP estricta. El repo `validacion-tickets` solo redirige
  aquí.
- `assets/`: encabezado y pie compartidos (`mg-header.*`) e intro del eslogan
  (`intro-eslogan.*`).
- `images/` y `videos/`: flyers, pósters y videos del evento. El flyer vigente
  de Adviento es `flyer_adviento_v4.jpg` (y su versión de 600 px para
  tarjetas); los videos van en 720p con faststart para que carguen rápido.
- Cloudflare Web Analytics en el `<head>` de todas las páginas (sin cookies,
  decisión de Mauricio del 06/10/2026: no usar Google Analytics por Ley 1581).

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
