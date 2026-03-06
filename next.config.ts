import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  transpilePackages: ['@electric-sql/pglite'],
  images: { unoptimized: true },
  turbopack: {
    root: process.cwd(),
  },
}

export default nextConfig
