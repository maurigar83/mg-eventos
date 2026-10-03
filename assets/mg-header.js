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

/* Centra el sello en la mitad del dibujo real de la ə (encabezado y pie),
   midiendo la letra con la fuente que cargó el navegador. */
(function () {
    function centrar() {
        var sellos = document.querySelectorAll(".mg-schwa");
        if (!sellos.length) return;
        var ctx = document.createElement("canvas").getContext("2d");
        sellos.forEach(function (s) {
            var cs = getComputedStyle(s);
            ctx.font = cs.fontWeight + " " + cs.fontSize + " " + cs.fontFamily;
            var m = ctx.measureText("ə");
            if (!m.fontBoundingBoxAscent) return;
            var alto = s.getBoundingClientRect().height || parseFloat(cs.fontSize);
            var asc = m.fontBoundingBoxAscent, desc = m.fontBoundingBoxDescent;
            var base = (alto - (asc + desc)) / 2 + asc;
            var cy = base - (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
            var cx = (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2;
            s.style.setProperty("--sello-x", cx.toFixed(2) + "px");
            s.style.setProperty("--sello-y", cy.toFixed(2) + "px");
        });
    }
    function iniciar() {
        centrar();
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(centrar);
        window.addEventListener("resize", centrar);
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar);
    else iniciar();
})();
