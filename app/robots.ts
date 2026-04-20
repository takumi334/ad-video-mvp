import type { MetadataRoute } from "next";
import { getSiteUrl, PRODUCTION_SITE_ORIGIN } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  const base = getSiteUrl();
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin/"],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    /** Production host hint for crawlers (mv.gegenpress.app). */
    host: PRODUCTION_SITE_ORIGIN.replace(/^https:\/\//, ""),
  };
}
