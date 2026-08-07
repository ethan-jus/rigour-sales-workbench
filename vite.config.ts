import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';

function requestTracePlugin(): Plugin {
  return {
    name: 'rigour-dev-request-trace',
    apply: 'serve',
    configureServer(server) {
      server.httpServer?.once('listening', () => {
        const address = server.httpServer?.address();
        const port = typeof address === 'object' && address ? address.port : '-';
        console.info('[ViteTrace] server-listening', {
          host: '0.0.0.0',
          port,
          hint: '手机必须使用本机局域网IP访问，不能使用 localhost',
        });
      });

      server.middlewares.use((request, response, next) => {
        const path = (request.url ?? '/').split('?', 1)[0];
        const traceable =
          path === '/' ||
          path === '/index.html' ||
          path.startsWith('/api/');
        const startedAt = Date.now();
        const requestId = request.headers['x-request-id'];
        response.once('finish', () => {
          if (!traceable && response.statusCode < 400) return;
          console.info('[ViteTrace] request-finished', {
            requestId: typeof requestId === 'string' ? requestId : '-',
            remoteAddress: request.socket.remoteAddress ?? '-',
            host: request.headers.host ?? '-',
            method: request.method ?? '-',
            path,
            status: response.statusCode,
            elapsedMs: Date.now() - startedAt,
          });
        });
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [vue(), requestTracePlugin()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5200,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: 'http://localhost:26880',
        changeOrigin: true,
      },
    },
  },
  css: {
    preprocessorOptions: {
      scss: {
        additionalData: '',
      },
    },
  },
});
