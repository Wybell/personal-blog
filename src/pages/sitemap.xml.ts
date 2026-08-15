import { getCollection } from "astro:content";
import { projects, siteConfig } from "../site.config";

export async function GET() {
  const posts = await getCollection("blog", ({ data }) => !data.draft);
  const paths = [
    "/",
    "/posts/",
    "/projects/",
    "/experience/",
    "/about/",
    ...projects.map((project) => `/projects/${project.slug}/`),
    ...posts.map((post) => `/posts/${post.id}/`),
  ];
  const urls = paths.map((path) => `<url><loc>${siteConfig.url}${path}</loc></url>`).join("");

  return new Response(
    `<?xml version="1.0" encoding="UTF-8" ?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`,
    { headers: { "Content-Type": "application/xml; charset=utf-8" } },
  );
}
