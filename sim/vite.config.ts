import { defineConfig, type Plugin } from 'vite';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Serves ROM images to the simulator: /roms/rev4.bin (stock, from tools/rom/build) and
// /roms/neov8.bin (our firmware, from firmware/build). Nothing is bundled or published.
function roms(): Plugin {
  const dirs = [join(__dirname, '../tools/rom/build'), join(__dirname, '../firmware/build')];
  return {
    name: 'neov8-roms',
    configureServer(server) {
      server.middlewares.use('/roms', (req, res, next) => {
        const name = (req.url ?? '').replace(/^\//, '').split('?')[0];
        if (!/^[\w.-]+\.bin$/.test(name)) return next();
        const file = dirs.map((d) => join(d, name)).find((f) => existsSync(f));
        if (!file) { res.statusCode = 404; res.end('ROM not built'); return; }
        res.setHeader('Content-Type', 'application/octet-stream');
        res.end(readFileSync(file));
      });
    },
  };
}

export default defineConfig({
  root: __dirname,
  plugins: [roms()],
  server: { port: 5173, fs: { allow: ['..'] } },
  build: { outDir: 'dist', emptyOutDir: true },
});
