// Let Metro bundle ../shared/stats.mjs (the one stats implementation shared with the web app,
// the bot and the edge functions). DECISIONS.md D8.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);
config.watchFolders = [path.resolve(__dirname, '..', 'shared')];
if (!config.resolver.sourceExts.includes('mjs')) config.resolver.sourceExts.push('mjs');

module.exports = config;
