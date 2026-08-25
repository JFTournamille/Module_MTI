import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  // En développement et en prévisualisation, l'API tourne à part ; en
  // production c'est le reverse-proxy nginx du conteneur web qui route /api
  // vers le service api (cf. web/nginx.conf).
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: { '/api': { target: process.env.API_URL ?? 'http://localhost:3000', changeOrigin: true } }
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    proxy: { '/api': { target: process.env.API_URL ?? 'http://localhost:3000', changeOrigin: true } }
  }
})
