/* Panel de la transmisión (VIR-6, 18/11/2026, maquetas aprobadas por
 * Mauricio). Solo SUPERADMIN.
 * 1. Login de siempre (o la sesión que ya trae del panel de MG Eventos).
 * 2. Apps Script (acción envivo_panel_firma) da un pase firmado de 8 h.
 * 3. Con ese pase se habla directo con el Worker de la transmisión:
 *    estado (cada 15 s), guardar, publicar, cerrar, borrar y resultados.
 * No se ven nombres ni teléfonos: solo conteos y respuestas cortas.
 */
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  // config.js declara CONFIG con const: no queda en window.
  var API = (typeof CONFIG !== "undefined" && CONFIG.SEGURIDAD_API_URL) || "";
  var CLAVE_PASE = "mg_envivo_panel_pase";
  var pase = null; // { url, pase, expira }
  var temporizador = null;
  var ultimoEstado = null;

  function oculto(el, si) { el.classList.toggle("oculto", !!si); }
  function leerSesion(clave) { try { return sessionStorage.getItem(clave) || ""; } catch (e) { return ""; } }
  function guardarSesion(clave, valor) { try { sessionStorage.setItem(clave, valor); } catch (e) { /* nada */ } }
  function borrarSesion(clave) { try { sessionStorage.removeItem(clave); } catch (e) { /* nada */ } }

  function apps(cuerpo) {
    return fetch(API, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(cuerpo)
    }).then(function (r) { return r.json(); });
  }

  function worker(accion, cuerpo) {
    var datos = Object.assign({ pase: pase.pase }, cuerpo || {});
    return fetch(pase.url + "/panel/" + accion, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(datos),
      cache: "no-store"
    }).then(function (r) {
      return r.json().then(function (j) { j.status = r.status; return j; });
    }).then(function (j) {
      if (j.status === 401) {
        // Pase vencido: se pide otro con la sesión (y si no, login).
        borrarSesion(CLAVE_PASE);
        pase = null;
        return pedirPase().then(function (ok) {
          if (!ok) throw new Error(j.mensaje || "Inicia sesión de nuevo.");
          return worker(accion, cuerpo);
        });
      }
      return j;
    });
  }

  /* ---------- sesión y pase ---------- */
  function mostrarLogin(mensaje) {
    clearTimeout(temporizador);
    oculto($("pPanel"), true);
    oculto($("pLogin"), false);
    $("msgLogin").textContent = mensaje || "";
  }

  function pedirPase() {
    var token = leerSesion("mg_eventos_token");
    if (!token) { mostrarLogin(""); return Promise.resolve(false); }
    return apps({ accion: "envivo_panel_firma", token: token }).then(function (r) {
      if (!r.ok) {
        if (r.estado === "NO_AUTORIZADO") borrarSesion("mg_eventos_token");
        mostrarLogin(r.mensaje || "Inicia sesión de nuevo.");
        return false;
      }
      pase = { url: r.url, pase: r.pase, expira: r.expira };
      guardarSesion(CLAVE_PASE, JSON.stringify(pase));
      return true;
    }).catch(function () {
      mostrarLogin("No fue posible conectar. Intenta de nuevo.");
      return false;
    });
  }

  $("formLogin").addEventListener("submit", function (e) {
    e.preventDefault();
    var usuario = $("usuario").value.trim(), clave = $("clave").value;
    if (!usuario || !clave) { $("msgLogin").textContent = "Escribe usuario y contraseña."; return; }
    $("btnLogin").disabled = true;
    $("msgLogin").textContent = "Verificando…";
    apps({ accion: "login", usuario: usuario, password: clave }).then(function (r) {
      if (!r.ok) { $("msgLogin").textContent = r.mensaje || "Usuario o contraseña incorrectos."; return; }
      guardarSesion("mg_eventos_token", r.token);
      guardarSesion("mg_eventos_usuario", r.usuario || "");
      guardarSesion("mg_eventos_nombre", r.nombre || "");
      guardarSesion("mg_eventos_rol", r.rol || "");
      guardarSesion("mg_eventos_permisos", JSON.stringify(r.permisos || []));
      guardarSesion("mg_eventos_expira", r.expira || "");
      $("clave").value = "";
      return pedirPase().then(function (ok) { if (ok) arrancar(); });
    }).catch(function () {
      $("msgLogin").textContent = "No fue posible conectar. Intenta de nuevo.";
    }).finally(function () { $("btnLogin").disabled = false; });
  });

  $("btnSalir").addEventListener("click", function () {
    var token = leerSesion("mg_eventos_token");
    if (token) apps({ accion: "logout", token: token }).catch(function () { /* nada */ });
    ["mg_eventos_token", "mg_eventos_usuario", "mg_eventos_nombre", "mg_eventos_rol",
      "mg_eventos_permisos", "mg_eventos_expira", CLAVE_PASE].forEach(borrarSesion);
    pase = null;
    mostrarLogin("Sesión cerrada.");
  });

  /* ---------- pintar ---------- */
  function respuestas(n) { return n + (n === 1 ? " respuesta" : " respuestas"); }

  function hora(iso) {
    var d = iso ? new Date(iso) : new Date();
    return d.toLocaleTimeString("es-CO", { hour: "numeric", minute: "2-digit", second: "2-digit" });
  }

  function pintarResultados(caja, pregunta, resultados) {
    caja.textContent = "";
    var lista = (resultados && resultados.lista) || [];
    if (pregunta.tipo === "BOTONES") {
      var max = Math.max.apply(null, lista.map(function (x) { return x.n; }).concat([1]));
      lista.forEach(function (x) {
        var fila = document.createElement("div");
        fila.className = "barra";
        var s = document.createElement("span"); s.textContent = x.texto;
        var i = document.createElement("i"); i.style.width = Math.round(x.n / max * 100) + "%";
        var b = document.createElement("b"); b.textContent = x.n;
        fila.appendChild(s); fila.appendChild(i); fila.appendChild(b);
        caja.appendChild(fila);
      });
    } else {
      var nube = document.createElement("div");
      nube.className = "nube";
      lista.forEach(function (x) {
        var s = document.createElement("span");
        s.textContent = x.texto;
        var b = document.createElement("b"); b.textContent = x.n;
        s.appendChild(b);
        nube.appendChild(s);
      });
      if (!lista.length) {
        var p = document.createElement("p"); p.className = "pnota"; p.textContent = "Aún no hay respuestas.";
        caja.appendChild(p);
      }
      caja.appendChild(nube);
    }
  }

  function pintar(r) {
    ultimoEstado = r;
    var chip = $("chip");
    chip.textContent = "● " + r.viendo + " viendo";
    chip.classList.add("vivo");

    var s = r.senal || {}, total = (s.OK || 0) + (s.CONGELA || 0) + (s.SONIDO || 0);
    var max = Math.max(s.OK || 0, s.CONGELA || 0, s.SONIDO || 0, 1);
    ["OK", "CONGELA", "SONIDO"].forEach(function (k) {
      $("n" + k).textContent = s[k] || 0;
      $("b" + k).style.width = Math.round((s[k] || 0) / max * 100) + "%";
    });
    var malos = [];
    if ((s.CONGELA || 0) >= 5 && s.CONGELA / total > 0.1) malos.push(s.CONGELA + " dicen que se congela");
    if ((s.SONIDO || 0) >= 5 && s.SONIDO / total > 0.1) malos.push(s.SONIDO + " dicen que no hay sonido");
    $("alertaSenal").textContent = malos.length ? "⚠️ " + malos.join(" y ") + ". Avísale a quien transmite." : "";
    oculto($("alertaSenal"), !malos.length);

    var activa = (r.preguntas || []).filter(function (p) { return p.estado === "ACTIVA"; })[0];
    oculto($("activa"), !activa);
    oculto($("activaVacia"), !!activa);
    if (activa && r.activa) {
      $("activaTexto").textContent = activa.texto;
      $("btnCerrar").setAttribute("data-id", activa.id);
      pintarResultados($("activaResultados"), activa, r.activa.resultados);
      $("activaTotal").textContent = respuestas(r.activa.resultados.total) +
        (activa.tipo === "TEXTO" ? " · solo letras, sin números · nadie más las ve" : "");
    }

    var ul = $("lista");
    ul.textContent = "";
    (r.preguntas || []).forEach(function (p) {
      var li = document.createElement("li");
      var t = document.createElement("span"); t.className = "t"; t.textContent = p.texto;
      var sm = document.createElement("small");
      sm.textContent = (p.tipo === "BOTONES" ? "Botones: " + p.opciones.join(" · ") : "Escrita") +
        (p.total ? " · " + respuestas(p.total) : "");
      t.appendChild(sm);
      var est = document.createElement("span");
      est.className = "estado " + p.estado;
      est.textContent = { LISTA: "Lista", ACTIVA: "Publicada", CERRADA: "Cerrada" }[p.estado] || p.estado;
      li.appendChild(t); li.appendChild(est);
      if (p.estado !== "ACTIVA") li.appendChild(boton(p.estado === "CERRADA" ? "Publicar de nuevo" : "Publicar", "oro", function (b) {
        accion(b, "publicar", { id: p.id });
      }));
      if (p.estado === "CERRADA") li.appendChild(boton("Ver resultados", "", function (b) { verResultados(b, p.id); }));
      if (p.estado === "LISTA") li.appendChild(boton("Borrar", "", function (b) {
        if (window.confirm("¿Borrar «" + p.texto + "»?")) accion(b, "borrar", { id: p.id });
      }));
      ul.appendChild(li);
    });
    oculto($("listaVacia"), (r.preguntas || []).length > 0);
    $("actualizado").textContent = "Actualizado " + hora(r.hora);
  }

  function boton(texto, clase, alHacer) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "btnp " + clase;
    b.textContent = texto;
    b.addEventListener("click", function () { alHacer(b); });
    return b;
  }

  function accion(b, nombre, cuerpo) {
    if (b) b.disabled = true;
    return worker(nombre, cuerpo).then(function (r) {
      if (!r.ok) { window.alert(r.mensaje || "No se pudo."); return; }
      if (r.preguntas) pintar(r);
    }).catch(function (e) {
      window.alert(e.message || "No fue posible conectar.");
    }).finally(function () { if (b) b.disabled = false; });
  }

  function verResultados(b, id) {
    b.disabled = true;
    worker("resultados", { id: id }).then(function (r) {
      if (!r.ok) { window.alert(r.mensaje || "No se pudo."); return; }
      $("verTexto").textContent = r.pregunta.texto;
      pintarResultados($("verResultados"), r.pregunta, r.resultados);
      $("verTotal").textContent = respuestas(r.resultados.total);
      oculto($("resultadosVer"), false);
      $("resultadosVer").scrollIntoView({ behavior: "smooth" });
    }).finally(function () { b.disabled = false; });
  }

  $("btnCerrar").addEventListener("click", function () {
    accion($("btnCerrar"), "cerrar", { id: Number($("btnCerrar").getAttribute("data-id")) });
  });

  $("nTipo").addEventListener("change", function () {
    oculto($("nOpciones"), $("nTipo").value !== "BOTONES");
  });

  $("formNueva").addEventListener("submit", function (e) {
    e.preventDefault();
    var texto = $("nTexto").value.trim();
    var tipo = $("nTipo").value;
    var opciones = Array.prototype.map.call(document.querySelectorAll("#nOpciones .op"), function (i) { return i.value.trim(); })
      .filter(Boolean);
    if (texto.length < 3) { $("msgNueva").textContent = "Escribe la pregunta."; return; }
    if (tipo === "BOTONES" && opciones.length < 2) { $("msgNueva").textContent = "Escribe al menos 2 respuestas."; return; }
    $("btnGuardar").disabled = true;
    worker("guardar", { texto: texto, tipo: tipo, opciones: opciones }).then(function (r) {
      if (!r.ok) { $("msgNueva").textContent = r.mensaje || "No se pudo guardar."; return; }
      $("msgNueva").textContent = "Guardada. Publícala desde la lista cuando quieras.";
      $("nTexto").value = "";
      document.querySelectorAll("#nOpciones .op").forEach(function (i) { i.value = ""; });
      pintar(r);
    }).catch(function (err) {
      $("msgNueva").textContent = err.message || "No fue posible conectar.";
    }).finally(function () { $("btnGuardar").disabled = false; });
  });

  /* ---------- actualizar cada 15 s ---------- */
  function refrescar() {
    clearTimeout(temporizador);
    worker("estado").then(function (r) {
      if (r.ok) pintar(r);
      else $("actualizado").textContent = r.mensaje || "No se pudo actualizar.";
    }).catch(function (e) {
      $("actualizado").textContent = "Sin conexión · reintentando";
    }).finally(function () {
      if (pase) temporizador = setTimeout(refrescar, 15000);
    });
  }

  function arrancar() {
    oculto($("pLogin"), true);
    oculto($("pPanel"), false);
    refrescar();
  }

  // Al abrir: pase guardado en esta pestaña, o se pide uno con la sesión.
  try { pase = JSON.parse(leerSesion(CLAVE_PASE) || "null"); } catch (e) { pase = null; }
  if (pase && pase.expira > Date.now() + 60000) {
    arrancar();
  } else {
    pase = null;
    pedirPase().then(function (ok) { if (ok) arrancar(); });
  }
})();
