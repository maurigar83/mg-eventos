// Lector de QR (validacion-tickets). Paso 11: todo el código vive en
// archivos propios para poder usar una CSP estricta (sin scripts en línea).
"use strict";

const API_URL = CONFIG.BOLETAS_API_URL;
const SEGURIDAD_API_URL = CONFIG.SEGURIDAD_API_URL;
// En pruebas, config-pruebas.js trae su propia página de entrada.
const LOGIN_URL = CONFIG.LECTOR_LOGIN_URL || "https://mgeventos.co/";
const PANEL_URL = "https://mgeventos.co/panel.html";
const INTERVALO_REVALIDACION = 60 * 60 * 1000;
let scanner = null;
let procesando = false;
let audioContext = null;
let intervaloRevalidacion = null;

// Auditoría F-06 (14/11/2026): en los celulares de la puerta (rol LECTOR)
// la sesión se guarda también en localStorage hasta que vence (24 h), para
// que el lector vuelva a abrir si el portero cierra la pestaña o recarga,
// aun sin internet (con el service worker sw.js). Solo el rol LECTOR: su
// sesión solo sirve para leer QR; ADMIN y SUPERADMIN siguen solo en
// sessionStorage.
const CLAVE_SESION_LECTOR = "mg_lector_sesion_v1";
const CAMPOS_SESION = ["token", "usuario", "nombre", "rol", "permisos", "expira", "qr_token", "qr_validado"];

function sesionVencida(expira) {
  const ms = new Date(expira || "").getTime();
  return Number.isFinite(ms) && ms <= Date.now();
}

function esRolLector() {
  return (sessionStorage.getItem("mg_eventos_rol") || "").toUpperCase() === "LECTOR";
}

function guardarSesionLector() {
  try {
    if (!esRolLector()) {
      localStorage.removeItem(CLAVE_SESION_LECTOR);
      return;
    }
    const copia = {};
    CAMPOS_SESION.forEach(function(campo) {
      copia[campo] = sessionStorage.getItem("mg_eventos_" + campo) || "";
    });
    localStorage.setItem(CLAVE_SESION_LECTOR, JSON.stringify(copia));
  } catch (error) {
    console.log("No se pudo guardar la sesión del lector:", error);
  }
}

// Si la pestaña se cerró, trae la sesión guardada (si no ha vencido).
function recuperarSesionLector() {
  if (sessionStorage.getItem("mg_eventos_token")) {
    return;
  }
  try {
    const copia = JSON.parse(localStorage.getItem(CLAVE_SESION_LECTOR) || "null");
    if (!copia || !copia.token || String(copia.rol || "").toUpperCase() !== "LECTOR" || !copia.expira || sesionVencida(copia.expira)) {
      localStorage.removeItem(CLAVE_SESION_LECTOR);
      return;
    }
    CAMPOS_SESION.forEach(function(campo) {
      if (copia[campo]) {
        sessionStorage.setItem("mg_eventos_" + campo, copia[campo]);
      }
    });
  } catch (error) {
    console.log("No se pudo recuperar la sesión del lector:", error);
  }
}

// La sesión solo se da por perdida cuando el servidor lo dice (vencida,
// cerrada o revocada: todos esos mensajes hablan de la "sesión"). Un
// error pasajero de Google no saca al portero.
function respuestaSesionInvalida(datos) {
  if (!datos) {
    return false;
  }
  if (datos.ok) {
    return !datos.permisos || !datos.permisos.includes("LEER_QR");
  }
  return /sesi[oó]n/i.test(String(datos.mensaje || ""));
}

function permisosGuardadosIncluyenQR() {
  try {
    return JSON.parse(sessionStorage.getItem("mg_eventos_permisos") || "[]").includes("LEER_QR");
  } catch (error) {
    return false;
  }
}

