import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import type { APIContext } from 'astro';

export async function GET(context: APIContext) {
  const posts = (await getCollection('blog', ({ data }) => !data.draft))
    .sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());

  return rss({
    title: 'Agentic Experiments',
    description:
      'Building Core Warden with AI agents — automation, agentic workflows, and what happens when you let the machines do the work.',
    site: context.site!,
    items: posts.map(post => ({
      title:       post.data.title,
      pubDate:     post.data.date,
      description: post.data.summary,
      categories:  post.data.tags,
      link:        `/blog/${post.id}/`,
    })),
    customData: '<language>en-gb</language>',
  });
}
