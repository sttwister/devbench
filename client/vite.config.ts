import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, "VITE_");
  const allowedHosts = env.VITE_ALLOWED_HOSTS
    ? env.VITE_ALLOWED_HOSTS.split(",").map((h) => h.trim())
    : [];

  return {
    plugins: [react()],
    server: {
      port: 5173,
      host: true,
      allowedHosts,
      watch: {
        usePolling: true,
        interval: 500,
      },
      proxy: {
        "/api": "http://localhost:3001",
        "/ws": {
          target: "ws://localhost:3001",
          ws: true,
        },
        "/proxy": {
          target: "http://localhost:3001",
          ws: true,
        },
        "/proxy-mobile": {
          target: "http://localhost:3001",
          ws: true,
        },
      },
    },
  };
});
