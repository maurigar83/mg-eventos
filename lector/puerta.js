// PUERTA EN CLOUDFLARE (PUE-CF1, 13/11/2026)
//
// Capas, en orden:
//  1. Cloudflare (Worker mg-eventos-puerta): valida en < 0,5 s.
//  2. Si Cloudflare no responde: Apps Script, como antes (validar_qr).
//  3. Si tampoco hay internet: la lista guardada en este celular
//     (solo huellas del QR, serial y tipo; sin nombres ni cédulas).
//     Los ingresos quedan en cola y se suben solos cuando vuelve la
//     señal; si otro celular ya había dejado entrar esa entrada,
//     Cloudflare lo marca como doble ingreso para revisarlo.
//     Desde la auditoría del 14/11/2026 (F-03 y F-04) la cola guarda el
//     token del QR leído (Cloudflare calcula la huella), sube de a 15 y
//     bota las lecturas de otro día o de más de 12 h, para que una cola
//     olvidada de un ensayo no marque entradas el día del evento.
//
// Desde la auditoría del 14/11/2026 (F-02 y F-07) el respaldo de Google
// le pregunta a Cloudflare antes de mirar la hoja (no hay doble ingreso
// entre las dos capas), y si Cloudflare dice NO ENCONTRADO o SIN
// COMPRADOR el lector le pregunta a Google antes de rechazar: la entrada
// pudo venderse o corregirse después de la última sincronización.
//
// Auditoría F-05 (14/11/2026): si el pase falla al abrir, se reintenta
// solo cada 20 s (y al volver el internet) en vez de dejar el celular
// todo el día por Google; la franja lo dice en rojo. El pase se renueva
// solo cuando le queda menos de 1 h. F-06: en los celulares de la puerta
// (rol LECTOR) el pase se guarda en localStorage con su vencimiento, para
// que sobreviva a cerrar la pestaña.
//
// El login sigue siendo el de Apps Script: con la sesión del lector se
// pide un pase firmado (acción "puerta_firma") que Cloudflare verifica.
// Si Apps Script responde SIN_PUERTA (no configurado), el lector
// funciona exactamente como antes.
"use strict";

