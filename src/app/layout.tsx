import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ёлка: учёт",
  description: "Учёт ёлок от склада до покупателя",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#047857",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" className="h-full antialiased">
      <body className="min-h-full font-sans">{children}</body>
    </html>
  );
}
