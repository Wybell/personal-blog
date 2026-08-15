import { getCollection } from "astro:content";

export const THOUGHTS_PER_PAGE = 10;

export async function getThoughtPosts(section: string) {
  return (await getCollection("thoughts", ({ data }) => !data.draft && data.section === section))
    .sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());
}

export function getThoughtPage<T>(items: T[], page: number) {
  const start = (page - 1) * THOUGHTS_PER_PAGE;
  return items.slice(start, start + THOUGHTS_PER_PAGE);
}

export function getThoughtPageCount(total: number) {
  return Math.ceil(total / THOUGHTS_PER_PAGE);
}