const Puerta = (function() {
  const TIEMPO_CLOUDFLARE_MS = 3000;
  const TIEMPO_GOOGLE_MS = 6000;
  const INTERVALO_REVISAR_SENAL_MS = 10 * 1000;
  const INTERVALO_LISTA_MS = 5 * 60 * 1000;
  const INTERVALO_COLA_MS = 15 * 1000;
  const LOTE_COLA = 15;
  const VIGENCIA_COLA_MS = 12 * 60 * 60 * 1000;
  const LISTA_VIEJA_MS = 30 * 60 * 1000;
  const REINTENTO_PASE_MS = 20 * 1000;
  const RENOVAR_PASE_ANTES_MS = 60 * 60 * 1000;
  const INTERVALO_REVISAR_PASE_MS = 5 * 60 * 1000;
  const CLAVE_LISTA = "mg_puerta_lista_v1";
  const CLAVE_COLA = "mg_puerta_cola_v1";
  const CLAVE_PASE = "mg_puerta_pase_v1";

  let pase = null;          // { url, firma, expira }
  let lista = null;         // { generada, entradas: { huella: [serial, tipo, vendida, estadoValido, ingresado] } }
  // Cuando Cloudflare y Google fallan, el lector pasa a "sin conexión" y
  // valida al instante con la lista, sin esperar más tiempos de espera.
  // Cada 10 s revisa en segundo plano si Cloudflare volvió.
  let sinConexion = false;
  let estadoTexto = "";
  let alCambiarEstado = function() {};
  // F-06: almacén del pase. sessionStorage por defecto; localStorage solo
  // para el rol LECTOR (celulares de la puerta), lo decide lector.js.
  let almacenPase = sessionStorage;
  let usuarioPase = "";
  let arrancada = false;
  let reintentoPase = null;

  function leerJson(almacen, clave, porDefecto) {
    try {
      const texto = almacen.getItem(clave);
      return texto ? JSON.parse(texto) : porDefecto;
    } catch (error) {
      return porDefecto;
    }
  }

  function guardarJson(almacen, clave, valor) {
    try {
      almacen.setItem(clave, JSON.stringify(valor));
    } catch (error) {
      console.log("No se pudo guardar " + clave + ":", error);
    }
  }

  function cola() {
    return leerJson(localStorage, CLAVE_COLA, []);
  }

  // Fecha de Colombia (UTC-5 todo el año), para comparar días.
  function diaColombia(ms) {
    return new Date(ms - 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }

  // Lectura de la cola que todavía se puede subir: de hoy y de menos de
  // 12 h. Las demás (por ejemplo, de un ensayo) se botan sin subirlas.
  function vigente(c) {
    const ms = Date.parse(c && c.en);
    return !isNaN(ms) && Date.now() - ms < VIGENCIA_COLA_MS && diaColombia(ms) === diaColombia(Date.now());
  }

  function activa() {
    return !!(pase && pase.url && pase.firma && pase.expira > Date.now());
  }

  async function conTiempo(url, opciones, ms) {
    const control = new AbortController();
    const reloj = setTimeout(function() { control.abort(); }, ms);
    try {
      return await fetch(url, Object.assign({}, opciones, { signal: control.signal }));
    } finally {
      clearTimeout(reloj);
    }
  }

  async function sha256(texto) {
    const datos = new TextEncoder().encode(texto);
    const hash = await crypto.subtle.digest("SHA-256", datos);
    return Array.from(new Uint8Array(hash)).map(function(b) {
      return b.toString(16).padStart(2, "0");
    }).join("");
  }

  function avisar(texto) {
    estadoTexto = texto;
    alCambiarEstado(texto);
  }

  function pintarEstado() {
    const pendientes = cola().length;
    const partes = [];
    if (sinConexion) {
      partes.push("SIN CONEXIÓN · validando con la lista del celular");
    } else if (activa()) {
      partes.push("Servidor rápido activo");
    } else if (reintentoPase) {
      partes.push("SIN PUERTA RÁPIDA · reintentando (valida por Google)");
    }
    if (lista && lista.generada) {
      const generada = new Date(lista.generada);
      const cuando = generada.toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit" }) + " " +
        generada.toLocaleTimeString("es-CO", { hour: "numeric", minute: "2-digit" });
      const vieja = Date.now() - generada.getTime() > LISTA_VIEJA_MS;
      partes.push("lista de " + Object.keys(lista.entradas).length.toLocaleString("es-CO") + " entradas (" + cuando + ")" +
        (vieja ? " ⚠ LISTA DESACTUALIZADA: avisar a la mesa" : ""));
    }
    if (pendientes) {
      partes.push(pendientes + " ingreso(s) por subir");
    }
    avisar(partes.join(" · "));
  }

  // --- Pase firmado -------------------------------------------------
  async function pedirPase(apiGoogle, tokenSesion) {
    try {
      const respuesta = await conTiempo(apiGoogle, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ accion: "puerta_firma", token: tokenSesion })
      }, TIEMPO_GOOGLE_MS * 2);
      const r = await respuesta.json();
      if (r && r.ok && r.url && r.firma) {
        pase = { url: String(r.url).replace(/\/+$/, ""), firma: r.firma, expira: Number(r.expira) || 0, usuario: usuarioPase };
        guardarJson(almacenPase, CLAVE_PASE, pase);
        return true;
      }
    } catch (error) {
      console.log("No se pudo pedir el pase de la puerta:", error);
    }
    return false;
  }

  async function llamar(ruta, cuerpo) {
    const respuesta = await conTiempo(pase.url + ruta, {
      method: cuerpo ? "POST" : "GET",
      headers: { "Authorization": "Bearer " + pase.firma, "Content-Type": "application/json" },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined
    }, TIEMPO_CLOUDFLARE_MS);
    if (respuesta.status === 401) {
      const error = new Error("Pase vencido");
      error.pase = true;
      throw error;
    }
    if (respuesta.status >= 500) {
      throw new Error("Cloudflare respondió " + respuesta.status);
    }
    return respuesta.json();
  }

  // --- Lista local --------------------------------------------------
  async function descargarLista() {
    if (!activa()) {
      return;
    }
    try {
      const respuesta = await conTiempo(pase.url + "/api/lista", {
        headers: { "Authorization": "Bearer " + pase.firma }
      }, 20000);
      if (!respuesta.ok) {
        return;
      }
      const r = await respuesta.json();
      if (!r || !r.ok || !Array.isArray(r.entradas)) {
        return;
      }
      const entradas = {};
      r.entradas.forEach(function(e) {
        entradas[e[0]] = [e[1], e[2], e[3], e[4], e[5]];
      });
      // Lo que este celular dejó entrar sin conexión y aún no sube
      // sigue marcado como usado.
      cola().forEach(function(c) {
        if (entradas[c.h]) {
          entradas[c.h][4] = 1;
        }
      });
      lista = { generada: r.generada, entradas: entradas };
      guardarJson(localStorage, CLAVE_LISTA, lista);
      pintarEstado();
    } catch (error) {
      console.log("No se pudo actualizar la lista de la puerta:", error);
    }
  }

  function marcarEnLista(huella) {
    if (lista && lista.entradas[huella]) {
      lista.entradas[huella][4] = 1;
      guardarJson(localStorage, CLAVE_LISTA, lista);
    }
  }

  async function validarConLista(codigo, scanId) {
    const token = String(codigo || "").trim().toLowerCase();
    if (!/^[a-f0-9]{32}$/.test(token)) {
      return { ok: false, estado: "INVALIDO", titulo: "CÓDIGO INVÁLIDO",
        nombre: "El código QR no tiene un token válido.", tipo: "", detalle: "" };
    }
    if (!lista) {
      return { ok: false, estado: "ERROR", titulo: "SIN CONEXIÓN",
        nombre: "No hay lista guardada en este celular. Usa la lista impresa.", tipo: "", detalle: "" };
    }
    const huella = await sha256(token);
    const e = lista.entradas[huella];
    const aviso = "Sin conexión: validado con la lista del celular.";
    if (!e) {
      return { ok: false, estado: "NO_ENCONTRADO", titulo: "TICKET NO ENCONTRADO",
        nombre: "No está en la lista guardada.", tipo: "", detalle: aviso };
    }
    const serial = e[0];
    const tipo = e[1];
    if (!e[2]) {
      return { ok: false, estado: "NO_VENDIDO", titulo: "ENTRADA SIN COMPRADOR",
        nombre: "Esta entrada no está vendida.", tipo: tipo, detalle: "Serial " + serial, serial: serial };
    }
    if (e[4]) {
      return { ok: false, estado: "USADO", titulo: "TICKET YA UTILIZADO",
        nombre: "Serial " + serial, tipo: tipo, detalle: aviso, serial: serial };
    }
    if (!e[3]) {
      return { ok: false, estado: "ESTADO_NO_VALIDO", titulo: "ESTADO NO VÁLIDO",
        nombre: "Serial " + serial, tipo: tipo, detalle: "Este ticket no tiene un estado de ingreso válido.", serial: serial };
    }
    marcarEnLista(huella);
    const pendientes = cola();
    // t = token leído (lo que sube a Cloudflare); h = huella, solo para
    // marcarla en la lista de este celular.
    pendientes.push({ t: token, h: huella, en: new Date().toISOString(), scanId: scanId });
    guardarJson(localStorage, CLAVE_COLA, pendientes);
    pintarEstado();
    return { ok: true, estado: "VALIDO", titulo: "TICKET VÁLIDO", nombre: "Serial " + serial,
      tipo: tipo, detalle: aviso, serial: serial, sinConexion: true };
  }

  async function subirCola() {
    const todas = cola();
    const pendientes = todas.filter(vigente);
    if (pendientes.length !== todas.length) {
      console.log("Se descartaron " + (todas.length - pendientes.length) + " lectura(s) sin conexión de otro día o de más de 12 h.");
      guardarJson(localStorage, CLAVE_COLA, pendientes);
      pintarEstado();
    }
    if (!pendientes.length || !activa() || !navigator.onLine) {
      return;
    }
    try {
      const lote = pendientes.slice(0, LOTE_COLA).map(function(c) {
        // Las lecturas guardadas por la versión anterior solo traen h.
        return c.t ? { t: c.t, en: c.en, scanId: c.scanId } : { h: c.h, en: c.en, scanId: c.scanId };
      });
      const r = await llamar("/api/sin-conexion", { lecturas: lote });
      if (r && r.ok && Array.isArray(r.resultados)) {
        // Toda lectura con respuesta ya quedó decidida en Cloudflare
        // (subida, doble, vencida o inválida): se saca de la cola.
        const subidos = {};
        r.resultados.forEach(function(x) {
          subidos[x.scanId] = true;
        });
        guardarJson(localStorage, CLAVE_COLA, cola().filter(function(c) { return !subidos[c.scanId]; }));
        pintarEstado();
      }
    } catch (error) {
      if (error.pase) {
        await renovarPase();
      }
    }
  }

  // --- Renovación del pase -------------------------------------------
  let apiGoogleGuardada = "";
  let tokenSesionGuardado = "";

  async function renovarPase() {
    return pedirPase(apiGoogleGuardada, tokenSesionGuardado);
  }

  // F-05: sin pase, reintentar cada 20 s hasta tenerlo; con pase, se
  // arranca la parte rápida (lista, cola y revisión de señal).
  async function intentarPase() {
    if (activa()) {
      return true;
    }
    const ok = await renovarPase();
    if (ok) {
      if (reintentoPase) {
        clearInterval(reintentoPase);
        reintentoPase = null;
      }
      arrancar();
    } else if (!reintentoPase) {
      reintentoPase = setInterval(intentarPase, REINTENTO_PASE_MS);
    }
    pintarEstado();
    return ok;
  }

  // Renueva el pase cuando le queda menos de 1 h (dura 16 h).
  async function revisarPase() {
    if (activa() && pase.expira - Date.now() < RENOVAR_PASE_ANTES_MS && navigator.onLine) {
      await renovarPase();
      pintarEstado();
    }
  }

  function arrancar() {
    if (arrancada) {
      return;
    }
    arrancada = true;
    descargarLista();
    setInterval(descargarLista, INTERVALO_LISTA_MS);
    setInterval(subirCola, INTERVALO_COLA_MS);
    setInterval(revisarSenal, INTERVALO_REVISAR_SENAL_MS);
    setInterval(revisarPase, INTERVALO_REVISAR_PASE_MS);
    subirCola();
  }

  // --- API pública ---------------------------------------------------
  // opciones.persistir (F-06): guardar el pase en localStorage (rol LECTOR).
  // opciones.usuario: el pase guardado solo sirve para ese usuario.
  async function iniciar(apiGoogle, tokenSesion, callbackEstado, opciones) {
    opciones = opciones || {};
    apiGoogleGuardada = apiGoogle;
    tokenSesionGuardado = tokenSesion;
    alCambiarEstado = callbackEstado || alCambiarEstado;
    usuarioPase = String(opciones.usuario || "");
    almacenPase = opciones.persistir ? localStorage : sessionStorage;
    if (!opciones.persistir) {
      try { localStorage.removeItem(CLAVE_PASE); } catch (error) { /* nada */ }
    }
    lista = leerJson(localStorage, CLAVE_LISTA, null);
    const guardado = leerJson(almacenPase, CLAVE_PASE, null) || leerJson(sessionStorage, CLAVE_PASE, null);
    if (guardado && guardado.expira > Date.now() && (!guardado.usuario || guardado.usuario === usuarioPase)) {
      pase = guardado;
    }
    // Sin internet al abrir: la franja lo dice de una vez (antes solo
    // cambiaba con el primer escaneo).
    if (!navigator.onLine && lista) {
      sinConexion = true;
    }
    window.addEventListener("offline", function() {
      if (lista) {
        sinConexion = true;
        pintarEstado();
      }
    });
    window.addEventListener("online", function() {
      if (!activa()) {
        // Sin pase no hay revisión de señal: se vuelve a Google de una vez.
        sinConexion = false;
        intentarPase();
        return;
      }
      revisarSenal();
      subirCola();
      descargarLista();
      revisarPase();
      pintarEstado();
    });
    if (activa()) {
      arrancar();
      // Si le queda menos de 1 h, se renueva sin esperar.
      revisarPase();
    } else if (navigator.onLine) {
      await intentarPase();
    } else {
      // Sin internet y sin pase: se reintenta solo cuando vuelva la señal
      // (evento "online") y cada 20 s.
      reintentoPase = setInterval(intentarPase, REINTENTO_PASE_MS);
    }
    pintarEstado();
    return activa();
  }

  // Al cerrar sesión: el pase guardado no debe quedar en el celular.
  function olvidar() {
    pase = null;
    try { localStorage.removeItem(CLAVE_PASE); } catch (error) { /* nada */ }
    try { sessionStorage.removeItem(CLAVE_PASE); } catch (error) { /* nada */ }
  }

  async function revisarSenal() {
    if (!sinConexion || !activa() || !navigator.onLine) {
      return;
    }
    try {
      const respuesta = await conTiempo(pase.url + "/api/salud", {}, 2500);
      if (respuesta.ok) {
        sinConexion = false;
        pintarEstado();
        subirCola();
      }
    } catch (error) {
      // Sigue sin señal.
    }
  }

  // Devuelve la respuesta en el mismo formato de Apps Script.
  // pedirGoogle(cuerpo) es la función de siempre (lector.js).
  // Google con tiempo máximo; null si no responde o responde ERROR.
  async function preguntarGoogle(pedirGoogle, cuerpo) {
    try {
      const r = await Promise.race([
        pedirGoogle(cuerpo),
        new Promise(function(_, rechazar) { setTimeout(function() { rechazar(new Error("Google tardó demasiado")); }, TIEMPO_GOOGLE_MS); })
      ]);
      if (r && r.estado && r.estado !== "ERROR") {
        return r;
      }
    } catch (error) {
      console.log("Google no respondió:", error);
    }
    return null;
  }

  async function validar(cuerpo, pedirGoogle) {
    const esQr = cuerpo.accion === "validar_qr";

    if (!navigator.onLine && lista) {
      sinConexion = true;
    }

    if (activa() && !sinConexion) {
      const ruta = esQr ? "/api/validar" : "/api/serial";
      const datos = esQr
        ? { codigo: cuerpo.codigo, scanId: cuerpo.scanId }
        : { serial: cuerpo.serial, cedula: cuerpo.cedula, scanId: cuerpo.scanId };
      for (let intento = 1; intento <= 2; intento++) {
        try {
          let r = await llamar(ruta, datos);
          if (r && r.estado && r.estado !== "ERROR") {
            // F-07: Cloudflare solo sabe lo que trajo la última
            // sincronización; antes de rechazar, la hoja decide.
            if (esQr && (r.estado === "NO_ENCONTRADO" || r.estado === "NO_VENDIDO")) {
              r = (await preguntarGoogle(pedirGoogle, cuerpo)) || r;
            }
            if (esQr && (r.estado === "VALIDO" || r.estado === "USADO") && lista) {
              sha256(String(cuerpo.codigo).trim().toLowerCase()).then(marcarEnLista);
            }
            return r;
          }
        } catch (error) {
          if (error.pase && intento === 1 && await renovarPase()) {
            continue;
          }
        }
        break;
      }
    }

    // Respaldo: Apps Script, como antes.
    if (!sinConexion) {
      const r = await preguntarGoogle(pedirGoogle, cuerpo);
      if (r) {
        return r;
      }
    }

    // Sin internet: lista del celular (solo para QR; el serial necesita
    // comparar la cédula en el servidor).
    if (!lista) {
      return null;
    }
    sinConexion = true;
    pintarEstado();
    if (!esQr) {
      return { ok: false, estado: "ERROR", titulo: "SIN CONEXIÓN",
        nombre: "La validación por serial necesita internet. Usa la lista impresa.", tipo: "", detalle: "" };
    }
    return validarConLista(cuerpo.codigo, cuerpo.scanId);
  }

  async function conteo() {
    if (!activa()) {
      return null;
    }
    try {
      const r = await llamar("/api/conteo");
      return r && r.ok ? r : null;
    } catch (error) {
      return null;
    }
  }

  return {
    iniciar: iniciar,
    validar: validar,
    conteo: conteo,
    activa: activa,
    olvidar: olvidar,
    estado: function() { return estadoTexto; }
  };
})();
