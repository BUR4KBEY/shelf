import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@/App";
import { Banner } from "./Banner";
import "./preview.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Banner />
    <App />
  </StrictMode>,
);
