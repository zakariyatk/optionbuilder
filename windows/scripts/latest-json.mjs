// Writes src-tauri/target/release/bundle/latest.json, the file the app's updater reads from the GitHub
// release, from the NSIS installer and its .sig that `tauri build` made. Run after `npm run build`.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'zakariyatk/optionbuilder';
const root = fileURLToPath(new URL('../src-tauri/', import.meta.url));
const { version } = JSON.parse(readFileSync(join(root, 'tauri.conf.json'), 'utf8'));
const bundle = join(root, 'target', 'release', 'bundle');
const installer = `AddStock_${version}_x64-setup.exe`;
const sigFile = join(bundle, 'nsis', `${installer}.sig`);

if (!existsSync(sigFile)) {
  console.error(`No ${sigFile}. Build with TAURI_SIGNING_PRIVATE_KEY set so the installer is signed for updates.`);
  process.exit(1);
}

const latest = {
  version,
  notes: process.env.RELEASE_NOTES || `AddStock ${version}`,
  pub_date: new Date().toISOString(),
  platforms: {
    'windows-x86_64': {
      signature: readFileSync(sigFile, 'utf8').trim(),
      url: `https://github.com/${REPO}/releases/download/windows-v${version}/${installer}`,
    },
  },
};
writeFileSync(join(bundle, 'latest.json'), `${JSON.stringify(latest, null, 2)}\n`);
console.log(`Wrote ${join(bundle, 'latest.json')} for ${version}`);
