// @ts-ignore: allow side-effect css imports handled by Next.js
import "./globals.css";  // global utama
// @ts-ignore: allow side-effect css imports handled by Next.js
import "./auth.css";     // css auth (sekarang satu folder dgn layout)
// @ts-ignore: allow side-effect css imports handled by Next.js
import "./styles/voice.css";
import { Inter } from "next/font/google";

import { ReactNode } from "react";
import LayoutClient from "./LayoutClient";

const inter = Inter({ subsets: ["latin"] });

export const metadata = {
  title: "PathoNote",
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
