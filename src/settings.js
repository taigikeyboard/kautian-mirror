// Settings panel (外觀, 字型, 白話字, 方音符號, 選單顯示): each choice is a <html data-*> attribute
// styles.css / main.js key on, saved under "settings"; index.html re-applies it before first paint.

// checkboxes store "on" / "off" so every setting is a plain data-* string
const controlValue = (control) => (control.type === "checkbox" ? (control.checked ? "on" : "off") : control.value);

// storage: main.js's localStorage adapter ({ set(items) }, failures swallowed)
export function initSettings(form, storage) {
  const root = document.documentElement;
  // index.html already restored the stored choices onto <html>; unknown values keep the markup default
  for (const control of form.elements) {
    const value = root.dataset[control.name];
    if (value === undefined) continue;
    if (control.type === "checkbox") control.checked = value === "on";
    else if ([...control.options].some((option) => option.value === value)) control.value = value;
  }
  form.addEventListener("change", () => {
    const settings = Object.fromEntries([...form.elements].map((control) => [control.name, controlValue(control)]));
    Object.assign(root.dataset, settings);
    storage.set({ settings });
  });
}
