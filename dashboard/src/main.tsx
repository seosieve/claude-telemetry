import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import "./styles/globals.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: true,
      // 1 min: telemetry only updates every ~15 min (agent sync), so a short
      // staleTime just burned Neon compute on every refocus for nothing.
      staleTime: 60_000,
      // Neon scale-to-zero cold starts can 500 the first request(s). Retry
      // transient server/network failures a few times with backoff so the DB
      // wake-up stays invisible; don't retry auth/client (4xx) errors.
      retry: (failureCount, error) => {
        const msg = error instanceof Error ? error.message : String(error);
        if (/Session expired/.test(msg) || /API error 4\d\d/.test(msg)) return false;
        return failureCount < 3;
      },
      retryDelay: (attempt) => Math.min(500 * 2 ** attempt, 4000),
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
