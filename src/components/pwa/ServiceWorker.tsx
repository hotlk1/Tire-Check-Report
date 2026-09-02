"use client";

import { useEffect } from "react";

/** Registers the app-shell service worker (public/sw.js). No-op in development. */
export function ServiceWorker() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((e) => console.warn("[sw] register failed", e));
  }, []);
  return null;
}
