/* Intro del eslogan del Inicio: medidas y "toque para saltar".
   La decisión de mostrar la intro se toma en el <head> (script en línea)
   para que no haya parpadeo; este archivo solo ajusta posiciones y el salto. */
(function () {
    /* Centra el sello en el dibujo real de la ə (no en su caja de texto),
       midiendo la letra con la fuente que de verdad cargó el navegador. */
    function centrarSello() {
        var letra = document.querySelector(".hero-eslogan .lschwa");
        var sello = document.querySelector(".hero-eslogan .sello");
        if (!letra || !sello) return;
        var cs = getComputedStyle(letra);
        var ctx = document.createElement("canvas").getContext("2d");
        ctx.font = cs.fontWeight + " " + cs.fontSize + " " + cs.fontFamily;
        var m = ctx.measureText("ə");
        if (!m.fontBoundingBoxAscent && !m.actualBoundingBoxAscent) return;
        var px = parseFloat(cs.fontSize);
        var lineH = parseFloat(cs.lineHeight) || px * 1.3;
        var asc = m.fontBoundingBoxAscent || px * 0.95;
        var desc = m.fontBoundingBoxDescent || px * 0.25;
        var base = (lineH - (asc + desc)) / 2 + asc;           // línea base dentro de la caja
        var cy = base - (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
        var cx = (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2;
        sello.style.setProperty("--sello-y", cy.toFixed(2) + "px");
        sello.style.setProperty("--sello-x", cx.toFixed(2) + "px");
    }
    function iniciar() {
        centrarSello();
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(centrarSello);
        window.addEventListener("resize", centrarSello);
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar);
    else iniciar();
})();

(function () {
    var html = document.documentElement;
    if (!html.classList.contains("mg-intro")) return;

    function medir() {
        var logo = document.querySelector(".hero-logo");
        var eslogan = document.querySelector(".hero-eslogan");
        var titulo = document.querySelector(".hero h1");
        var texto = document.querySelector(".hero p");
        if (!logo || !eslogan || !titulo || !texto) return;

        // Alto de lo que todavía no se ve (título + texto) para centrar logo y eslogan
        var oculto = texto.offsetTop + texto.offsetHeight - titulo.offsetTop;
        var mitad = Math.round(oculto / 2);

        // Escala del eslogan: grande, pero sin salirse de la pantalla
        var texto_eslogan = eslogan.querySelector("span");
        var ancho = (texto_eslogan && texto_eslogan.offsetWidth) || eslogan.offsetWidth;
        var disponible = window.innerWidth - 32;
        var escala = Math.max(1, Math.min(2.7, disponible / ancho));
        var crece = (eslogan.offsetHeight * (escala - 1)) / 2;

        html.style.setProperty("--mg-eslogan-scale", escala.toFixed(3));
        html.style.setProperty("--mg-eslogan-y", Math.round(mitad + crece) + "px");
        html.style.setProperty("--mg-logo-y", Math.round(mitad - logo.offsetHeight * 0.15 - 6) + "px");
    }

    function saltar() {
        if (!html.classList.contains("mg-intro")) return;
        html.classList.remove("mg-intro");
        html.classList.add("mg-intro-skip");
        cleanup();
    }

    function cleanup() {
        document.removeEventListener("keydown", saltar);
        var hero = document.querySelector(".hero");
        if (hero) {
            hero.removeEventListener("click", saltar);
            hero.removeEventListener("touchstart", saltar);
        }
    }

    function init() {
        medir();
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(medir);

        var hero = document.querySelector(".hero");
        if (hero) {
            hero.addEventListener("click", saltar);
            hero.addEventListener("touchstart", saltar, { passive: true });
        }
        document.addEventListener("keydown", saltar);

        // Al terminar ya no hay nada que saltar
        setTimeout(cleanup, 7700);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
