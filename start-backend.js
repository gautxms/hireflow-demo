#!/usr/bin/env node
/**
 * Root entry point for Railway deployment
 * Loads the backend server with all middleware and migrations
 */

import('./backend/src/index.js').catch((error) => {
  console.error('[Start Script] Failed to load backend:', error.message)
  process.exit(1)
})
