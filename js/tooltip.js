/**
 * Custom tooltip system — replaces native title tooltips.
 * Appears instantly on hover, styled to match dark theme.
 * Self-initializing: just import this module.
 */

let tip = null;

function init() {
    tip = document.createElement("div");
    tip.className = "custom-tooltip";
    document.body.appendChild(tip);

    document.addEventListener("mouseover", onOver, true);
    document.addEventListener("mouseout", onOut, true);
}

function onOver(e) {
    const target = e.target.closest("[title], [data-tooltip]");
    if (!target) return;

    // Steal the title to suppress native tooltip
    if (target.hasAttribute("title")) {
        target.dataset.tooltip = target.getAttribute("title");
        target.removeAttribute("title");
    }

    const text = target.dataset.tooltip;
    if (!text) return;

    tip.textContent = text;
    tip.classList.add("visible");
    positionTip(target);
}

function onOut(e) {
    const target = e.target.closest("[data-tooltip]");
    if (!target) return;

    // Restore title for accessibility
    if (target.dataset.tooltip) {
        target.setAttribute("title", target.dataset.tooltip);
    }
    tip.classList.remove("visible");
}

function positionTip(anchor) {
    const r = anchor.getBoundingClientRect();
    const tipW = tip.offsetWidth;
    const tipH = tip.offsetHeight;

    let left = r.left + r.width / 2 - tipW / 2;
    let top = r.bottom + 6;

    // Flip above if near bottom
    if (top + tipH > window.innerHeight - 8) {
        top = r.top - tipH - 6;
    }
    // Clamp horizontal
    left = Math.max(8, Math.min(left, window.innerWidth - tipW - 8));

    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
} else {
    init();
}
