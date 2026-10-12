// Standalone entry for the static web build (GitHub Pages). It mounts the
// game directly, without the TanStack Start server shell, auth or preview
// bridge, none of which the game uses.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { LakeshoreExit } from "@/components/lakeshore-exit";
import "./web.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LakeshoreExit />
  </StrictMode>,
);

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
