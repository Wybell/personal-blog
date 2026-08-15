import { getCollection } from "astro:content";

export const LIFE_POSTS_PER_PAGE = 10;
export const LIFE_MEDIA_PER_PAGE = 12;

export const lifeSectionLabels = {
  daily: "日常记录",
  travel: "旅行见闻",
  hobbies: "兴趣爱好",
  reading: "阅读观影",
} as const;

export type LifeArticleSection = keyof typeof lifeSectionLabels;

export async function getLifePosts(section: string) {
  return (await getCollection("life", ({ data }) => !data.draft && data.section === section))
    .sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());
}

export async function getLifeMedia() {
  return (await getCollection("media", ({ data }) => !data.draft))
    .sort((a, b) => b.data.capturedDate.valueOf() - a.data.capturedDate.valueOf());
}

export function getLifePage<T>(items: T[], page: number) {
  const start = (page - 1) * LIFE_POSTS_PER_PAGE;
  return items.slice(start, start + LIFE_POSTS_PER_PAGE);
}

export function getLifePageCount(total: number) {
  return Math.ceil(total / LIFE_POSTS_PER_PAGE);
}

export function getMediaPage<T>(items: T[], page: number) {
  const start = (page - 1) * LIFE_MEDIA_PER_PAGE;
  return items.slice(start, start + LIFE_MEDIA_PER_PAGE);
}

export function getMediaPageCount(total: number) {
  return Math.ceil(total / LIFE_MEDIA_PER_PAGE);
}