function limpiarSesion() {
  try {
    localStorage.removeItem(CLAVE_SESION_LECTOR);
  } catch (error) {
    console.log(error);
  }
  if (typeof Puerta !== "undefined" && Puerta.olvidar) {
    Puerta.olvidar();
  }
  sessionStorage.removeItem("mg_eventos_token");
  sessionStorage.removeItem("mg_eventos_usuario");
  sessionStorage.removeItem("mg_eventos_nombre");
  sessionStorage.removeItem("mg_eventos_rol");
  sessionStorage.removeItem("mg_eventos_permisos");
  sessionStorage.removeItem("mg_eventos_expira");
  sessionStorage.removeItem("mg_eventos_qr_token");
  sessionStorage.removeItem("mg_eventos_qr_validado");
}

function guardarAccesoQR(token) {
  sessionStorage.setItem("mg_eventos_qr_token", token);
  sessionStorage.setItem("mg_eventos_qr_validado", Date.now().toString());
  guardarSesionLector();
}

function accesoQRCacheValido(token) {
  const tokenGuardado = sessionStorage.getItem("mg_eventos_qr_token") || "";
  const validado = Number(sessionStorage.getItem("mg_eventos_qr_validado") || "0");
  const expira = sessionStorage.getItem("mg_eventos_expira") || "";

  if (!tokenGuardado || tokenGuardado !== token || !validado) {
    return false;
  }

  if (expira) {
    const fechaExpira = new Date(expira).getTime();

    if (Number.isFinite(fechaExpira) && fechaExpira <= Date.now()) {
      return false;
    }
  }

  return true;
}

async function validarAcceso(revalidacion = false) {
  const mensaje = document.getElementById("mensaje");
  if (!revalidacion) {
    recuperarSesionLector();
  }
  const token = sessionStorage.getItem("mg_eventos_token") || "";

  if (token && sesionVencida(sessionStorage.getItem("mg_eventos_expira"))) {
    limpiarSesion();
    window.location.replace(LOGIN_URL);
    return false;
  }

  if (!token) {
    limpiarSesion();
    window.location.replace(LOGIN_URL);
    return false;
  }

  if (!revalidacion && accesoQRCacheValido(token)) {
    mensaje.innerText = "Acceso autorizado. Preparando lector...";
    return true;
  }

  if (!revalidacion) {
    mensaje.innerText = "Verificando sesión...";
  }

  try {
    const respuesta = await fetch(
      SEGURIDAD_API_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "text/plain;charset=utf-8"
        },
        body: JSON.stringify({
          accion: "sesion",
          token: token
        })
      }
    );

    const datos = await respuesta.json();

    if (respuestaSesionInvalida(datos)) {
      await manejarSesionInvalida();
      return false;
    }

    if (!datos.ok) {
      // Error pasajero de Google (no dijo que la sesión no sirve): se sigue
      // con lo que trajo el login y se revisa otra vez en la próxima hora.
      throw new Error(datos.mensaje || "Google no respondió bien");
    }

    sessionStorage.setItem("mg_eventos_usuario", datos.usuario || "");
    sessionStorage.setItem("mg_eventos_nombre", datos.nombre || "");
    sessionStorage.setItem("mg_eventos_rol", datos.rol || "");
    sessionStorage.setItem(
      "mg_eventos_permisos",
      JSON.stringify(datos.permisos || [])
    );

    if (datos.expira) {
      sessionStorage.setItem("mg_eventos_expira", datos.expira);
    }

    guardarAccesoQR(token);

    if (!revalidacion) {
      mensaje.innerText = "Acceso autorizado. Preparando lector...";
    }

    return true;
  } catch (error) {
    console.error("Error validando sesión:", error);

    // F-06: sin internet (o con Google fallando) no se borra la sesión.
    // Si el login dio permiso de leer QR, se sigue y se revisa más tarde;
    // el servidor igual rechaza cada lectura si la sesión no sirve.
    if (!revalidacion) {
      if (permisosGuardadosIncluyenQR()) {
        mensaje.innerText = "Sin internet para verificar la sesión. El lector sigue funcionando.";
        return true;
      }
      mensaje.innerText = "No fue posible verificar la sesión. Revisa el internet e intenta de nuevo.";
      return false;
    }

    return true;
  }
}

