import type { Metadata } from "next";
import "./globals.css";
import "katex/dist/katex.min.css";
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";
import { ToasterClient } from "./ToasterClient";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "AP Calculus Admin",
  description: "Admin platform for AP Calculus content management",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={cn("font-sans", geist.variable)}>
      <head />
      <body className="antialiased">
        {children}
        <ToasterClient />
      </body>
    </html>
  );
}
