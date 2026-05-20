import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'

function resolveGitCommitHash() {
  try {
    return execSync('git rev-parse --short=12 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return 'unknown'
  }
}

const BUILD_COMMIT_HASH = resolveGitCommitHash()
const BUILD_ID = process.env.VITE_BUILD_ID || BUILD_COMMIT_HASH

export default defineConfig({
  define: {
    'import.meta.env.VITE_GIT_COMMIT_HASH': JSON.stringify(BUILD_COMMIT_HASH),
    'import.meta.env.VITE_BUILD_ID': JSON.stringify(BUILD_ID),
  },
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        credentials: 'include',
        rewrite: (path) => path,
      },
    },
  },
})
