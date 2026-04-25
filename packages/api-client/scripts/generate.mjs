#!/usr/bin/env node
// Regenerate the typed SDK from the API's OpenAPI spec.
// Run: pnpm -F @clary/api-client generate
// In dev, the API must be running on $API_URL (default http://localhost:4000).
//
// For MVP, the SDK is hand-maintained in src/client.ts and this script is a placeholder
// for the later openapi-generator-cli / openapi-typescript integration.

console.info('SDK generation is manual for MVP. Update src/client.ts as endpoints change.');
process.exit(0);
