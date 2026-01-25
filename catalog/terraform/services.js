/**
 * backend/catalog/services.js
 *
 * MASTER SERVICE REGISTRY (SSOT)
 * - Loads services directly from new_services.json (User Defined SSOT)
 * - Provides access to services map and pricing metadata
 */

'use strict';

const fs = require('fs');
const path = require('path');

// Load user-defined SSOT
const servicesPath = path.join(__dirname, '../new_services.json');
console.log(`[DEBUG] servicesPath resolved to: ${servicesPath}`);
let rawData;
try {
    rawData = JSON.parse(fs.readFileSync(servicesPath, 'utf8'));
} catch (err) {
    console.error(`ERROR: Could not load new_services.json from ${servicesPath}`, err);
    // Fallback or empty if critical file is missing
    rawData = { services: [] };
}

const servicesList = rawData.services || [];
const services = Object.create(null);

// Index by service_id
for (const svc of servicesList) {
    if (svc.service_id) {
        services[svc.service_id] = Object.freeze(svc);
    }
}

// Attach metadata
const meta = rawData.meta || {};
Object.defineProperty(services, '__meta', { value: meta, enumerable: false });
Object.defineProperty(services, '__raw', { value: servicesList, enumerable: false });

console.log(`✅ Service Catalog Loaded (New SSOT): ${Object.keys(services).length} services.`);

module.exports = services;
