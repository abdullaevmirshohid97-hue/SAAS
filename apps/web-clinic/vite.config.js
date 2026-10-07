import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import { execSync } from 'node:child_process';
import path from 'node:path';
// Har build'ning noyob identifikatori. Ilova o'zidagi __APP_BUILD__ ni serverdagi
// /version.json bilan solishtiradi: farq qilsa — "Yangi versiya joylandi →
// Yangilash" banneri (brauzer ham, serverdan yuklanadigan desktop ham).
var BUILD = (function () {
    var sha = '';
    try {
        sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
            .toString()
            .trim();
    }
    catch (_a) {
        // git yo'q (masalan arxivdan build) — faqat vaqt belgisi
    }
    return {
        id: "".concat(sha || 'build', "-").concat(Date.now().toString(36)),
        sha: sha || null,
        built_at: new Date().toISOString(),
    };
})();
function versionFile() {
    return {
        name: 'clary-version-file',
        apply: 'build',
        generateBundle: function () {
            this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify(BUILD) });
        },
    };
}
export default defineConfig({
    plugins: [react(), versionFile()],
    define: {
        __APP_BUILD__: JSON.stringify(BUILD.id),
    },
    resolve: {
        alias: { '@': path.resolve(__dirname, 'src') },
    },
    server: { port: 5173, host: true },
    build: {
        sourcemap: true,
        target: 'es2022',
        rollupOptions: {
            output: {
                manualChunks: {
                    supabase: ['@supabase/supabase-js'],
                    query: ['@tanstack/react-query'],
                    i18n: ['i18next', 'react-i18next'],
                },
            },
        },
        chunkSizeWarningLimit: 800,
    },
});
