// Lector de QR (validacion-tickets). Paso 11: todo el código vive en
// archivos propios para poder usar una CSP estricta (sin scripts en línea).
"use strict";

const API_URL = CONFIG.BOLETAS_API_URL;
const SEGURIDAD_API_URL = CONFIG.SEGURIDAD_API_URL;
const LOGIN_URL = "https://mgeventos.co/";
const PANEL_URL = "https://mgeventos.co/panel.html";
const INTERVALO_REVALIDACION = 60 * 60 * 1000;
let scanner = null;
let procesando = false;
let audioContext = null;
let intervaloRevalidacion = null;

function limpiarSesion() {
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
  const token = sessionStorage.getItem("mg_eventos_token") || "";

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

    if (
      !datos.ok ||
      !datos.permisos ||
      !datos.permisos.includes("LEER_QR")
    ) {
      await manejarSesionInvalida();
      return false;
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

    if (!revalidacion) {
      mensaje.innerText = "No fue posible verificar la sesión.";

      setTimeout(function() {
        limpiarSesion();
        window.location.replace(LOGIN_URL);
      }, 1500);

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

    scanner = new Html5Qrcode("reader");

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
  const mensaje = document.getElementById("mensaje");

  try {
    const respuesta = await fetch(SEGURIDAD_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8"
      },
      body: JSON.stringify({
        accion: "validar_qr",
        token: sessionStorage.getItem("mg_eventos_token") || "",
        codigo: codigo,
        scanId: generarScanId()
      })
    });

    const r = await respuesta.json();

    if (r && r.estado === "NO_AUTORIZADO") {
      await manejarSesionInvalida();
      return;
    }

    mostrarResultado(r || {});
    mensaje.innerText = "Cámara activa. Escanea el siguiente código QR.";
  } catch (error) {
    console.error("Error validando el QR:", error);
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
