// Loads the shared ES module (shared/stats.mjs) from CommonJS. Cached after the first call.
const path = require('path');
const { pathToFileURL } = require('url');

let statsPromise = null;

function loadStats() {
  if (!statsPromise) {
    statsPromise = import(pathToFileURL(path.join(__dirname, '..', 'shared', 'stats.mjs')).href);
  }
  return statsPromise;
}

const DEFAULT_TZ = 'Asia/Riyadh';

module.exports = { loadStats, DEFAULT_TZ };
