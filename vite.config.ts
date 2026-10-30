import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { createLocalApi } from './scripts/local-api.ts';

function localApi(): Plugin {
  return {
    name: 'local-arcade-api',
    apply: 'serve',
    configureServer(server) {
      const api = createLocalApi(resolve('.cache/arcade-dev.sqlite'));
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
