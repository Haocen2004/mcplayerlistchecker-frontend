import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MC Server Monitor",
  description: "Minecraft server player and TPS dashboard"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
