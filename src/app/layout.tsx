import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toast";

const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex-sans", display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-plex-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Oxina Operations", template: "%s — Oxina Operations" },
  description: "Showroom, workshop and stock operations for Oxina Groups branches.",
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { themeColor: "#14213d", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" className={`${sans.variable} ${mono.variable}`}>
      <body className="min-h-dvh">
        <Toaster>{children}</Toaster>
      </body>
    </html>
  );
}
