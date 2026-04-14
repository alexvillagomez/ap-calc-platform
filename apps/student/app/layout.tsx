import type { Metadata } from "next";
import { Toaster } from "sonner";
import "katex/dist/katex.min.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "AP Calculus Practice",
  description: "Student practice portal for AP Calculus AB",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased bg-gray-50 text-gray-900">
        {children}
        <Toaster position="bottom-right" />
      </body>
    </html>
  );
}
