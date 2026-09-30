// Política de contraseñas (espejo de Seguridad.js; el servidor decide).
// 10 a 64 caracteres, al menos una letra y un número, sin el usuario,
// no repetitiva, no secuencia, no de las más comunes.
(function(global) {
  const MIN = 10;
  const MAX = 64;
  const COMUNES = [
    "1234567890", "12345678910", "0123456789", "1234567890a", "a123456789",
    "password123", "password1234", "contrasena1", "contraseña1", "contrasena123",
    "contraseña123", "qwerty1234", "qwertyuiop1", "abc1234567", "abcd123456",
    "mgeventos1", "mgeventos123", "mgeventos2026", "eventos123", "eventos2026",
    "boletas123", "ticket1234", "tickets123", "admin12345", "administrador1",
    "colombia123", "colombia2026", "medellin123", "iloveyou12", "superadmin1"
  ];

  function esSecuencia(t) {
    if (t.length < 4) return false;
    let asc = true, desc = true;
    for (let i = 1; i < t.length; i++) {
      const d = t.charCodeAt(i) - t.charCodeAt(i - 1);
      if (d !== 1) asc = false;
      if (d !== -1) desc = false;
    }
    return asc || desc;
  }

  // Devuelve la lista de reglas con { texto, cumple } para pintar el checklist.
  function reglas(password, usuario) {
    const p = String(password || "");
    const min = p.toLowerCase();
    const u = String(usuario || "").toLowerCase();
    return [
      { texto: "Entre " + MIN + " y " + MAX + " caracteres", cumple: p.length >= MIN && p.length <= MAX },
      { texto: "Al menos una letra y un número", cumple: /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(p) && /[0-9]/.test(p) },
      { texto: "No contiene tu usuario", cumple: !p || u.length < 3 || min.indexOf(u) === -1 },
      {
        texto: "No es repetitiva, una secuencia ni una clave común",
        cumple: !!p && !/^(.)\1+$/.test(p) && new Set(min.split("")).size >= 4 &&
          !esSecuencia(min) && COMUNES.indexOf(min) === -1
      }
    ];
  }

  // 0 = vacía, 1 = no cumple, 2 = aceptable, 3 = buena, 4 = excelente.
  function fuerza(password, usuario) {
    const p = String(password || "");
    if (!p) return 0;
    if (!reglas(p, usuario).every(function(r) { return r.cumple; })) return 1;
    let puntos = 2;
    if (p.length >= 14) puntos++;
    const tipos = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(function(r) { return r.test(p); }).length;
    if (tipos >= 3 || p.length >= 18) puntos++;
    return Math.min(puntos, 4);
  }

  function pintar(contenedor, password, usuario) {
    const lista = reglas(password, usuario);
    const f = fuerza(password, usuario);
    const etiquetas = ["", "No cumple", "Aceptable", "Buena", "Excelente"];
    const colores = ["#e5e7eb", "#b91c1c", "#d97706", "#059669", "#047857"];
    contenedor.innerHTML = "";
    const barra = document.createElement("div");
    barra.style.cssText = "height:6px;border-radius:4px;background:#e5e7eb;overflow:hidden;margin:4px 0 6px";
    const relleno = document.createElement("div");
    relleno.style.cssText = "height:100%;transition:width .2s;width:" + (f * 25) + "%;background:" + colores[f];
    barra.appendChild(relleno);
    contenedor.appendChild(barra);
    if (f) {
      const e = document.createElement("div");
      e.style.cssText = "font-size:12px;font-weight:700;margin-bottom:6px;color:" + colores[f];
      e.textContent = "Seguridad: " + etiquetas[f];
      contenedor.appendChild(e);
    }
    lista.forEach(function(r) {
      const li = document.createElement("div");
      li.style.cssText = "font-size:12px;line-height:1.7;color:" + (r.cumple ? "#059669" : "#6b7280");
      li.textContent = (r.cumple ? "✓ " : "○ ") + r.texto;
      contenedor.appendChild(li);
    });
    return lista.every(function(r) { return r.cumple; });
  }

  global.PoliticaPassword = { MIN: MIN, MAX: MAX, reglas: reglas, fuerza: fuerza, pintar: pintar };
})(window);
