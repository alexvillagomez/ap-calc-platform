import type { Metadata, Viewport } from "next";
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

// viewport-fit=cover is REQUIRED for env(safe-area-inset-*) to resolve to the
// real device insets on mobile (otherwise they are always 0). Combined with the
// `.pb-safe*` utilities in globals.css this keeps bottom action rows clear of
// the phone browser's bottom toolbar.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ffffff",
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
