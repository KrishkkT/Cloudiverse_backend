/**
 * Centralized logic for sanitizing cloud resource names.
 * Ensures compliance with AWS, GCP, and Azure naming rules.
 */

function toAwsName(name) {
    if (!name) return 'default-resource';
    return name
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-") // Only lowercase alphanumeric and hyphens
        .replace(/^-+|-+$/g, "")     // trimming hyphens
        .substring(0, 63);           // Max length
}

function toGcpName(name) {
    if (!name) return 'default-resource';
    return name
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-")
        .replace(/^-+|-+$/g, "")
        .substring(0, 63);
}

function toAzureName(name) {
    if (!name) return 'default-resource';
    return name
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "") // Azure storage accounts often strictly alphanumeric
        .substring(0, 24);          // Storage accounts are max 24 chars
}

function toAzureRgName(name) {
    if (!name) return 'default-rg';
    return name
        .replace(/[^a-zA-Z0-9-._()]/g, "-") // Allow alphanumeric, hyphens, periods, underscores, parens
        .replace(/^-+|-+$/g, "")
        .substring(0, 90);
}

module.exports = {
    toAwsName,
    toGcpName,
    toAzureName,
    toAzureRgName
};
