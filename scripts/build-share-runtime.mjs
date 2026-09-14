import { build } from 'esbuild';
await build({
  entryPoints: [new URL('../landing/lib/share-matchup.ts', import.meta.url).pathname],
  outfile: new URL('../landing/lib/generated/share-matchup.mjs', import.meta.url).pathname,
  bundle: true, platform: 'node', format: 'esm', target: 'node24',
});
