import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const blog = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/blog" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    section: z.enum(["learning", "practice", "project", "experience"]).default("learning"),
    projectSlug: z.string().optional(),
    cover: z.string().optional(),
    coverAlt: z.string().optional(),
    tocImage: z.string().optional(),
    tocImageAlt: z.string().optional(),
    tags: z.array(z.string()).default([]),
    featured: z.boolean().default(false),
    draft: z.boolean().default(false),
  }),
});

const thoughts = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/thoughts" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    section: z.enum(["learning", "work", "life", "retrospective"]),
    cover: z.string().optional(),
    coverAlt: z.string().optional(),
    tocImage: z.string().optional(),
    tocImageAlt: z.string().optional(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
  }),
});

const life = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/life" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    section: z.enum(["daily", "travel", "hobbies", "reading"]),
    cover: z.string().optional(),
    coverAlt: z.string().optional(),
    tocImage: z.string().optional(),
    tocImageAlt: z.string().optional(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
  }),
});

const media = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/media" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    capturedDate: z.coerce.date(),
    type: z.enum(["image", "video"]),
    src: z.string().default(""),
    poster: z.string().optional(),
    location: z.string().optional(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
  }),
});

export const collections = { blog, thoughts, life, media };
