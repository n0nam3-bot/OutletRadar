import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Outlet Radar | Multi-brand product discovery and price comparison",
  description: "Discover sneakers, apparel and accessories across brands and marketplaces. Compare retailer listings, prices and product availability.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        {/* Impact requires the verification token in the nonstandard `value` attribute.
            The type intersection preserves that exact attribute while satisfying React's
            MetaHTMLAttributes type definition. */}
        <meta
          {...({
            name: "impact-site-verification",
            value: "a7ff6136-4263-45f8-ac76-8ff5dca43211",
          } as React.MetaHTMLAttributes<HTMLMetaElement> & { value: string })}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
