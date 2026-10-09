// Word audio: one shared <audio>, fetched only when a play button is clicked.
import { audioPath } from "./data-paths.js";

const SPEAKER_SVG = `<svg viewBox="0 0 20 20" aria-hidden="true">
  <path d="M3.5 7.5h3l4-3.5v12l-4-3.5h-3z" fill="currentColor"/>
  <path d="M13.5 7a4 4 0 0 1 0 6M15.75 4.75a7 7 0 0 1 0 10.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
</svg>`;

const PLAY_LABEL = "播放";
const FAILED_LABEL = "音檔載入失敗";

// no src until a click, so nothing is fetched on page load
const player = new Audio();

function play(entryId, button) {
  // setting src restarts from 0; repeat clicks come from the HTTP cache
  player.src = audioPath(entryId);
  button.classList.remove("is-error");
  button.title = PLAY_LABEL;
  player.play().catch((err) => {
    // AbortError: a newer click interrupted this one — not a failure
    if (err.name === "AbortError") return;
    console.warn("audio.play.failed", entryId, err.name);
    button.classList.add("is-error");
    button.title = FAILED_LABEL;
  });
}

export function playButton(entryId) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "play";
  button.title = PLAY_LABEL;
  button.setAttribute("aria-label", PLAY_LABEL);
  button.innerHTML = SPEAKER_SVG;
  button.addEventListener("click", () => play(entryId, button));
  return button;
}
