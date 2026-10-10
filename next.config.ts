import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
