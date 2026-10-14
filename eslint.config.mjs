import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    '.next/**',
    'node_modules/**',
    'supabase/**',
    '.worktrees/**',
    '.claude/worktrees/**',
    'next-env.d.ts',
    // Vendored, minified pdfjs-dist worker (copied from node_modules); not our source.
    'public/pdf.worker.min.mjs',
  ]),
]);
