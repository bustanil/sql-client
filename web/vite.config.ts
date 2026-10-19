import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const api = `http://${process.env.SQLC_ADDR || "127.0.0.1:53124"}`;

export default defineConfig({
  plugins: [react()],
  base: "./",
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/health": api,
      "/connections": api,
      "/sessions": api,
    },
  },
});
