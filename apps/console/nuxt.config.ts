import { fileURLToPath } from 'node:url'

const fromHere = (path: string) => fileURLToPath(new URL(path, import.meta.url))

// The console ships as a static SPA (`nuxi generate`) and as a Nuxt layer that
// a host product can `extends` to add its own routing prefix and branding.
export default defineNuxtConfig({
  compatibilityDate: '2026-11-01',
  ssr: false,
  devtools: { enabled: false },
  telemetry: false,
  css: [fromHere('./app/assets/css/console.css')],
  app: {
    head: {
      title: 'OpenFlare',
      htmlAttrs: { lang: 'en' },
      meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1' }],
      link: [
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        {
          rel: 'stylesheet',
          href: 'https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap',
        },
      ],
    },
  },
  // The design relies on browser whitespace semantics (inline gaps and
  // `white-space: pre` code blocks), so templates must not be condensed.
  vue: { compilerOptions: { whitespace: 'preserve' } },
  experimental: { typedPages: true },
  typescript: { strict: true, typeCheck: false },
})
