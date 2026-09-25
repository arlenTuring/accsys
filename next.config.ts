import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Docker image build sets NEXT_OUTPUT=standalone; `next dev` / `next start` are unaffected.
  output: process.env.NEXT_OUTPUT === 'standalone' ? 'standalone' : undefined,
  transpilePackages: ['pdfjs-dist'],
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      canvas: false,
    };
    return config;
  },
};

export default nextConfig;
