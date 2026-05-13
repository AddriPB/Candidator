#!/usr/bin/env node
/**
 * Legacy entrypoint kept for humans/scripts that still call scripts/fetch-jobs.js.
 * Opportunity Radar V1 uses the local scheduler and `npm run scan:once`.
 */
import '../server/cli/scan-once.js'
