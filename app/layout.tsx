import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nike Clearance Finder | Search products and store pickup",
  description: "Search Nike products, compare markdowns, save items, and verify store pickup availability with Nike.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <meta name="impact-site-verification" value="a7ff6136-4263-45f8-ac76-8ff5dca43211" />
      </head>
      <body>{children}</body>
    </html>
  );
}
