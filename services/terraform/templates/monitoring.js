'use strict';

const { renderStandardVariables, generateMinimalModule } = require('./base');

function monitoringModule(provider) {
    const p = provider.toLowerCase();

    return generateMinimalModule(p, 'monitoring');
}

module.exports = { monitoringModule };
