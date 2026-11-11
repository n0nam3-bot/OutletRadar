import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site-info";

export default function sitemap(): MetadataRoute.Sitemap {
  const url = siteUrl();
  if (!url) return [];
  return ["", "/support", "/privacy", "/disclosure"].map((path) => ({ url: `${url}${path}`, changeFrequency: "monthly" as const, priority: path === "" ? 1 : 0.3 }));
}