async function manejarSesionInvalida() {
  try {
    if (scanner) {
      await scanner.stop();
      scanner.clear();
      scanner = null;
    }
  } catch (error) {
    console.log("Error deteniendo lector:", error);
  }

  if (intervaloRevalidacion) {
    clearInterval(intervaloRevalidacion);
    intervaloRevalidacion = null;
  }

  limpiarSesion();
  window.location.replace(LOGIN_URL);
}

function iniciarRevalidacion() {
  if (intervaloRevalidacion) {
    clearInterval(intervaloRevalidacion);
  }

  intervaloRevalidacion = setInterval(
    async function() {
      console.log("Revalidando sesión...");
      await validarAcceso(true);
    },
    INTERVALO_REVALIDACION
  );
}

function volverAlPanel() {
  window.location.href = PANEL_URL;
}

window.addEventListener(
  "load",
  async function() {
    const accesoValido = await validarAcceso();

    if (!accesoValido) {
      return;
    }

    iniciarRevalidacion();
    // PUE-CF1: servidor rápido de la puerta (Cloudflare) con lista local
    // de respaldo. Si no está configurado, el lector sigue como antes.
    await Puerta.iniciar(
      SEGURIDAD_API_URL,
      sessionStorage.getItem("mg_eventos_token") || "",
      pintarEstadoPuerta,
      { persistir: esRolLector(), usuario: sessionStorage.getItem("mg_eventos_usuario") || "" }
    );
    document.getElementById("btnManual").classList.toggle("oculto", !esSuperadmin());
    actualizarConteo();
    setInterval(actualizarConteo, INTERVALO_CONTEO);

    const parametros = new URLSearchParams(
      window.location.search
    );

    if (parametros.get("lector") === "1") {
      setTimeout(
        function() {
          iniciarEscaner();
        },
        500
      );
    } else {
      document.getElementById("mensaje").innerText =
        "Presiona el botón para activar la cámara.";
    }
  }
);

// iPhone (iOS 17+): que el sonido se escuche aunque el interruptor
// de silencio esté activado.
try {
  if (navigator.audioSession) {
    navigator.audioSession.type = "playback";
  }
} catch (error) {}

function tono(frecuencia, inicio, duracion, forma, volumen) {
  const osc = audioContext.createOscillator();
  const gain = audioContext.createGain();
  const t = audioContext.currentTime + inicio;
  osc.type = forma;
  osc.frequency.value = frecuencia;
  gain.gain.setValueAtTime(0.001, t);
  gain.gain.exponentialRampToValueAtTime(volumen, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, t + duracion);
  osc.connect(gain);
  gain.connect(audioContext.destination);
  osc.start(t);
  osc.stop(t + duracion + 0.02);
}

// VÁLIDO: dos tonos agudos ascendentes. NO VÁLIDO: zumbido grave doble.
function sonidoResultado(valido) {
  try {
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioContext.state === "suspended") {
      audioContext.resume();
    }
    if (valido) {
      tono(988, 0, 0.12, "sine", 0.35);
      tono(1319, 0.13, 0.18, "sine", 0.35);
    } else {
      tono(180, 0, 0.28, "square", 0.25);
      tono(180, 0.36, 0.28, "square", 0.25);
    }
  } catch (error) {
    console.log("No se pudo reproducir el sonido:", error);
  }
}

function hacerBeep() {
  try {
    if (!audioContext) {
      audioContext = new (
        window.AudioContext ||
        window.webkitAudioContext
      )();
    }

    if (audioContext.state === "suspended") {
      audioContext.resume();
    }

    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.type = "sine";
    oscillator.frequency.value = 880;

    gainNode.gain.setValueAtTime(
      0.001,
      audioContext.currentTime
    );

    gainNode.gain.exponentialRampToValueAtTime(
      0.25,
      audioContext.currentTime + 0.01
    );

    gainNode.gain.exponentialRampToValueAtTime(
      0.001,
      audioContext.currentTime + 0.12
    );

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator.start();

    oscillator.stop(
      audioContext.currentTime + 0.12
    );
  } catch (error) {
    console.log(
      "No se pudo reproducir el sonido:",
      error
    );
  }
}

