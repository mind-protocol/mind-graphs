// Thème clair / sombre partagé par toutes les pages.
// Le choix est mémorisé localement (ce navigateur) ; le thème sombre reste le défaut.
(function () {
  const STORAGE_KEY = "mind-graph-theme";
  const root = document.documentElement;
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark") root.setAttribute("data-theme", stored);

  const currentTheme = () => root.getAttribute("data-theme") || "dark";
  const toggles = () => document.querySelectorAll("#theme-toggle, [data-theme-toggle]");

  function applyTheme(theme) {
    root.setAttribute("data-theme", theme);
    localStorage.setItem(STORAGE_KEY, theme);
    const isLight = theme === "light";
    for (const button of toggles()) {
      button.setAttribute("aria-pressed", String(isLight));
      button.textContent = isLight ? "Thème sombre" : "Thème clair";
    }
  }

  window.addEventListener("DOMContentLoaded", () => {
    applyTheme(currentTheme());
    for (const button of toggles()) {
      button.addEventListener("click", () => applyTheme(currentTheme() === "light" ? "dark" : "light"));
    }
  });
})();
