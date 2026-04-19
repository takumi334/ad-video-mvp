import type { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";
import { getSiteUrl } from "@/lib/site";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = getSiteUrl();
  const now = new Date();

  const staticEntries: MetadataRoute.Sitemap = [
    {
      url: base,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${base}/upload`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      url: `${base}/videos`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.85,
    },
    {
      url: `${base}/materials`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.75,
    },
    {
      url: `${base}/utattemita-edit`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.9,
    },
    {
      url: `${base}/lyrics-video-maker`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.88,
    },
    {
      url: `${base}/free-mv-maker`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.88,
    },
    {
      url: `${base}/en`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.85,
    },
    {
      url: `${base}/en/lyrics-video-maker`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.82,
    },
    {
      url: `${base}/en/free-mv-maker`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.82,
    },
  ];

  try {
    const videos = await prisma.video.findMany({
      select: { id: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    const videoEntries: MetadataRoute.Sitemap = videos.map((v) => ({
      url: `${base}/videos/${v.id}`,
      lastModified: v.createdAt,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    }));
    return [...staticEntries, ...videoEntries];
  } catch {
    return staticEntries;
  }
}
