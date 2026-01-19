
const validator = require('../services/core/canonicalValidator');

// Mock data: Pattern requires 'waf', but we exclude it
const mockArchitecture = {
    pattern: 'CONTAINERIZED_WEB_APP',
    services: [
        { name: 'loadbalancer', canonical_type: 'loadbalancer' },
        { name: 'computecontainer', canonical_type: 'computecontainer' },
        { name: 'logging', canonical_type: 'logging' },
        { name: 'monitoring', canonical_type: 'monitoring' },
        { name: 'identityauth', canonical_type: 'identityauth' },
        { name: 'secretsmanagement', canonical_type: 'secretsmanagement' },
        { name: 'dns', canonical_type: 'dns' }
        // MISSING: 'waf'
    ],
    excluded: ['waf'] // 🔥 Excluded explicitly
};

const intent = {};

console.log('--- STARTING VALIDATOR EXCLUSION TEST ---');
try {
    const result = validator.validateAndFixCanonicalArchitecture(mockArchitecture, intent);
    console.log('[PASS] Validation passed with exclusion.');
} catch (error) {
    console.error('[FAIL] Validation failed despite exclusion:', error.message);
    process.exit(1);
}

// Test 2: Fail if missing and NOT excluded
console.log('\n--- STARTING VALIDATOR FAILURE TEST ---');
const failArchitecture = JSON.parse(JSON.stringify(mockArchitecture));
failArchitecture.excluded = []; // clear exclusion

try {
    validator.validateAndFixCanonicalArchitecture(failArchitecture, intent);
    console.error('[FAIL] Validation passed but SHOULD have failed (missing waf).');
    process.exit(1);
} catch (error) {
    console.log('[PASS] Validation correctly failed for missing non-excluded service:', error.message);
}