function generarScanId() {
  if (
    window.crypto &&
    typeof window.crypto.randomUUID === "function"
  ) {
    return window.crypto.randomUUID();
  }

  return (
    Date.now().toString(36) +
    "-" +
    Math.random().toString(36).substring(2) +
    "-" +
    Math.random().toString(36).substring(2)
  );
}

async function iniciarEscaner() {
  const mensaje = document.getElementById("mensaje");

  if (procesando) {
    return;
  }

  mensaje.innerText =
    "Solicitando acceso a la cámara...";

  try {
    const stream =
      await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: {
            ideal: "environment"
          }
        },
        audio: false
      });

    stream
      .getTracks()
      .forEach(track => track.stop());

    mensaje.innerText =
      "Inicializando cámara...";

    // Solo QR (no busca los demás formatos) y, donde el navegador lo
    // trae (Chrome en Android), el lector nativo BarcodeDetector, que
    // es más rápido que el decodificador en JavaScript. En iPhone no
    // existe y la librería usa el suyo como antes.
    scanner = new Html5Qrcode("reader", {
      formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
      experimentalFeatures: {
        useBarCodeDetectorIfSupported: true
      },
      verbose: false
    });

    const cameras =
      await Html5Qrcode.getCameras();

    if (!cameras || cameras.length === 0) {
      throw new Error(
        "No se encontraron cámaras."
      );
    }

    let cameraId = cameras[0].id;

    const camaraTrasera =
      cameras.find(
        camera =>
          /back|rear|environment|trasera/i.test(
            camera.label
          )
      );

    if (camaraTrasera) {
      cameraId = camaraTrasera.id;
    }

    await scanner.start(
      cameraId,
      {
        fps: 10,
        qrbox: {
          width: 250,
          height: 250
        }
      },
      codigo => {
        if (procesando) {
          return;
        }

        // Evita reprocesar el mismo QR mientras sigue frente a la cámara.
        if (codigo === ultimoCodigo && Date.now() - ultimoCodigoMs < 4000) {
          return;
        }

        procesando = true;
        ultimoCodigo = codigo;
        ultimoCodigoMs = Date.now();

        hacerBeep();
        mensaje.innerText = "Ticket detectado. Validando...";
        validarCodigo(codigo);
      },
      errorMessage => {
        // Los errores de búsqueda son normales mientras escanea.
      }
    );

    mensaje.innerText =
      "Cámara activa. Escanea el código QR.";
  } catch (error) {
    console.error(error);

    mensaje.innerText =
      "No fue posible activar la cámara.";
  }
}

let ultimoCodigo = "";
let ultimoCodigoMs = 0;
let temporizadorResultado = null;

// Valida el QR con la sesión del lector (acción "validar_qr").
// La cámara sigue encendida: no se recarga la página en cada persona.
async function validarCodigo(codigo) {
  await enviarValidacion({ accion: "validar_qr", codigo: codigo });
}

// Entrada manual (acción "validar_serial"): para cuando el QR no se
// deja leer. Solo para el SUPERADMIN (Mauricio lo gestiona en persona
// en el evento) y con la cédula
// completa del documento: el serial y los últimos 4 dígitos de la
// cédula salen impresos en la entrada, así que solos no prueban nada.
// El servidor compara la cédula con la del comprador.
// Solo esconde el botón; el servidor vuelve a exigir el rol.
function esSuperadmin() {
  return (sessionStorage.getItem("mg_eventos_rol") || "").toUpperCase() === "SUPERADMIN";
}

