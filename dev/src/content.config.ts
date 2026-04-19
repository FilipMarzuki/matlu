import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const blog = defineCollection({
  // Astro v6 uses the loader API — glob() finds all .md files in the blog folder.
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/blog' }),
  schema: z.object({
    title:   z.string(),
    date:    z.coerce.date(),
    summary: z.string(),
    tags:    z.array(z.string()).default([]),
    draft:   z.boolean().default(false),
  }),
});

export const collections = { blog };
