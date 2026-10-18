import type { Metadata, Viewport } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "旅藏 Stone · 把喜歡的地方留給旅程",
  description: "私人店家收藏、城市地圖與旅行紀錄",
  applicationName: "Stone 旅藏",
  appleWebApp: { capable: true, title: "旅藏", statusBarStyle: "default" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#24584c" };
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
