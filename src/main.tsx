import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./app/App";
import { registerServiceWorker } from "./lib/pwa/register-sw";
import { isSmartCallback } from "./lib/smart/callback";
import { requestPersistentStorage } from "./lib/pwa/storage";

const app = (
  <BrowserRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
    <App />
  </BrowserRouter>
);

ReactDOM.createRoot(document.getElementById("root")!).render(
  isSmartCallback() ? app : <React.StrictMode>{app}</React.StrictMode>
);

registerServiceWorker();
void requestPersistentStorage();
