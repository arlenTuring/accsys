import type { NextConfig } from 'next';
import { STATIC_SECURITY_HEADERS } from './src/lib/security-headers';

const nextConfig: NextConfig = {
  // Docker image build sets NEXT_OUTPUT=standalone; `next dev` / `next start` are unaffected.
  output: process.env.NEXT_OUTPUT === 'standalone' ? 'standalone' : undefined,
  poweredByHeader: false,
  transpilePackages: ['pdfjs-dist'],
  // Served by src/app/docs/[file]/route.ts after the session check; read at runtime.
  outputFileTracingIncludes: {
    '/docs/[file]': ['./assets/docs/*.pdf'],
  },
  experimental: {
    serverActions: {
      // Attachments are up to 10 MB (plus multipart overhead); keep the reverse
      // proxy's client_max_body_size in line with this.
      bodySizeLimit: '11mb',
    },
  },
  async headers() {
    return [{ source: '/:path*', headers: STATIC_SECURITY_HEADERS }];
  },
};

export default nextConfig;
