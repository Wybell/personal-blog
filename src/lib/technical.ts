import { getCollection } from "astro:content";

export const TECHNICAL_POSTS_PER_PAGE = 10;

export const technicalSectionLabels = {
  learning: "技术学习",
  practice: "工程实践",
} as const;

export async function getTechnicalPosts(section: string) {
  return (await getCollection("blog", ({ data }) => !data.draft && data.section === section))
    .sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());
}

export function getTechnicalPage<T>(items: T[], page: number) {
  const start = (page - 1) * TECHNICAL_POSTS_PER_PAGE;
  return items.slice(start, start + TECHNICAL_POSTS_PER_PAGE);
}

export function getTechnicalPageCount(total: number) {
  return Math.ceil(total / TECHNICAL_POSTS_PER_PAGE);
}
