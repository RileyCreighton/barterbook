import { Buffer } from "buffer/";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

// The pinned Solana SDK uses Buffer for its legacy transaction representation.
(globalThis as typeof globalThis & { Buffer: typeof Buffer }).Buffer = Buffer;
void import("./App").then(({ App }) => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
