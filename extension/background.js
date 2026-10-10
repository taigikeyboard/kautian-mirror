// Minimal service worker: every entry point below just opens the settings page.
// - first install (updates and browser restarts do not trigger it)
// - toolbar icon click
// - keyboard shortcut (manifest "commands")
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    chrome.runtime.openOptionsPage();
  }
});

chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

chrome.commands.onCommand.addListener((command) => {
  if (command === "open-settings") {
    chrome.runtime.openOptionsPage();
  }
});
