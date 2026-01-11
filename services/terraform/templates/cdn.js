'use strict';

const { renderStandardVariables, generateMinimalModule } = require('./base');

function cdnModule(provider) {
    const p = provider.toLowerCase();

    return generateMinimalModule(p, 'cdn');
}

module.exports = { cdnModule };
