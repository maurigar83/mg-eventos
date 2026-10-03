/* Menú de 3 rayitas del encabezado compartido de MG Eventos */
(function () {
    function init() {
        var header = document.querySelector(".mg-header");
        var toggle = document.querySelector(".mg-menu-toggle");
        if (!header || !toggle) return;

        function setMenu(open) {
            header.classList.toggle("nav-open", open);
            toggle.setAttribute("aria-expanded", open ? "true" : "false");
            toggle.setAttribute("aria-label", open ? "Cerrar menú" : "Abrir menú");
        }

        toggle.addEventListener("click", function () {
            setMenu(!header.classList.contains("nav-open"));
        });

        header.querySelectorAll(".mg-nav a").forEach(function (link) {
            link.addEventListener("click", function () { setMenu(false); });
        });

        document.addEventListener("keydown", function (e) {
            if (e.key === "Escape") setMenu(false);
        });

        document.addEventListener("click", function (e) {
            if (!header.contains(e.target)) setMenu(false);
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();

/* Centra el sello en la mitad del dibujo real de la ə (encabezado y pie).
   La línea base se mide en la página (funciona igual en Safari, Chrome y Firefox)
   y el dibujo de la letra con la fuente que cargó el navegador. */
(function () {
    var ctx = document.createElement("canvas").getContext("2d");
    function centrar() {
        document.querySelectorAll(".mg-schwa").forEach(function (s) {
            var marca = s.querySelector(".mg-schwa-base");
            if (!marca) {
                marca = document.createElement("span");
                marca.className = "mg-schwa-base";
                marca.setAttribute("aria-hidden", "true");
                s.appendChild(marca);
            }
            var cs = getComputedStyle(s);
            var px = parseFloat(cs.fontSize);
            var base = marca.offsetTop;                 // línea base dentro de la letra
            ctx.font = cs.fontWeight + " " + cs.fontSize + " " + cs.fontFamily;
            var m = ctx.measureText("ə");
            var arriba = m.actualBoundingBoxAscent, abajo = m.actualBoundingBoxDescent;
            var medio = (arriba > 0) ? (arriba - abajo) / 2 : px * 0.27;
            var cx = (m.actualBoundingBoxRight > 0) ? (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2 : s.offsetWidth / 2;
            s.style.setProperty("--sello-x", cx.toFixed(2) + "px");
            s.style.setProperty("--sello-y", (base - medio).toFixed(2) + "px");
        });
    }
    function iniciar() {
        centrar();
        if (document.fonts) {
            if (document.fonts.ready) document.fonts.ready.then(centrar);
            if (document.fonts.addEventListener) document.fonts.addEventListener("loadingdone", centrar);
        }
        window.addEventListener("load", centrar);
        window.addEventListener("resize", centrar);
        setTimeout(centrar, 1500);
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar);
    else iniciar();
})();
