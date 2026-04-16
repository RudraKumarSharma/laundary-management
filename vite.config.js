import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/orders": "http://127.0.0.1:3000",
      "/dashboard": "http://127.0.0.1:3000",
      "/health": "http://127.0.0.1:3000",
    },
  },
});
