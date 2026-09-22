/**
 * Post-process the single-file build: fold the emitted <script> and
 * <link rel=stylesheet> back into the HTML so `dist-single/` collapses to one
 * portable file.
 *
 *   node scripts/inline.mjs
 */
import { readFileSync, writeFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const OUT = 'dist-single';
const htmlPath = join(OUT, 'index.html');
if (!existsSync(htmlPath)) {
  process.stdout.write(`no ${htmlPath} — run the single-file build first\n`);
  process.exit(1);
}

let html = readFileSync(htmlPath, 'utf8');
const assetDir = join(OUT, 'assets');
const assets = existsSync(assetDir) ? readdirSync(assetDir) : [];

for (const name of assets) {
  const body = readFileSync(join(assetDir, name), 'utf8');
  if (name.endsWith('.css')) {
    html = html.replace(
      new RegExp(`\\s*<link[^>]*href="[^"]*${name}"[^>]*>`, 'g'),
      `\n    <style>\n${body}\n    </style>`,
    );
  } else if (name.endsWith('.js')) {
    // The bundle can contain `</script>` inside string literals; split the tag
    // so the browser's parser cannot terminate the block early.
    const safe = body.replace(/<\/script>/gi, '<\\/script>');
    html = html.replace(
      new RegExp(`\\s*<script[^>]*src="[^"]*${name}"[^>]*></script>`, 'g'),
      `\n    <script type="module">\n${safe}\n    </script>`,
    );
  }
}

// Anything left pointing at ./assets means something did not get inlined.
const leftovers = html.match(/(?:src|href)="[^"]*assets\/[^"]*"/g);
if (leftovers) {
  process.stdout.write(`FAILED: un-inlined references remain:\n  ${leftovers.join('\n  ')}\n`);
  process.exit(1);
}

const single = join(OUT, 'tokenmaxxing.html');
writeFileSync(single, html);
rmSync(assetDir, { recursive: true, force: true });
rmSync(htmlPath, { force: true });

const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
process.stdout.write(`wrote ${single} (${kb} kB, self-contained)\n`);
