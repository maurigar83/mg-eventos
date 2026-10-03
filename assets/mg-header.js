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

/* Centra la ə dentro de su sello (encabezado y pie), midiendo el dibujo real
   de la letra con la fuente que cargó el navegador. */
(function () {
    function centrar() {
        var sellos = document.querySelectorAll(".mg-schwa");
        if (!sellos.length) return;
        var ctx = document.createElement("canvas").getContext("2d");
        sellos.forEach(function (s) {
            var g = s.querySelector(".mg-schwa-g");
            if (!g) {
                g = document.createElement("i");
                g.className = "mg-schwa-g";
                g.textContent = s.textContent;
                s.textContent = "";
                s.appendChild(g);
            }
            var cs = getComputedStyle(g);
            ctx.font = cs.fontWeight + " " + cs.fontSize + " " + cs.fontFamily;
            var m = ctx.measureText("ə");
            if (!m.fontBoundingBoxAscent) return;
            var px = parseFloat(cs.fontSize);
            var asc = m.fontBoundingBoxAscent, desc = m.fontBoundingBoxDescent;
            var base = (px - (asc + desc)) / 2 + asc;
            var inkY = base - (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
            var inkX = (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2;
            var dy = px / 2 - inkY, dx = m.width / 2 - inkX;
            g.style.transform = "translate(" + dx.toFixed(2) + "px," + dy.toFixed(2) + "px)";
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
