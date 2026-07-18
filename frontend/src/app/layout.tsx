// @ts-ignore: allow side-effect css imports handled by Next.js
import "./globals.css";  // global utama
// @ts-ignore: allow side-effect css imports handled by Next.js
import "./auth.css";     // css auth (sekarang satu folder dgn layout)
import { Inter } from "next/font/google";

import { ReactNode } from "react";
import LayoutClient from "./LayoutClient";

const inter = Inter({ subsets: ["latin"] });

export const metadata = {
  title: "Voice to Text",
  description: "Realtime transcription with Next.js + TypeScript",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="id">
      <body className={inter.className}>
        <LayoutClient>{children}</LayoutClient>
      </body>
    </html>
  );
}
