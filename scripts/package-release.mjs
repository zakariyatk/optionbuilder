#!/usr/bin/env node
/**
 * Assembles a deployable folder: release/optionbuilder/
 *
 *   index.html, assets/, favicons   ← frontend/dist (built by `npm run build`)
 *   .htaccess                       ← deploy/.htaccess (security + cache headers)
 *   api/                            ← the PHP backend, WITHOUT secrets:
 *                                     no config.php, and data/ holds only its README
 *
 * Upload the contents of release/optionbuilder/ to public_html/optionbuilder/,
 * the folder of the optionbuilder.adddots.com subdomain.
 * Your live config file and data/ on the server are never overwritten because
 * they are not in the release.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'frontend', 'dist');
const out = join(root, 'release', 'optionbuilder');

if (!existsSync(join(dist, 'index.html'))) {
  console.error('frontend/dist is missing — run `npm run build` in frontend/ first.');
  process.exit(1);
}

rmSync(join(root, 'release'), { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// Frontend, minus source maps: they stay local for debugging.
cpSync(dist, out, { recursive: true, filter: (src) => !src.endsWith('.map') });
cpSync(join(root, 'deploy', '.htaccess'), join(out, '.htaccess'));

// Backend, minus anything secret or machine-specific.
const SECRET = new Set(['config.php']);
cpSync(join(root, 'api'), join(out, 'api'), {
  recursive: true,
  filter: (src) => {
    const rel = relative(join(root, 'api'), src).replace(/\\/g, '/');
    if (SECRET.has(rel)) return false;
    if (rel.startsWith('data/') && rel !== 'data/README.txt') return false;
    return true;
  },
});

// Report what ships, so a stray secret would be obvious.
const list = (dir, prefix = '') =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? list(p, `${prefix}${name}/`) : [`${prefix}${name}`];
  });

const files = list(out);
const leaked = files.filter((f) => f === 'api/config.php' || /^api\/data\/(?!README\.txt$)/.test(f));
if (leaked.length) {
  console.error('Refusing to ship secrets:', leaked);
  process.exit(1);
}

console.log(`Release ready: ${relative(root, out)} (${files.length} files)`);
for (const f of files) console.log(`  ${f}`);
