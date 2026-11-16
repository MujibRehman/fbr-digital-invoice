import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  root: "frontend",
  publicDir: false,
  plugins: [react()],
  build: { outDir: "../dist/client", emptyOutDir: true },
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.js"],
    include: ["test/**/*.test.jsx"],
    clearMocks: true,
  },
});
