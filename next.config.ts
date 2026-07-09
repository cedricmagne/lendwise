import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return [
      // VitePress docs — separate Vercel project proxied under /docs (SEO: same domain)
      {
        source: '/docs/:path*',
        destination: 'https://docs-lendwise.vercel.app/:path*',
      },
      {
        source: '/ingest/static/:path*',
        destination: 'https://eu-assets.i.posthog.com/static/:path*',
      },
      {
        source: '/ingest/array/:path*',
        destination: 'https://eu-assets.i.posthog.com/array/:path*',
      },
      {
        source: '/ingest/:path*',
        destination: 'https://eu.i.posthog.com/:path*',
      },
    ]
  },
  // Turbopack configuration - stub out Node.js-only packages
  turbopack: {
    resolveAlias: {
      // Use pino's browser build which doesn't require thread-stream
      pino: 'pino/browser',
    },
  },
  // Exclude markdown files from being processed
  pageExtensions: ['tsx', 'ts', 'jsx', 'js'],
  // Exclude Node.js-only packages from being bundled (works with Turbopack)
  serverExternalPackages: ['pino-pretty', 'thread-stream'],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'coin-images.coingecko.com',
        pathname: '/**',
      },
    ],
  },
  webpack: (config) => {
    // Externaliser les modules Node.js qui ne doivent pas être bundlés
    config.externals.push('pino-pretty', 'lokijs', 'encoding')

    // Désactiver les polyfills Node.js inutiles
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
    }

    // Ignore markdown files to prevent bundling errors
    config.module.rules.push({
      test: /\.md$/,
      type: 'javascript/auto',
      loader: 'ignore-loader',
    })

    // Use pino's browser build to avoid Node.js-only dependencies
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      pino: 'pino/browser',
    }

    return config
  },
}

export default nextConfig
