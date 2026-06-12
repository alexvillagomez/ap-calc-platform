import type { Metadata } from "next";
import { Toaster } from "sonner";
import { Analytics } from "@vercel/analytics/next";
import "katex/dist/katex.min.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lodera — Learn anything, addictively.",
  description: "Adaptive learning for math and MCAT. Get better every question.",
  applicationName: "Lodera",
  openGraph: {
    title: "Lodera — Learn anything, addictively.",
    siteName: "Lodera",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased bg-gray-50 text-gray-900">
        {children}
        <Toaster position="bottom-right" />
        <Analytics />
      </body>
    </html>
  );
}
