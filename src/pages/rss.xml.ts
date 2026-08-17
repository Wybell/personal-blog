import { getCollection } from "astro:content";
import { siteConfig } from "../site.config";

export async function GET() {
  const [blogPosts, lifePosts, thoughtPosts] = await Promise.all([
    getCollection("blog", ({ data }) => !data.draft),
    getCollection("life", ({ data }) => !data.draft),
    getCollection("thoughts", ({ data }) => !data.draft),
  ]);
  const posts = [
    ...blogPosts.map((post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.pubDate,
      href: `/posts/${post.id}/`,
    })),
    ...lifePosts.map((post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.pubDate,
      href: `/life/${post.data.section}/${post.id}/`,
    })),
    ...thoughtPosts.map((post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.pubDate,
      href: `/thoughts/${post.data.section}/${post.id}/`,
    })),
  ].sort((a, b) => b.pubDate.valueOf() - a.pubDate.valueOf());
  const items = posts.map((post) => `
    <item>
      <title>${escapeXml(post.title)}</title>
      <description>${escapeXml(post.description)}</description>
      <link>${escapeXml(`${siteConfig.url}${post.href}`)}</link>
      <guid>${escapeXml(`${siteConfig.url}${post.href}`)}</guid>
      <pubDate>${post.pubDate.toUTCString()}</pubDate>
    </item>`).join("");

  return new Response(`<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0">
  <channel>
    <title>${escapeXml(siteConfig.title)}</title>
    <description>${escapeXml(siteConfig.description)}</description>
    <link>${escapeXml(siteConfig.url)}</link>
    <language>zh-CN</language>${items}
  </channel>
</rss>`, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
}

function escapeXml(value: string) {
  return value.replace(/[<>&'\"]/g, (character) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[character] ?? character);
}
