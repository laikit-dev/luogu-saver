import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const harmonyOsSansScDir = dirname(
    fileURLToPath(import.meta.resolve('harmonyos-sans-sc-webfont-splitted'))
);

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');

    return {
        plugins: [vue()],
        resolve: {
            alias: {
                '@': resolve(__dirname, 'src'),
                '@harmonyos-sans-sc': harmonyOsSansScDir
            }
        },
        base: env.VITE_CDN_URL || '/',

        server: {
            allowedHosts: true,
            proxy: {
                '/api': {
                    // 127.0.0.1 (not localhost): the backend binds IPv4 only, and
                    // localhost may resolve to ::1 where an unrelated process can sit.
                    target: 'http://127.0.0.1:3000',
                    changeOrigin: true,
                    ws: true,
                    rewrite: path => path.replace(/^\/api/, '')
                }
            }
        },
        worker: {
            format: 'es'
        }
    };
});
