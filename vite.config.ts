import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// O front mora em web/; o build sai pra dist/web, que o Express serve em uso real.
// Em dev, o proxy encaminha /api, /ws e /file pro backend (porta 4717) — assim o
// front usa SEMPRE caminhos relativos e nunca hardcoda porta nem precisa de CORS.
export default defineConfig({
  root: "web",
  plugins: [react()],
  build: {
    outDir: "../dist/web",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/api": { target: "http://127.0.0.1:4717", changeOrigin: true },
      "/file": { target: "http://127.0.0.1:4717", changeOrigin: true },
      "/ws": { target: "ws://127.0.0.1:4717", ws: true },
    },
    // o front importa SÓ tipos de ../src (type-only, sumem no build); liberar o
    // fs pro pai deixa o dev server resolver esses imports sem reclamar.
    fs: { allow: [".."] },
  },
});
