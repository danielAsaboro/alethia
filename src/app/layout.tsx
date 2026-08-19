import type { Metadata } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";
import "./globals.css";

const syne = localFont({
  src: "./fonts/Syne-Variable.ttf",
  variable: "--font-syne",
  weight: "400 800",
});

export const metadata: Metadata = {
  title: "SourceTruce — Enterprise evidence court",
  description:
    "A provenance- and coverage-aware enterprise ontology built on HydraDB.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${syne.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
