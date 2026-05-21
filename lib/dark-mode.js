(function () {
  // Apply saved theme immediately to avoid flash
  var saved = localStorage.getItem("ij-theme");
  var prefersDark = matchMedia("(prefers-color-scheme: dark)").matches;
  if (saved === "dark" || (!saved && prefersDark)) {
    document.body.dataset.theme = "dark";
  } else if (saved === "light") {
    document.body.dataset.theme = "light";
  }

  function syncBtn(btn) {
    var isDark = document.body.dataset.theme === "dark";
    btn.setAttribute("aria-pressed", String(isDark));
    btn.setAttribute("aria-label", isDark ? "Desactivar modo oscuro" : "Activar modo oscuro");
    btn.title = isDark ? "Modo claro" : "Modo oscuro";
  }

  function initBtn() {
    var btn = document.querySelector("[data-a11y='dark-mode']");
    if (!btn) return;
    syncBtn(btn);
    btn.addEventListener("click", function () {
      var isDark = document.body.dataset.theme === "dark";
      document.body.dataset.theme = isDark ? "light" : "dark";
      localStorage.setItem("ij-theme", document.body.dataset.theme);
      syncBtn(btn);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initBtn);
  } else {
    initBtn();
  }
})();
