import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nike Clearance Finder | Search products and store pickup",
  description: "Search Nike products, compare markdowns, save items, and verify store pickup availability with Nike.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
