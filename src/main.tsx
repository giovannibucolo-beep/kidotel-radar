import React from "react";
import ReactDOM from "react-dom/client";
// Font del brand Kidotel, bundle offline (niente CDN): Sora per i titoli, Manrope per il corpo.
import "@fontsource-variable/sora";
import "@fontsource-variable/manrope";
import App from "./App";
import { I18nProvider } from "./i18n";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </React.StrictMode>,
);
