import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GoogleOAuthProvider } from "@react-oauth/google";
import { Toaster } from "sonner";
import * as Sentry from "@sentry/react";

import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./index.css";

const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined;
if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0.1,
    integrations: [Sentry.browserTracingIntegration()],
  });
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } },
});

const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <GoogleOAuthProvider clientId={googleClientId}>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <App />
            <Toaster
              position="bottom-left"
              toastOptions={{
                style: {
                  background: "var(--canvas-elevated)",
                  color: "var(--ink)",
                  border: "1px solid var(--rule-strong)",
                  borderRadius: "2px",
                  fontFamily: "Geist Sans, system-ui, sans-serif",
                  fontSize: "0.875rem",
                  boxShadow: "none",
                },
              }}
            />
          </BrowserRouter>
        </QueryClientProvider>
      </GoogleOAuthProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
