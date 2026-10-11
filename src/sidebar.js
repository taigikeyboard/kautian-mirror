// Sidebar toggle, like the macOS sidebar button: wide screens slide the docked sidebar away and
// back (<html data-sidebar="closed">, remembered; index.html restores it before first paint);
// narrow screens open it as a popover drawer instead.
const STORAGE_KEY = "sidebar";
// same breakpoint as the docked-sidebar @media in styles.css
const wideScreen = window.matchMedia("(min-width: 50rem)");

// storage: main.js's localStorage adapter ({ set(items) }, failures swallowed)
export function initSidebar(button, sidebar, storage) {
  const root = document.documentElement;
  const syncExpanded = () => {
    const isOpen = wideScreen.matches ? root.dataset.sidebar !== "closed" : sidebar.matches(":popover-open");
    button.setAttribute("aria-expanded", String(isOpen));
  };
  button.addEventListener("click", () => {
    if (!wideScreen.matches) return sidebar.togglePopover();
    if (root.dataset.sidebar === "closed") delete root.dataset.sidebar;
    else root.dataset.sidebar = "closed";
    storage.set({ [STORAGE_KEY]: root.dataset.sidebar ?? "open" });
    syncExpanded();
  });
  sidebar.addEventListener("toggle", syncExpanded);
  // a drawer left open while the window widens would sit in the top layer over the docked sidebar
  wideScreen.addEventListener("change", () => {
    if (sidebar.matches(":popover-open")) sidebar.hidePopover();
    syncExpanded();
  });
  syncExpanded();
}
