'use strict';

const { renderStandardVariables, generateMinimalModule } = require('./base');

function authModule(provider) {
    const p = provider.toLowerCase();

    return generateMinimalModule(p, 'auth');
}

module.exports = { authModule };
