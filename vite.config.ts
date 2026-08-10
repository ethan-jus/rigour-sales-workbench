import { defineConfig, loadEnv } from 'vite';
import type { Plugin } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';
import { networkInterfaces } from 'node:os';

function localLanAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flatMap((items) => items ?? [])
    .filter((item) => !item.internal && String(item.family) === 'IPv4')
    .map((item) => item.address);
}

function requestTracePlugin(): Plugin {
  return {
    name: 'rigour-dev-request-trace',
    apply: 'serve',
    configureServer(server) {
      server.httpServer?.once('listening', () => {
        const address = server.httpServer?.address();
        const port = typeof address === 'object' && address ? address.port : '-';
        const lanAddresses = localLanAddresses();
        console.info('[ViteTrace] server-listening', {
          bindHost: '0.0.0.0',
          port,
          localUrl: `http://localhost:${port}`,
          lanUrls: lanAddresses.map((ip) => `http://${ip}:${port}`),
          hint: '本机使用localhost；手机或飞书WebView使用lanUrls中的地址',
        });
      });

      server.middlewares.use((request, response, next) => {
        const path = (request.url ?? '/').split('?', 1)[0];
        const traceable = path === '/' || path === '/index.html' || path.startsWith('/api/');
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

export function createViteConfig(mode: string) {
  const env = loadEnv(mode, process.cwd(), '');
  const apiTarget = env.VITE_API_TARGET || 'http://localhost:26880';

  return {
    plugins: [vue(), requestTracePlugin()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      // 允许手机和飞书 WebView 通过电脑局域网 IP 访问工作台。
      // 这是监听所有网卡的绑定地址，不是某台服务器的固定IP。
      host: '0.0.0.0',
      port: 5200,
      proxy: {
        '/api': {
          // 只在Vite开发服务器进程内使用；部署到其他服务器时由VITE_API_TARGET覆盖。
          target: apiTarget,
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
  };
}

export default defineConfig(({ mode }) => createViteConfig(mode));
