import { buildSoftwareApplicationJsonLd } from "@/lib/seo/softwareApplicationJsonLd";
import { getSiteUrl } from "@/lib/site";

export function SoftwareApplicationJsonLd() {
  const siteUrl = getSiteUrl();
  const jsonLd = buildSoftwareApplicationJsonLd(siteUrl);
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  );
}
