// `use-sync-external-store/shim` for the prebuilt embed (vite.lib.config.ts).
// The real shim is CommonJS that calls require("react"). React is external in
// the embed, so the bundler kept that require, and a host's browser bundle
// threw "Calling `require` for "react"" on first load. React 18 and later
// ship the hook itself, and the host provides React 19.
export { useSyncExternalStore } from "react";
