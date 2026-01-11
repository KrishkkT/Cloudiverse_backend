'use strict';

const { renderStandardVariables, generateMinimalModule } = require('./base');

function loggingModule(provider) {
    const p = provider.toLowerCase();

    return generateMinimalModule(p, 'logging');
}

module.exports = { loggingModule };
