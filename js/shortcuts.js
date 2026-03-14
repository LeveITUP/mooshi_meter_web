/**
 * Keyboard shortcuts for the Mooshimeter app.
 *
 * Space — Start / stop streaming
 * H     — Hold / resume display
 * Z     — Zero both channels
 * 1     — Cycle graph to CH1 only
 * 2     — Cycle graph to CH2 only
 * C     — Cycle graph to combined
 * Esc   — Close modal / stop streaming
 * ?     — Show shortcut list
 */

import { showToast } from "./toast.js";

export function initShortcuts(app) {
    document.addEventListener("keydown", (e) => {
        // Don't capture when typing in an input
        const tag = e.target.tagName;
        if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;

        switch (e.key) {
            case " ":
                e.preventDefault();
                app._toggleStream();
                showToast(app.streaming ? "Streaming started" : "Streaming stopped", { duration: 1500 });
                break;

            case "h":
            case "H":
                document.getElementById("btn-hold")?.click();
                break;

            case "z":
            case "Z":
                app.ch1Offset = app.lastCh1 || 0;
                app.ch2Offset = app.lastCh2 || 0;
                showToast("Zeroed both channels", { duration: 1500 });
                break;

            case "1":
                if (app.graph) {
                    app.graph.setMode("ch1");
                    document.getElementById("graph-mode").value = "ch1";
                }
                showToast("Graph: CH1 only", { duration: 1500 });
                break;

            case "2":
                if (app.graph) {
                    app.graph.setMode("ch2");
                    document.getElementById("graph-mode").value = "ch2";
                }
                showToast("Graph: CH2 only", { duration: 1500 });
                break;

            case "c":
            case "C":
                if (app.graph) {
                    app.graph.setMode("combined");
                    document.getElementById("graph-mode").value = "combined";
                }
                showToast("Graph: Combined", { duration: 1500 });
                break;

            case "Escape": {
                const modal = document.getElementById("sessions-modal");
                if (modal) { modal.remove(); break; }
                if (app.streaming) {
                    app._toggleStream();
                    showToast("Streaming stopped", { duration: 1500 });
                }
                break;
            }

            case "?":
                showToast(
                    "Space: Stream  |  H: Hold  |  Z: Zero  |  1/2/C: Graph mode  |  Esc: Close/Stop",
                    { duration: 5000 }
                );
                break;

            default:
                return; // don't prevent default for unhandled keys
        }
    });
}
