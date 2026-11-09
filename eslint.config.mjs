import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/purity': 'warn',
    },
  },
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
