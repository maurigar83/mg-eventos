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
    }
    if (lista && lista.generada) {
      const hora = new Date(lista.generada).toLocaleTimeString("es-CO", { hour: "numeric", minute: "2-digit" });
      partes.push("lista de " + Object.keys(lista.entradas).length.toLocaleString("es-CO") + " entradas (" + hora + ")");
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
        pase = { url: String(r.url).replace(/\/+$/, ""), firma: r.firma, expira: Number(r.expira) || 0 };
        guardarJson(sessionStorage, CLAVE_PASE, pase);
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
    pendientes.push({ h: huella, en: new Date().toISOString(), scanId: scanId });
    guardarJson(localStorage, CLAVE_COLA, pendientes);
    pintarEstado();
    return { ok: true, estado: "VALIDO", titulo: "TICKET VÁLIDO", nombre: "Serial " + serial,
      tipo: tipo, detalle: aviso, serial: serial, sinConexion: true };
  }

  async function subirCola() {
    const pendientes = cola();
    if (!pendientes.length || !activa() || !navigator.onLine) {
      return;
    }
    try {
      const r = await llamar("/api/sin-conexion", { lecturas: pendientes.slice(0, 200) });
      if (r && r.ok && Array.isArray(r.resultados)) {
        const subidos = {};
        r.resultados.forEach(function(x) {
          if (x.resultado !== "INVALIDO") {
            subidos[x.scanId] = true;
          }
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

  // --- API pública ---------------------------------------------------
  async function iniciar(apiGoogle, tokenSesion, callbackEstado) {
    apiGoogleGuardada = apiGoogle;
    tokenSesionGuardado = tokenSesion;
    alCambiarEstado = callbackEstado || alCambiarEstado;
    lista = leerJson(localStorage, CLAVE_LISTA, null);
    const guardado = leerJson(sessionStorage, CLAVE_PASE, null);
    if (guardado && guardado.expira > Date.now() + 60 * 60 * 1000) {
      pase = guardado;
    } else {
      await pedirPase(apiGoogle, tokenSesion);
    }
    pintarEstado();
    if (!activa()) {
      return false;
    }
    descargarLista();
    setInterval(descargarLista, INTERVALO_LISTA_MS);
    setInterval(subirCola, INTERVALO_COLA_MS);
    setInterval(revisarSenal, INTERVALO_REVISAR_SENAL_MS);
    window.addEventListener("online", function() {
      revisarSenal();
      subirCola();
      descargarLista();
      pintarEstado();
    });
    subirCola();
    return true;
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
          const r = await llamar(ruta, datos);
          if (r && r.estado && r.estado !== "ERROR") {
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
      try {
        const r = await Promise.race([
          pedirGoogle(cuerpo),
          new Promise(function(_, rechazar) { setTimeout(function() { rechazar(new Error("Google tardó demasiado")); }, TIEMPO_GOOGLE_MS); })
        ]);
        if (r && r.estado && r.estado !== "ERROR") {
          return r;
        }
      } catch (error) {
        console.log("Google tampoco respondió:", error);
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
    estado: function() { return estadoTexto; }
  };
})();
