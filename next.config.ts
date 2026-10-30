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
    // Next 16.4 defaults this to "security", which stops `next dev` under Cursor
    // agents with an upgrade nudge. Keep upgrades intentional (package.json /
    // CI), not an interactive interrupt during local start.
    agentUpgrade: false,
    // proxy.ts clones the request body (default 10MB). Without this, large
    // uploads are truncated → JSON parse 500. (Do not also set middlewareClientMaxBodySize.)
    proxyClientMaxBodySize: '55mb',
    serverActions: {
      // Unified attachment policy default is 50 MB/file. Prefer chunked upload
      // API for large files; keep reverse-proxy client_max_body_size aligned.
      bodySizeLimit: '55mb',
    },
  },
  async headers() {
    return [{ source: '/:path*', headers: STATIC_SECURITY_HEADERS }];
  },
};

export default nextConfig;
