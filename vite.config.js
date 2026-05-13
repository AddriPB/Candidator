import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    base: '/Opportunity-Radar/',
    plugins: [react()],
    server: {
      proxy: {
        '/api': env.API_PROXY_TARGET || 'http://127.0.0.1:4173',
      },
    },
  }
})
