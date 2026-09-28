import type { Metadata } from "next";
import "@fontsource-variable/public-sans";
import "@fontsource-variable/source-serif-4";
import "./globals.css";

export const metadata: Metadata = {
  title: "Trend tracker",
  description: "Do coins that start trending keep running? A two-week test.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
