import { defineConfig, loadEnv, type Plugin } from 'vite';
import vue from '@vitejs/plugin-vue';
import { realpathSync } from 'fs';
import { resolve } from 'path';

/** Strip legacy .woff and .ttf KaTeX font fallbacks before CSS bundling; modern browsers use .woff2. */
function stripLegacyKatexFonts(): Plugin {
    return {
        name: 'strip-legacy-katex-fonts',
        enforce: 'pre',
        transform(code, id) {
            const normalizedId = id.split('?', 1)[0].replace(/\\/g, '/');
            if (
                !normalizedId.endsWith('katex/dist/katex.min.css') &&
                !normalizedId.endsWith('katex/dist/katex.css')
            ) {
                return null;
            }
            return {
                code: code.replace(
                    /,\s*url\([^)]+\.(?:woff|ttf)\)\s*format\(["'](?:woff|truetype)["']\)/g,
                    ''
                ),
                map: null
            };
        }
    };
}

export default defineConfig(({ mode }) => {
    // Normalize symlinked/junction working directories so esbuild and Rollup agree with Vite's
    // `process.cwd()` during dependency optimization and HTML asset emission.
    const realCwd = realpathSync(process.cwd());
    if (realCwd !== process.cwd()) {
        process.chdir(realCwd);
    }

    const env = loadEnv(mode, process.cwd(), '');
    return {
        plugins: [stripLegacyKatexFonts(), vue()],
        resolve: {
            alias: {
                '@': resolve(__dirname, 'src')
            }
        },
        base: env.VITE_CDN_URL || '/',
        build: {
            rollupOptions: {
                output: {
                    manualChunks(id) {
                        const normalized = id.replace(/\\/g, '/');
                        if (!normalized.includes('/node_modules/')) return;
                        if (/\/node_modules\/(vue|@vue|vue-router)\//.test(normalized)) {
                            return 'vendor-vue';
                        }
                        if (
                            /\/node_modules\/(css-render|@css-render|vooks|seemly|evtd|vdirs|treemate)\//.test(
                                normalized
                            )
                        ) {
                            return 'vendor-ui-core';
                        }
                        if (/\/node_modules\/(axios|dompurify|uuid)\//.test(normalized)) {
                            return 'vendor-utils';
                        }
                        if (
                            /\/node_modules\/(socket\.io-client|engine\.io-client|@socket\.io)\//.test(
                                normalized
                            )
                        ) {
                            return 'vendor-socket';
                        }
                        if (/\/node_modules\/(codemirror|@codemirror|@lezer)\//.test(normalized)) {
                            return 'vendor-codemirror';
                        }
                    }
                }
            }
        },

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