async function validarSerial(evento) {
  evento.preventDefault();
  const inputSerial = document.getElementById("inputSerial");
  const inputCedula = document.getElementById("inputCedula");
  const serial = inputSerial.value.trim();
  const cedula = inputCedula.value.replace(/\D/g, "");

  if (procesando) {
    return;
  }
  if (!serial) {
    inputSerial.focus();
    return;
  }
  if (cedula.length < 5) {
    inputCedula.focus();
    return;
  }

  procesando = true;
  inputSerial.blur();
  inputCedula.blur();
  document.getElementById("mensaje").innerText = "Validando serial...";
  const valido = await enviarValidacion({ accion: "validar_serial", serial: serial, cedula: cedula });

  // La cédula se borra siempre: no se deja un dato personal en pantalla.
  inputCedula.value = "";
  if (valido) {
    inputSerial.value = "";
  }
}

async function enviarValidacion(cuerpo) {
  const mensaje = document.getElementById("mensaje");
  let valido = false;

  try {
    cuerpo.token = sessionStorage.getItem("mg_eventos_token") || "";
    cuerpo.scanId = generarScanId();

    // X12: si el servidor está ocupado (varias puertas a la vez) o se
    // cae la conexión, se reintenta una vez sola antes de mostrar el
    // error. Va con el mismo scanId, así que si la primera alcanzó a
    // registrar el ingreso, el reintento responde VÁLIDO y no "YA UTILIZADO".
    let r = null;
    if (Puerta.activa()) {
      // Cloudflare → Apps Script → lista del celular (puerta.js).
      r = await Puerta.validar(cuerpo, pedirValidacion);
      if (!r) {
        throw new Error("Sin respuesta de ningún servidor y sin lista guardada.");
      }
    }
    for (let intento = 1; !r && intento <= 2; intento++) {
      try {
        r = await pedirValidacion(cuerpo);
        if (!(r && r.estado === "ERROR") || intento === 2) {
          break;
        }
      } catch (error) {
        if (intento === 2) {
          throw error;
        }
      }
      mensaje.innerText = "Validando de nuevo...";
      await esperar(800);
    }

    if (r && r.estado === "NO_AUTORIZADO") {
      await manejarSesionInvalida();
      return false;
    }

    valido = !!(r && r.estado === "VALIDO");
    mostrarResultado(r || {});
    if (valido) {
      sumarIngresoLocal();
    }
    mensaje.innerText = scanner
      ? "Cámara activa. Escanea el siguiente código QR."
      : "Listo. Escanea o escribe el siguiente serial.";
  } catch (error) {
    console.error("Error validando:", error);
    mostrarResultado({
      estado: "ERROR",
      titulo: "SIN CONEXIÓN",
      nombre: "No se pudo validar. Vuelve a escanear.",
      tipo: "",
      detalle: ""
    });
    ultimoCodigo = "";
  } finally {
    setTimeout(function() {
      procesando = false;
    }, 1200);
  }

  return valido;
}

async function pedirValidacion(cuerpo) {
  const respuesta = await fetch(SEGURIDAD_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=utf-8"
    },
    body: JSON.stringify(cuerpo)
  });
  return respuesta.json();
}

function esperar(ms) {
  return new Promise(function(resolver) {
    setTimeout(resolver, ms);
  });
}

// CONTADOR "Ingresaron X de Y": se pide al servidor cada 30 s (el
// servidor lo guarda 15 s en caché) y se suma 1 en el acto con cada
// ingreso válido de este celular, para que se vea moverse.
const INTERVALO_CONTEO = 30 * 1000;
let conteoActual = null;

function pintarConteo() {
  const caja = document.getElementById("conteo");
  if (!conteoActual) {
    caja.className = "oculto";
    return;
  }
  caja.className = "";
  caja.textContent = "Ingresaron " + conteoActual.ingresaron.toLocaleString("es-CO") +
    " de " + conteoActual.vendidas.toLocaleString("es-CO") + " entradas vendidas";
}

function sumarIngresoLocal() {
  if (conteoActual && conteoActual.ingresaron < conteoActual.vendidas) {
    conteoActual.ingresaron++;
    pintarConteo();
  }
}

