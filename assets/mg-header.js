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
