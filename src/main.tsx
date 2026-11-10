import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import AuthConfirm from "./components/AuthConfirm";
import {
  parseAuthConfirmationHash,
  safeAuthReturnPath,
} from "./lib/auth-links";
import { AppProvider } from "./lib/app-context";
import "./styles.css";
// Capture a confirmation once before StrictMode effects, then remove its bearer
// token from the visible URL. It stays only in this page's in-memory props.
const isAuthConfirm =
  window.location.pathname === "/auth/confirm" ||
  window.location.pathname === "/auth/confirm/";
const confirmation = isAuthConfirm
  ? parseAuthConfirmationHash(window.location.hash)
  : null;
if (isAuthConfirm) window.history.replaceState(null, "", "/auth/confirm");
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isAuthConfirm ? (
      <AuthConfirm
        confirmation={confirmation}
        onComplete={(next) => window.location.replace(safeAuthReturnPath(next))}
      />
    ) : (
      <AppProvider>
        <App />
      </AppProvider>
    )}
  </React.StrictMode>,
);
