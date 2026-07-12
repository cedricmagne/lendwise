import type { MetadataRoute } from 'next'

const BASE_URL = 'https://lendwise.fi'

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { path: '/', priority: 1 },
    { path: '/supply', priority: 0.9 },
    { path: '/borrow', priority: 0.9 },
    { path: '/portfolio', priority: 0.8 },
    { path: '/support', priority: 0.5 },
  ].map(({ path, priority }) => ({
    url: `${BASE_URL}${path === '/' ? '' : path}`,
    changeFrequency: 'daily',
    priority,
  }))
}