async function actualizarConteo() {
  if (document.hidden) {
    return;
  }
  try {
    const rapido = await Puerta.conteo();
    if (rapido) {
      conteoActual = { ingresaron: Number(rapido.ingresaron) || 0, vendidas: Number(rapido.vendidas) || 0 };
      pintarConteo();
      return;
    }
    const respuesta = await fetch(SEGURIDAD_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8"
      },
      body: JSON.stringify({
        accion: "conteo_ingresos",
        token: sessionStorage.getItem("mg_eventos_token") || ""
      })
    });
    const r = await respuesta.json();
    if (r && r.ok) {
      conteoActual = { ingresaron: Number(r.ingresaron) || 0, vendidas: Number(r.vendidas) || 0 };
      pintarConteo();
    }
  } catch (error) {
    // Sin conexión: se deja el último número; el lector sigue igual.
    console.log("No se pudo actualizar el contador:", error);
  }
}

function pintarEstadoPuerta(texto) {
  const caja = document.getElementById("estadoPuerta");
  caja.textContent = texto || "";
  caja.className = texto ? (/SIN PUERTA RÁPIDA/.test(texto) ? "sin-puerta" : /SIN CONEXIÓN/.test(texto) ? "sin-conexion" : "") : "oculto";
}

function alternarManual() {
  const form = document.getElementById("formSerial");
  const abrir = form.classList.contains("oculto");
  form.classList.toggle("oculto", !abrir);
  if (abrir) {
    document.getElementById("inputSerial").focus();
  }
}

function mostrarResultado(r) {
  const caja = document.getElementById("resultado");
  const valido = r.estado === "VALIDO";
  const clase = valido ? "valido" : (r.estado === "USADO" ? "usado" : "error");

  caja.className = clase;
  document.getElementById("resultadoIcono").textContent = valido ? "✓" : "✕";
  document.getElementById("resultadoTitulo").textContent = r.titulo || "RESULTADO";
  document.getElementById("resultadoNombre").textContent = r.nombre || "";
  document.getElementById("resultadoTipo").textContent = r.tipo || "";
  document.getElementById("resultadoDetalle").textContent = r.detalle || "";

  // Sonido distinto según el resultado (funciona en iPhone y Android).
  sonidoResultado(valido);

  // Vibración: solo Android. Safari en iPhone no permite vibrar
  // desde una página web.
  try {
    if (navigator.vibrate) {
      navigator.vibrate(valido ? 150 : [300, 120, 300]);
    }
  } catch (error) {}

  if (temporizadorResultado) {
    clearTimeout(temporizadorResultado);
  }
  // Válido se cierra rápido para agilizar la fila; los errores duran más.
  temporizadorResultado = setTimeout(ocultarResultado, valido ? 2500 : 5000);
}

function ocultarResultado() {
  if (temporizadorResultado) {
    clearTimeout(temporizadorResultado);
    temporizadorResultado = null;
  }
  document.getElementById("resultado").className = "oculto";
}

async function detenerEscaner() {
  try {
    if (scanner) {
      await scanner.stop();
      scanner.clear();
      scanner = null;
      procesando = false;

      document.getElementById("mensaje").innerText =
        "Cámara detenida.";
    }
  } catch (error) {
    console.log(error);
  }
}

// Botones (antes eran onclick="..." en el HTML; la CSP los bloquearía).
document.getElementById("btnStart").addEventListener("click", iniciarEscaner);
document.getElementById("btnStop").addEventListener("click", detenerEscaner);
document.getElementById("btnPanel").addEventListener("click", volverAlPanel);
document.getElementById("resultado").addEventListener("click", ocultarResultado);
document.getElementById("btnManual").addEventListener("click", alternarManual);
document.getElementById("formSerial").addEventListener("submit", validarSerial);
document.addEventListener("visibilitychange", function() {
  if (!document.hidden) {
    actualizarConteo();
  }
});

// Auditoría F-06 (14/11/2026): service worker solo para /lector/. Con
// internet siempre trae la página fresca; sin internet abre la última
// copia guardada. Ver sw.js (y su interruptor de apagado).
if ("serviceWorker" in navigator) {
  window.addEventListener("load", function() {
    navigator.serviceWorker.register("sw.js", { scope: "./" }).catch(function(error) {
      console.log("No se pudo registrar el service worker:", error);
    });
  });
}
