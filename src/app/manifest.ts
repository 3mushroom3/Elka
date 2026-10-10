import type { MetadataRoute } from "next";

// Позволяет добавить систему на главный экран телефона как приложение
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Ёлка: учёт",
    short_name: "Ёлка",
    description: "Учёт ёлок от склада до покупателя",
    start_url: "/",
    display: "standalone",
    background_color: "#f4f6f4",
    theme_color: "#047857",
    lang: "ru",
    icons: [
      { src: "/icon", sizes: "512x512", type: "image/png" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
