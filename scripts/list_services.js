const services = require('../catalog/terraform/services');

const list = Object.values(services).map(s => ({
    service_id: s.id,
    name: s.name,
    domain: s.domain,
    category: s.category,
    terraform_supported: s.terraform_supported,
    providers: {
        aws: !!s.mappings?.aws,
        gcp: !!s.mappings?.gcp,
        azure: !!s.mappings?.azure
    }
}));

const fs = require('fs');
// Write JSON to file
fs.writeFileSync('temp_services.json', JSON.stringify(list, null, 2));

console.log(`\nTotal Services: ${list.length}`);
