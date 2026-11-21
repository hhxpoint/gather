import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, 'dist');
const assets = ['index.html', 'styles.css'];

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

for (const asset of assets) {
  const source = join(root, asset);
  const info = await stat(source);
  if (!info.isFile()) {
    throw new Error(`Expected a static file at ${source}`);
  }
  await cp(source, join(dist, asset));
  console.log(`copied  ${asset.padEnd(12)} ${info.size.toLocaleString('en-US')} bytes`);
}

console.log(`built   ${dist}`);
