import * as esbuild from 'esbuild';

void (async () => {
  await esbuild.build({
    entryPoints: ['src/cli.ts'],
    bundle: true,
    platform: 'node',
    target: 'node18',
    outfile: 'dist/cli.js',
    format: 'cjs',
    banner: {
      js: '#!/usr/bin/env node',
    },
    external: [],
  });
})();
