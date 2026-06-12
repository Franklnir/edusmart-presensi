const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const nodeModules = path.join(projectRoot, 'node_modules');
const rootExpoAsset = path.join(nodeModules, 'expo-asset');
const nestedExpoAsset = path.join(nodeModules, 'expo', 'node_modules', 'expo-asset');

if (fs.existsSync(rootExpoAsset)) {
  process.exit(0);
}

if (!fs.existsSync(nestedExpoAsset)) {
  throw new Error('expo-asset tidak ditemukan. Jalankan npm ci sebelum membuat bundle Android.');
}

fs.symlinkSync(
  path.relative(path.dirname(rootExpoAsset), nestedExpoAsset),
  rootExpoAsset,
  process.platform === 'win32' ? 'junction' : 'dir'
);
