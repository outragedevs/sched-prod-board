// Copies app/ to dist/ and stamps the build's git sha into the page (meta + footer).
import { cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';

const sha = process.env.BUILD_SHA || execSync('git rev-parse HEAD').toString().trim();
const dirty = execSync('git status --porcelain -- app').toString().trim();
if (dirty && !process.env.ALLOW_DIRTY) {
  console.error('app/ has uncommitted changes; commit first so the stamped sha matches the build.');
  process.exit(1);
}
rmSync('dist', { recursive: true, force: true });
cpSync('app', 'dist', { recursive: true });
const html = readFileSync('dist/index.html', 'utf8')
  .replace('<meta name="build" content="dev" />', `<meta name="build" content="${sha}" />`)
  .replace('<code data-testid="build-sha">dev</code>', `<code data-testid="build-sha">${sha}</code>`);
if (!html.includes(sha)) throw new Error('build stamp placeholders not found');
writeFileSync('dist/index.html', html);
console.log(`dist/ built for ${sha}`);
