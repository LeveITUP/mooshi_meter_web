/**
 * Lightweight toast notification system.
 * Usage:  import { showToast } from "./toast.js";
 *         showToast("Connected!", { type: "success", duration: 3000 });
 */

let container = null;

function ensureContainer() {
    if (container) return;
    container = document.createElement("div");
    container.className = "toast-container";
    document.body.appendChild(container);
}

/**
 * @param {string} message
 * @param {{ type?: "info"|"success"|"warning"|"error", duration?: number }} opts
 */
export function showToast(message, { type = "info", duration = 3000 } = {}) {
    ensureContainer();

    const el = document.createElement("div");
    el.className = `toast toast-${type}`;
    el.textContent = message;
    el.addEventListener("click", () => dismiss(el));

    container.appendChild(el);

    // Trigger enter animation on next frame
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add("show")));

    const timer = setTimeout(() => dismiss(el), duration);
    el._timer = timer;
}

function dismiss(el) {
    if (el._dismissed) return;
    el._dismissed = true;
    clearTimeout(el._timer);
    el.classList.remove("show");
    el.classList.add("hide");
    el.addEventListener("transitionend", () => el.remove(), { once: true });
    // Fallback removal if transition doesn't fire
    setTimeout(() => { if (el.parentNode) el.remove(); }, 500);
}
