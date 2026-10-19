import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { ThemeProvider } from "./Theme.jsx";
import "./styles.css";
import "./ux.css";
import "./themes.css";
import "./retro.css";
import "./scope.css";

createRoot(document.getElementById("root")).render(
  <ThemeProvider>
    <App />
  </ThemeProvider>,
);
