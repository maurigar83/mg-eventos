/* Transmisión en vivo · Retiro de Adviento (MG Eventos)
 *
 * Flujo (Plan de auditoría VIR-1, 18/11/2026):
 * 1. La persona escribe su código (o llega en el enlace ?c=...).
 * 2. POST /api/entrar: el Worker revisa el código, abre una sesión
 *    para este aparato y devuelve la dirección firmada del video.
 * 3. Cada 15 s, POST /api/latido: si el código se abrió en otro
 *    aparato, este se detiene (el último que entra gana). Si sigue
 *    siendo este, llega una dirección firmada nueva (vence en 10 min)
 *    y el reproductor la usa en las siguientes descargas sin cortar.
 *
 * Se guarda en el celular solo el código y la sesión (localStorage),
 * para volver a entrar sin escribirlo.
 */
(function () {
  "use strict";

  var API = String(window.ENVIVO_API || "").replace(/\/+$/, "");
  var CLAVE_CODIGO = "mg_envivo_codigo";
  var CLAVE_SESION = "mg_envivo_sesion";

  var $ = function (id) { return document.getElementById(id); };
  var pCodigo = $("pCodigo"), pVideo = $("pVideo"), pAviso = $("pAviso");
  var inputCodigo = $("inputCodigo"), btnEntrar = $("btnEntrar"), errorCodigo = $("errorCodigo");
  var video = $("video"), chip = $("chip"), conexion = $("conexion");
  var btnSonido = $("btnSonido");

  var estado = { codigo: "", sesion: "", token: "", base: "", modo: "", latido: 15 };
  var hls = null;
  var temporizadorLatido = null;
  var temporizadorReloj = null;
  var fallasSeguidas = 0;

  /* ---------- almacenamiento (puede fallar en modo privado) ---------- */
  function leer(clave) { try { return localStorage.getItem(clave) || ""; } catch (e) { return ""; } }
  function guardar(clave, valor) { try { localStorage.setItem(clave, valor); } catch (e) { /* sin memoria: igual funciona */ } }
  function borrar(clave) { try { localStorage.removeItem(clave); } catch (e) { /* nada */ } }

  /* ---------- utilidades ---------- */
  function normalizar(codigo) { return String(codigo || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }
  function bonito(codigo) {
    var c = normalizar(codigo);
    if (c.length === 11 && c.indexOf("ADV") === 0) return "ADV-" + c.slice(3, 7) + "-" + c.slice(7);
    return c;
  }
  function oculto(el, si) { el.classList.toggle("oculto", !!si); }
  function mostrar(panel) {
    [pCodigo, pVideo, pAviso].forEach(function (p) { oculto(p, p !== panel); });
    window.scrollTo(0, 0);
  }

  function llamar(ruta, cuerpo) {
    var controlador = ("AbortController" in window) ? new AbortController() : null;
    var espera = setTimeout(function () { if (controlador) controlador.abort(); }, 12000);
    return fetch(API + ruta, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
      signal: controlador ? controlador.signal : undefined,
      cache: "no-store"
    }).then(function (r) {
      return r.json().catch(function () { return { ok: false, estado: "ERROR", mensaje: "Respuesta no válida." }; });
    }).finally(function () { clearTimeout(espera); });
  }

  /* ---------- 1. entrar ---------- */
  function entrar(codigo) {
    codigo = normalizar(codigo);
    if (codigo.length < 6) {
      errorCodigo.textContent = "Escribe el código completo, como aparece en tu entrada virtual.";
      oculto(errorCodigo, false);
      inputCodigo.focus();
      return;
    }
    oculto(errorCodigo, true);
    btnEntrar.disabled = true;
    btnEntrar.textContent = "Conectando…";
    llamar("/api/entrar", { codigo: codigo }).then(function (r) {
      if (r.ok) {
        estado.codigo = codigo;
        estado.sesion = r.sesion;
        guardar(CLAVE_CODIGO, codigo);
        guardar(CLAVE_SESION, r.sesion);
        empezar(r);
      } else if (r.estado === "NO_VALIDO" || r.estado === "ESPERA") {
        mostrar(pCodigo);
        errorCodigo.textContent = r.mensaje;
        oculto(errorCodigo, false);
      } else {
        guardar(CLAVE_CODIGO, codigo);
        estado.codigo = codigo;
        avisar(r);
      }
    }).catch(function () {
      mostrar(pCodigo);
      errorCodigo.textContent = "No pudimos conectar. Revisa tu internet e intenta de nuevo.";
      oculto(errorCodigo, false);
    }).finally(function () {
      btnEntrar.disabled = false;
      btnEntrar.innerHTML = "▶&nbsp; Ver transmisión";
    });
  }

  /* ---------- 2. reproducir ---------- */
  function partir(hlsUrl) {
    // https://customer-xxx.cloudflarestream.com/<token>/manifest/video.m3u8
    var m = /^(https:\/\/[^/]+)\/([^/]+)\//.exec(hlsUrl);
    return m ? { base: m[1], token: m[2] } : { base: "", token: "" };
  }

  function empezar(r) {
    var p = partir(r.video.hls);
    estado.base = p.base;
    estado.token = p.token;
    estado.reconectar = false;
    estado.modo = r.modo;
    estado.latido = r.latido || 15;
    pintarModo(r.modo);
    pintarEscenario(r.escenario);
    (r.respondidas || []).forEach(function (id) { respondidas[id] = true; });
    pintarPregunta(r.pregunta);
    pintarConexion(true);
    mostrar(pVideo);
    cargarVideo(r.video.hls);
    programarLatido();
  }

  function conFirmaNueva(u) {
    if (!estado.base || !estado.token || u.indexOf(estado.base + "/") !== 0) return u;
    var resto = u.slice(estado.base.length + 1);
    var primero = resto.split("/")[0];
    var ruta = resto.split("?")[0];
    var esFirma = /^eyJ[\w-]*\.[\w-]+\.[\w-]+$/.test(primero);
    if (!esFirma || !/\.m3u8$/.test(ruta)) return u;
    return estado.base + "/" + estado.token + resto.slice(primero.length);
  }

  function cargarVideo(url) {
    detenerVideo();
    if (window.Hls && window.Hls.isSupported()) {
      hls = new window.Hls({
        lowLatencyMode: false,
        // Si alguien se queda atrás (red lenta, volvió de otra app) más de
        // 10 pedazos, salta solo al momento en vivo (18/11/2026).
        liveSyncDurationCount: 3,
        liveMaxLatencyDurationCount: 10,
        // No baja más calidad de la que cabe en la pantalla: ahorra datos
        // en celular y deja más internet para que no se trabe.
        capLevelToPlayerSize: true,
        // Cada descarga usa la firma más reciente: así el video sigue
        // aunque la primera dirección ya haya vencido.
        // Solo las listas (.m3u8) llevan nuestra firma en la ruta; los
        // pedazos de video traen su propio permiso (?p=...) y no se tocan
        // (cambiarlos causaba "demasiadas redirecciones", 18/11/2026).
        xhrSetup: function (xhr, u) {
          xhr.open("GET", conFirmaNueva(u), true);
        }
      });
      hls.on(window.Hls.Events.ERROR, function (evento, datos) {
        if (!datos.fatal) return;
        if (datos.type === window.Hls.ErrorTypes.NETWORK_ERROR) {
          pintarConexion(false);
          setTimeout(function () { if (hls) hls.startLoad(); }, 3000);
        } else if (datos.type === window.Hls.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError();
        } else {
          latido(); // pide firma nueva y vuelve a cargar
        }
      });
      hls.on(window.Hls.Events.FRAG_LOADED, function () { pintarConexion(true); });
      hls.loadSource(url);
      hls.attachMedia(video);
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      // iPhone viejo sin MediaSource: reproductor nativo.
      video.src = url;
    } else {
      avisar({ estado: "ERROR", mensaje: "Este navegador no puede reproducir la transmisión. Prueba con Chrome o Safari actualizados." });
      return;
    }
    var intento = video.play();
    if (intento && intento.catch) {
      intento.catch(function () {
        // El navegador pide un toque antes de sonar: arranca en silencio.
        video.muted = true;
        video.play().catch(function () { /* el usuario toca play */ });
        oculto(btnSonido, false);
      });
    }
  }

  function detenerVideo() {
    if (hls) { try { hls.destroy(); } catch (e) { /* nada */ } hls = null; }
    try { video.pause(); video.removeAttribute("src"); video.load(); } catch (e) { /* nada */ }
  }

  btnSonido.addEventListener("click", function () {
    video.muted = false;
    video.play().catch(function () { /* nada */ });
    oculto(btnSonido, true);
  });

  function pintarModo(modo) {
    var grabacion = modo === "GRABACION";
    oculto($("comoLlega"), grabacion);
    if (grabacion) oculto($("graciasSenal"), true);
    pintarChip("", grabacion ? "Grabación" : "● En vivo");
    chip.classList.toggle("vivo", !grabacion);
  }

  function pintarConexion(bien) {
    conexion.classList.toggle("alerta", !bien);
    conexion.lastChild.textContent = bien
      ? "Conectado · código " + bonito(estado.codigo).replace(/^(ADV-)\w{4}/, "$1••••")
      : "Reconectando…";
  }

  function pintarEscenario(e) {
    var ahora = e && e.ahora ? e.ahora : "";
    var anteriores = e && e.anteriores ? e.anteriores : [];
    oculto($("escenario"), !ahora && !anteriores.length);
    $("ahora").textContent = ahora || "En unos minutos";
    pintarFoto(ahora);
    var lista = $("listaAntes");
    lista.textContent = "";
    anteriores.forEach(function (nombre) {
      var li = document.createElement("li");
      li.textContent = nombre;
      lista.appendChild(li);
    });
    oculto($("antes"), !anteriores.length);
  }

  // Foto del sacerdote que está en el escenario: se busca por el apellido
  // en el texto que se escoge en el menú de la hoja.
  var FOTOS = [
    { clave: "bustamante", foto: "img/sacerdote-freddy.jpg" },
    { clave: "montoya", foto: "img/sacerdote-montoya.jpg" },
    { clave: "zapata", foto: "img/sacerdote-zapata.jpg" },
    { clave: "lopera", foto: "img/sacerdote-lopera.jpg" }
  ];
  function pintarFoto(texto) {
    var t = String(texto || "").toLowerCase();
    var img = $("fotoAhora"), hallada = "";
    FOTOS.forEach(function (f) { if (!hallada && t.indexOf(f.clave) !== -1) hallada = f.foto; });
    if (hallada) {
      if (img.getAttribute("src") !== hallada) img.setAttribute("src", hallada);
      img.setAttribute("alt", texto);
    }
    oculto(img, !hallada);
  }

  // Texto del chip del encabezado: en celular solo se ve la parte corta.
  function pintarChip(largo, corto) {
    chip.textContent = "";
    if (largo) {
      var span = document.createElement("span");
      span.className = "largo";
      span.textContent = largo;
      chip.appendChild(span);
    }
    chip.appendChild(document.createTextNode(corto));
  }

  /* ---------- VIR-6: «¿Cómo te llega?» ----------
     Sin chat abierto (decisión de Mauricio): un toque de botón. El Worker
     guarda el último botón de cada código y Mauricio ve los conteos de
     los últimos 2 minutos en su panel. */
  var GRACIAS_SENAL = {
    OK: "¡Gracias! Que lo disfrutes.",
    CONGELA: "Gracias, ya lo sabemos. Si sigue congelado, recarga la página: no tienes que volver a escribir el código.",
    SONIDO: "Gracias, ya lo sabemos. Revisa también que el volumen esté arriba y que el video no esté en silencio."
  };
  var botonesSenal = Array.prototype.slice.call(document.querySelectorAll("#comoLlega .chipbtn"));
  botonesSenal.forEach(function (b) {
    b.addEventListener("click", function () {
      var valor = b.getAttribute("data-valor");
      botonesSenal.forEach(function (o) { o.disabled = true; });
      llamar("/api/senal", { codigo: estado.codigo, sesion: estado.sesion, valor: valor }).then(function (r) {
        if (r.ok) {
          botonesSenal.forEach(function (o) { o.classList.toggle("activo", o === b); });
          $("graciasSenal").textContent = GRACIAS_SENAL[valor] || "";
        } else {
          $("graciasSenal").textContent = r.mensaje || "No se pudo enviar. Intenta de nuevo.";
        }
        oculto($("graciasSenal"), false);
      }).catch(function () {
        $("graciasSenal").textContent = "No se pudo enviar. Revisa tu internet.";
        oculto($("graciasSenal"), false);
      }).finally(function () {
        setTimeout(function () { botonesSenal.forEach(function (o) { o.disabled = false; }); }, 3000);
      });
    });
  });

  /* ---------- VIR-6: pregunta del momento ----------
     Llega en cada latido (o null). Solo se vuelve a pintar si cambia, para
     no borrar lo que la persona está escribiendo. */
  var preguntaActual = 0;
  // Preguntas ya respondidas con este código: la tarjeta se cierra y no
  // vuelve a salir (VIR-6b, pedido de Mauricio: «para no confundir»).
  var respondidas = {};
  var cerrarPregunta = 0;
  function pintarPregunta(p) {
    var caja = $("pregunta");
    var lado = caja.parentNode;
    if (p && p.id && respondidas[p.id]) p = null;
    if (!p || !p.id) {
      clearTimeout(cerrarPregunta);
      preguntaActual = 0;
      oculto(caja, true);
      lado.classList.remove("con-pregunta");
      return;
    }
    if (p.id === preguntaActual) return;
    preguntaActual = p.id;
    clearTimeout(cerrarPregunta);
    $("preguntaTexto").textContent = p.texto;
    var nota = $("preguntaNota");
    nota.classList.remove("error", "listo");
    var opciones = $("preguntaOpciones");
    opciones.textContent = "";
    if (p.tipo === "BOTONES") {
      (p.opciones || []).forEach(function (texto, i) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "chipbtn";
        b.textContent = texto;
        b.addEventListener("click", function () { responder(p.id, i, b); });
        opciones.appendChild(b);
      });
      nota.textContent = "";
    } else {
      $("preguntaInput").value = "";
      nota.textContent = "Solo lo ve el equipo de la transmisión.";
    }
    oculto(opciones, p.tipo !== "BOTONES");
    oculto($("preguntaForm"), p.tipo === "BOTONES");
    oculto(caja, false);
    lado.classList.add("con-pregunta");
  }

  function responder(id, respuesta, boton) {
    var nota = $("preguntaNota");
    var botones = Array.prototype.slice.call(document.querySelectorAll("#preguntaOpciones .chipbtn"));
    var enviar = $("preguntaForm").querySelector("button");
    botones.forEach(function (b) { b.disabled = true; });
    enviar.disabled = true;
    llamar("/api/responder", { codigo: estado.codigo, sesion: estado.sesion, pregunta: id, respuesta: respuesta }).then(function (r) {
      nota.classList.toggle("error", !r.ok);
      if (r.ok || r.estado === "CERRADA") {
        // Respondida (o ya cerrada): gracias 3 s y la tarjeta se cierra sola.
        respondidas[id] = true;
        oculto($("preguntaOpciones"), true);
        oculto($("preguntaForm"), true);
        nota.classList.remove("error");
        nota.classList.toggle("listo", !!r.ok);
        nota.textContent = r.ok ? "✓ ¡Gracias por responder!" : "Esa pregunta ya se cerró.";
        clearTimeout(cerrarPregunta);
        cerrarPregunta = setTimeout(function () { pintarPregunta(null); }, 3000);
      } else {
        nota.textContent = r.mensaje || "No se pudo enviar. Intenta de nuevo.";
      }
    }).catch(function () {
      nota.classList.add("error");
      nota.textContent = "No se pudo enviar. Revisa tu internet.";
    }).finally(function () {
      botones.forEach(function (b) { b.disabled = false; });
      enviar.disabled = false;
    });
  }

  $("preguntaForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var texto = $("preguntaInput").value.trim();
    var nota = $("preguntaNota");
    if (texto.length < 2) {
      nota.classList.add("error");
      nota.textContent = "Escribe el nombre de tu ciudad o país.";
      return;
    }
    if (/\d/.test(texto)) {
      nota.classList.add("error");
      nota.textContent = "Escribe solo letras, sin números.";
      return;
    }
    responder(preguntaActual, texto, null);
  });

  /* ---------- latido: un aparato a la vez y firma nueva ---------- */
  function programarLatido() {
    clearTimeout(temporizadorLatido);
    temporizadorLatido = setTimeout(latido, estado.latido * 1000);
  }

  function latido() {
    llamar("/api/latido", { codigo: estado.codigo, sesion: estado.sesion }).then(function (r) {
      fallasSeguidas = 0;
      if (!r.ok) {
        detenerVideo();
        avisar(r);
        return;
      }
      var p = partir(r.video.hls);
      estado.token = p.token;
      if (estado.reconectar) {
        // Volvió de otra app o de la pantalla bloqueada: video nuevo con
        // la firma recién pedida, en el momento en vivo.
        estado.reconectar = false;
        estado.modo = r.modo;
        estado.base = p.base;
        pintarModo(r.modo);
        cargarVideo(r.video.hls);
      } else if (r.modo !== estado.modo) {
        // Pasó de vivo a grabación: se carga el video nuevo.
        estado.modo = r.modo;
        estado.base = p.base;
        pintarModo(r.modo);
        cargarVideo(r.video.hls);
      } else if (!hls && video.src) {
        // Reproductor nativo: no se puede cambiar la firma por dentro.
        // Solo se recarga si el video se detuvo por la firma vencida.
        if (video.error || video.paused && video.readyState < 2) cargarVideo(r.video.hls);
      }
      pintarEscenario(r.escenario);
      pintarPregunta(r.pregunta);
      pintarConexion(true);
      programarLatido();
    }).catch(function () {
      // Sin internet un momento: se sigue viendo lo que hay en memoria.
      fallasSeguidas++;
      pintarConexion(false);
      clearTimeout(temporizadorLatido);
      temporizadorLatido = setTimeout(latido, Math.min(5000 * fallasSeguidas, 30000));
    });
  }

  /* ---------- volver a la página ----------
     En iPhone, al salir de Safari la página se congela: no late, la firma
     del video vence y al volver el video no arranca (prueba del
     18/11/2026). Al volver tras más de 15 s afuera se pide firma nueva y
     se recarga el video. */
  var ocultaDesde = 0;
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) { ocultaDesde = Date.now(); return; }
    if (!ocultaDesde || pVideo.classList.contains("oculto")) { ocultaDesde = 0; return; }
    var fuera = Date.now() - ocultaDesde;
    ocultaDesde = 0;
    if (fuera < 15000) return;
    estado.reconectar = true;
    clearTimeout(temporizadorLatido);
    latido();
  });

  /* ---------- 3. avisos ---------- */
  var AVISOS = {
    OTRO_APARATO: { icono: "⧉", clase: "", eyebrow: "Una pantalla a la vez", titulo: "Tu código se abrió en otra pantalla",
      boton: "Ver aquí", ayuda: "Si tocas «Ver aquí», la otra pantalla se detiene. Si no fuiste tú, alguien tiene tu código: escribe a la organización." },
    ANTES: { icono: "◷", clase: "dorado", eyebrow: "Todo listo", titulo: "Tu código funciona", boton: "", ayuda: "" },
    GRABACION_PRONTO: { icono: "◷", clase: "dorado", eyebrow: "Gracias por acompañarnos", titulo: "La transmisión en vivo terminó", boton: "Revisar de nuevo", ayuda: "" },
    TERMINO: { icono: "✓", clase: "", eyebrow: "Retiro de Adviento", titulo: "La grabación ya no está disponible", boton: "", ayuda: "" },
    BLOQUEADO: { icono: "!", clase: "rojo", eyebrow: "Código bloqueado", titulo: "Este código se abrió en demasiadas pantallas", boton: "",
      ayuda: "Escribe al WhatsApp de la organización +57 322 527 6778 para revisarlo." },
    SIN_CONFIGURAR: { icono: "◷", clase: "dorado", eyebrow: "Un momento", titulo: "La transmisión se está preparando", boton: "Intentar de nuevo", ayuda: "" },
    ERROR: { icono: "!", clase: "rojo", eyebrow: "Algo falló", titulo: "No pudimos conectar", boton: "Intentar de nuevo", ayuda: "" }
  };

  function avisar(r) {
    clearTimeout(temporizadorLatido);
    clearInterval(temporizadorReloj);
    var a = AVISOS[r.estado] || AVISOS.ERROR;
    var icono = $("avisoIcono");
    icono.className = "icono " + a.clase;
    oculto(icono, r.estado === "ANTES");
    oculto($("frase"), r.estado !== "ANTES");
    // Espera: sacerdotes y flyer (en computador, flyer a la izquierda)
    var espera = r.estado === "ANTES";
    pAviso.classList.toggle("espera", espera);
    oculto($("acompanan"), !espera);
    oculto($("flyerEspera"), !espera);
    icono.textContent = a.icono;
    $("avisoEyebrow").textContent = a.eyebrow;
    $("avisoTitulo").textContent = a.titulo;
    $("avisoTexto").textContent = r.mensaje || "";
    $("avisoAyuda").textContent = a.ayuda;
    var btn = $("btnAviso");
    btn.textContent = a.boton;
    oculto(btn, !a.boton);
    oculto($("reloj"), r.estado !== "ANTES" || !r.desde);
    if (r.estado === "ANTES" && r.desde) correrReloj(r.desde);
    pintarChip("Transmisión ", "en vivo");
    chip.classList.remove("vivo");
    mostrar(pAviso);
  }

  $("btnAviso").addEventListener("click", function () { entrar(estado.codigo); });

  function correrReloj(desde) {
    function pintar() {
      var falta = Math.max(0, desde - Date.now());
      $("rDias").textContent = Math.floor(falta / 86400000);
      $("rHoras").textContent = Math.floor(falta / 3600000) % 24;
      $("rMin").textContent = Math.floor(falta / 60000) % 60;
      if (falta === 0) { clearInterval(temporizadorReloj); entrar(estado.codigo); }
    }
    pintar();
    temporizadorReloj = setInterval(pintar, 20000);
  }

  function otroCodigo() {
    clearTimeout(temporizadorLatido);
    clearInterval(temporizadorReloj);
    detenerVideo();
    borrar(CLAVE_CODIGO);
    borrar(CLAVE_SESION);
    estado.codigo = estado.sesion = "";
    inputCodigo.value = "";
    oculto(errorCodigo, true);
    mostrar(pCodigo);
    inputCodigo.focus();
  }
  $("btnSalir").addEventListener("click", otroCodigo);
  $("btnOtroCodigo").addEventListener("click", otroCodigo);

  $("formCodigo").addEventListener("submit", function (e) {
    e.preventDefault();
    entrar(inputCodigo.value);
  });
  inputCodigo.addEventListener("input", function () {
    var pos = inputCodigo.value.length;
    inputCodigo.value = bonito(inputCodigo.value) || inputCodigo.value.toUpperCase();
    if (pos >= inputCodigo.value.length) inputCodigo.setSelectionRange(inputCodigo.value.length, inputCodigo.value.length);
  });

  /* ---------- arranque ---------- */
  // ?c=CODIGO (enlace del QR de la entrada): se usa y se quita de la
  // barra de direcciones para que no quede a la vista ni en capturas.
  var params = new URLSearchParams(location.search);
  var desdeEnlace = normalizar(params.get("c"));
  if (desdeEnlace) {
    try { history.replaceState(null, "", location.pathname); } catch (e) { /* nada */ }
  }
  var guardado = leer(CLAVE_CODIGO);
  var sesionGuardada = leer(CLAVE_SESION);

  if (desdeEnlace && desdeEnlace !== guardado) {
    inputCodigo.value = bonito(desdeEnlace);
    entrar(desdeEnlace);
  } else if (guardado && sesionGuardada) {
    // Volvió a abrir la página en el mismo aparato: si sigue siendo el
    // activo, continúa sin abrir otra sesión (no cuenta como cambio).
    estado.codigo = guardado;
    estado.sesion = sesionGuardada;
    inputCodigo.value = bonito(guardado);
    llamar("/api/latido", { codigo: guardado, sesion: sesionGuardada, inicio: true }).then(function (r) {
      // Si otro aparato tomó el código, se avisa con «Ver aquí» en vez de
      // quitárselo solo (una pestaña vieja no debe sacar a nadie).
      if (r.ok) { empezar(r); } else if (r.estado === "NO_VALIDO") { mostrar(pCodigo); } else { avisar(r); }
    }).catch(function () { mostrar(pCodigo); });
  } else if (guardado) {
    inputCodigo.value = bonito(guardado);
  }
})();
