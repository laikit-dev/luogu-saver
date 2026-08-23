import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'path';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');

    return {
        plugins: [vue()],
        resolve: {
            alias: {
                '@': resolve(__dirname, 'src')
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
        },

        build: {
            rollupOptions: {
                output: {
                    manualChunks(id) {
                        if (id.includes('node_modules')) {
                            return id.toString().split('node_modules/')[1].split('/')[0].toString();
                        }
                    }
                }
            }
        }
    };
});
