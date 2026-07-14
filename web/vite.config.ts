import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    rollupOptions: {
      // This app is still on vite 6 (classic Rollup). @vueuse/core ships /* #__PURE__ */ comments
      // in positions Rollup can't bind to a call expression (e.g. before an object literal), which
      // it warns as INVALID_ANNOTATION. The annotation is inert there — drop that one benign
      // warning and forward everything else. (rolldown-vite apps use build.rollupOptions.checks.)
      onwarn(warning, defaultHandler) {
        if (warning.code === 'INVALID_ANNOTATION') return
        defaultHandler(warning)
      },
      output: {
        // Split heavy vendor libs into their own chunks so no single bundle trips the 500 kB
        // warning and the browser can cache each independently (app code changes more often).
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('reka-ui') || id.includes('@floating-ui')) return 'vendor-reka'
          if (id.includes('@lucide') || id.includes('lucide')) return 'vendor-icons'
          if (id.includes('vue-i18n') || id.includes('@intlify')) return 'vendor-i18n'
          if (id.includes('@vueuse')) return 'vendor-vueuse'
          return 'vendor'
        },
      },
    },
  },
  server: {
    // PORT env wins so parallel dev instances (e.g. two chat sessions) can coexist
    port: Number(process.env.PORT) || 5173,
    strictPort: false,
  },
})
