import { getCollection } from "astro:content";
import { projects, sectionNavigation, siteConfig } from "../site.config";

export async function GET() {
  const [blogPosts, lifePosts, thoughtPosts, mediaItems] = await Promise.all([
    getCollection("blog", ({ data }) => !data.draft),
    getCollection("life", ({ data }) => !data.draft),
    getCollection("thoughts", ({ data }) => !data.draft),
    getCollection("media", ({ data }) => !data.draft),
  ]);
  const sectionPaths = [
    "/",
    ...sectionNavigation.technical.map((item) => item.href),
    ...sectionNavigation.life.map((item) => item.href),
    ...sectionNavigation.thoughts.map((item) => item.href),
    ...sectionNavigation.about.map((item) => item.href),
    ...projects.map((project) => `/projects/${project.slug}/`),
    ...blogPosts.map((post) => `/posts/${post.id}/`),
    ...lifePosts.map((post) => `/life/${post.data.section}/${post.id}/`),
    ...thoughtPosts.map((post) => `/thoughts/${post.data.section}/${post.id}/`),
    ...mediaItems.map((item) => `/life/media/${item.id}/`),
  ];
  const paths = [...new Set(sectionPaths)];
  const urls = paths.map((path) => `<url><loc>${escapeXml(`${siteConfig.url}${path}`)}</loc></url>`).join("");

  return new Response(
    `<?xml version="1.0" encoding="UTF-8" ?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`,
    { headers: { "Content-Type": "application/xml; charset=utf-8" } },
  );
}

function escapeXml(value: string) {
  return value.replace(/[<>&'\"]/g, (character) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[character] ?? character);
}
