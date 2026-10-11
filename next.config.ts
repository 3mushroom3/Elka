import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Отдельная папка сборки позволяет поднять второй, проверочный экземпляр рядом с рабочим
  distDir: process.env.ELKA_DIST_DIR || ".next",
  experimental: {
    // Фото списаний сжимаются на телефоне, запас оставлен для несжатых снимков
    serverActions: { bodySizeLimit: "6mb" },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
