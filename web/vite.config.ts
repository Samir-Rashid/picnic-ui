import { defineConfig } from "vite";

const repoBase = process.env.GH_PAGES_BASE;

export default defineConfig({
  base: repoBase ?? "./",
});