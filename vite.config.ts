import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { resolveLocalCardSources } from './scripts/turnlume-local-card-catalog.js';

function safeSessionId(value: unknown): string {
  const raw = typeof value === 'string' && value.trim() ? value.trim() : `session_${Date.now()}`;
  return raw.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 96);
}

export default defineConfig(({ mode }) => {
  const trackerBuild = mode === 'tracker';
  return {
  plugins: [
    react(),
    {
      name: 'human-play-recorder',
      configureServer(server) {
        const localCardDatabase = path.join(os.homedir(), 'Library/Application Support/com.pokemon.pokemontcgl/config-cache');
        const localCardArt = path.join(os.homedir(), 'Library/Caches/com.isaiahw.matchlens/card-art');

        server.middlewares.use('/api/turnlume/card-art', (req, res) => {
          const fileName = path.basename(decodeURIComponent(req.url || '').replace(/^\//, ''));
          if (req.method !== 'GET' || !/^[a-zA-Z0-9_.-]+\.png$/.test(fileName)) {
            res.statusCode = req.method === 'GET' ? 400 : 405;
            res.end();
            return;
          }
          const artPath = path.join(localCardArt, fileName);
          if (!fs.existsSync(artPath)) {
            res.statusCode = 404;
            res.end();
            return;
          }
          res.statusCode = 200;
          res.setHeader('content-type', 'image/png');
          res.setHeader('cache-control', 'public, max-age=3600');
          fs.createReadStream(artPath).pipe(res);
        });

        server.middlewares.use('/api/turnlume/card-sources', (req, res) => {
          if (req.method !== 'POST') {
            res.statusCode = 405;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ error: 'method_not_allowed' }));
            return;
          }
          let body = '';
          req.setEncoding('utf8');
          req.on('data', (chunk) => { body += chunk; });
          req.on('end', () => {
            try {
              const cardIds = JSON.parse(body)?.cardIds;
              if (!Array.isArray(cardIds) || cardIds.some((id) => typeof id !== 'string')) throw new Error('cardIds must be an array of strings');
              const cards = resolveLocalCardSources(localCardDatabase, localCardArt, cardIds);
              res.statusCode = 200;
              res.setHeader('content-type', 'application/json');
              res.setHeader('cache-control', 'no-store');
              res.end(JSON.stringify(cards));
            } catch (error) {
              res.statusCode = 400;
              res.setHeader('content-type', 'application/json');
              res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
            }
          });
        });

        server.middlewares.use('/api/turnlume/recent-operations', (req, res) => {
          if (req.method !== 'GET') {
            res.statusCode = 405;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ error: 'method_not_allowed' }));
            return;
          }
          try {
            const capturePath = path.join(os.homedir(), 'Library/Application Support/com.isaiahw.matchlens/capture/operations.jsonl');
            const operations = fs.readFileSync(capturePath, 'utf8')
              .split('\n')
              .filter(Boolean)
              .slice(-5_000)
              .map((line) => JSON.parse(line));
            res.statusCode = 200;
            res.setHeader('content-type', 'application/json');
            res.setHeader('cache-control', 'no-store');
            res.end(JSON.stringify(operations));
          } catch (error) {
            res.statusCode = 404;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
          }
        });

        server.middlewares.use('/api/human-play/session', (req, res) => {
          if (req.method !== 'POST') {
            res.statusCode = 405;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: 'method_not_allowed' }));
            return;
          }

          let body = '';
          req.setEncoding('utf8');
          req.on('data', (chunk) => {
            body += chunk;
            if (body.length > 128 * 1024 * 1024) {
              res.statusCode = 413;
              res.setHeader('content-type', 'application/json');
              res.end(JSON.stringify({ ok: false, error: 'payload_too_large' }));
              req.destroy();
            }
          });
          req.on('end', () => {
            try {
              const payload = JSON.parse(body);
              if (payload?.schema !== 'pokemon-tcg-ai/human-play-v1') {
                throw new Error('unsupported human play schema');
              }

              const outDir = path.resolve(process.cwd(), 'data/human/raw');
              fs.mkdirSync(outDir, { recursive: true });
              const sessionId = safeSessionId(payload.sessionId);
              const outPath = path.join(outDir, `${sessionId}.json`);
              fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`);

              res.statusCode = 200;
              res.setHeader('content-type', 'application/json');
              res.end(JSON.stringify({
                ok: true,
                path: path.relative(process.cwd(), outPath),
                decisions: Array.isArray(payload.decisions) ? payload.decisions.length : 0,
              }));
            } catch (error) {
              res.statusCode = 400;
              res.setHeader('content-type', 'application/json');
              res.end(JSON.stringify({
                ok: false,
                error: error instanceof Error ? error.message : String(error),
              }));
            }
          });
        });
      },
    },
    ...(trackerBuild ? [{
      name: 'trace-tracker-assets',
      closeBundle() {
        fs.cpSync(
          path.resolve(process.cwd(), 'public/tracker-assets'),
          path.resolve(process.cwd(), 'dist/ui/tracker-assets'),
          { recursive: true },
        );
      },
    }] : []),
  ],
  publicDir: trackerBuild ? false : 'public',
  root: '.',
  build: {
    outDir: 'dist/ui',
    rollupOptions: {
      input: trackerBuild
        ? { tracker: path.resolve(process.cwd(), 'tracker.html') }
        : {
            viewer: path.resolve(process.cwd(), 'index.html'),
            tracker: path.resolve(process.cwd(), 'tracker.html'),
          },
    },
  },
  server: {
    port: 3000,
  },
  resolve: {
    // Allow .js imports to resolve to .ts files (Node16 moduleResolution compat)
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
  },
  };
});
