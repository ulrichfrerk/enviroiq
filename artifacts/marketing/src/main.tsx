import { createRoot, hydrateRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

const root = document.getElementById("root")!;

// If the page was pre-rendered at build time, the root element already
// contains real DOM — hydrate it instead of replacing it. Otherwise
// (dev mode, fallback HTML), do a normal client-side mount.
const hasPrerenderedContent = root.querySelector("[data-prerendered]") !== null;

if (hasPrerenderedContent) {
  hydrateRoot(root, <App />);
} else {
  createRoot(root).render(<App />);
}
