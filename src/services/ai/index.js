'use strict';
const config = require('../../config');
const demo = require('./demo');

// Registry penyedia. Tambahkan penyedia baru (mis. model identifikasi hama khusus)
// dengan objek { name, mode, model, supportsImages, analyze() } atau { ..., reply() }.
const providers = {
  vision: { demo: demo.vision, anthropic: () => require('./anthropic').vision, gemini: () => require('./gemini').vision },
  chat: { demo: demo.chat, anthropic: () => require('./anthropic').chat, gemini: () => require('./gemini').chat },
};

// Penyedia hanya aktif bila kuncinya terpasang; bila tidak, kembali ke mode demo.
const keyFor = { anthropic: () => config.ai.anthropicKey, gemini: () => config.ai.geminiKey };

let overrides = {};

function resolve(kind, name) {
  if (overrides[kind]) return overrides[kind];
  const p = providers[kind][name];
  if (!p || (keyFor[name] && !keyFor[name]())) return providers[kind].demo;
  return typeof p === 'function' ? p() : p;
}

module.exports = {
  vision: () => resolve('vision', config.ai.visionProvider),
  chat: () => resolve('chat', config.ai.chatProvider),
  // Untuk pengujian: ganti penyedia sementara.
  _setOverride(kind, impl) { overrides[kind] = impl; },
  _clearOverrides() { overrides = {}; },
};
