import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { createLocalApi } from './scripts/local-api.ts';

function localApi(): Plugin {
  return {
    name: 'local-arcade-api',
    apply: 'serve',
    configureServer(server) {
      const ownerPreview = process.env.TG_GAMES_DEV_OWNER === '1';
      const databaseName = process.env.TG_GAMES_DEV_DATABASE;
      if (databaseName && !/^[a-zA-Z0-9_-]+\.sqlite$/.test(databaseName))
        throw new Error('Dev database must be a filename inside .cache');
      const api = createLocalApi(
        resolve(
          '.cache',
          databaseName ?? (ownerPreview ? 'arcade-admin-dev.sqlite' : 'arcade-dev.sqlite'),
        ),
        ownerPreview,
      );
      server.middlewares.use('/__dev/rpc', (req, res) => {
        void api.handle(req, res);
      });
      server.httpServer?.once('close', api.close);
    },
  };
}
export default defineConfig({
  plugins: [localApi()],
  build: {
    outDir: 'dist/client',
    rollupOptions: { input: { main: resolve('index.html'), doom: resolve('doom-runtime.html') } },
  },
  server: { host: '127.0.0.1', strictPort: true },
});
