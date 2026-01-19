/**
 * backend/catalog/mappings/index.js
 * Aggregates all mapping exports for convenient access.
 */
'use strict';

const cloud = require('./cloud');
const capabilities = require('./capabilities');
const axes = require('./axes');

module.exports = {
    // Cloud provider mappings
    ...cloud,

    // Capabilities mappings
    ...capabilities,

    // Axes mappings
    ...axes
};
