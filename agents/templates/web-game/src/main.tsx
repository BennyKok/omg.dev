import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/routes";
import { installGamePage } from "./ui/page";
import "./ui/styles.css";

installGamePage();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
