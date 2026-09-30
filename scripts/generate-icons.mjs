/**
 * Regenerates the Windows icon set in resources/ from pure primitives.
 *
 * The generated files are committed to the repository so build machines do
 * NOT need ImageMagick. Run this script only when the branding changes:
 *
 *   npm run icons
 *
 * Requires ImageMagick's `convert` on PATH (Linux/macOS) or `magick`
 * (Windows). Output: icon-1024.png, icon-512.png, icon-256.png, icon.ico.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const resources = join(root, 'resources');
mkdirSync(resources, { recursive: true });

function convertCmd() {
  const win = process.platform === 'win32';
  if (win) return { cmd: 'magick', args: [] };
  const candidates = ['/usr/bin/convert', '/usr/local/bin/convert', 'convert'];
  for (const c of candidates) {
    if (c === 'convert' || existsSync(c)) return { cmd: c, args: [] };
  }
  throw new Error('ImageMagick `convert` not found. Install ImageMagick to regenerate icons.');
}

const { cmd, args: baseArgs } = convertCmd();

function run(args) {
  const res = spawnSync(cmd, [...baseArgs, ...args], { stdio: 'inherit' });
  if (res.status !== 0) {
    throw new Error(`${cmd} exited with status ${res.status}: ${args.join(' ')}`);
  }
}

const full = join(resources, 'icon-1024.png');
const icon512 = join(resources, 'icon-512.png');
const icon256 = join(resources, 'icon-256.png');
const ico = join(resources, 'icon.ico');

// Teal gradient tile + white lettermark, rounded corners (Dstin mask).
run([
  '-size', '1024x1024', "gradient:#14B8A6-#0B5F59",
  '-fill', 'white',
  '-font', 'DejaVu-Sans-Bold', '-pointsize', '600', '-gravity', 'center', '-annotate', '+0+0', 'D',
  '(', '-size', '1024x1024', 'xc:none', '-fill', 'white', '-draw', 'roundrectangle 40,40 984,984 190,190', ')',
  '-compose', 'DstIn', '-composite',
  full,
]);

run([full, '-resize', '512x512', icon512]);
run([full, '-resize', '256x256', icon256]);
run([icon512, '-define', 'icon:auto-resize=256,128,64,48,32,16', ico]);

console.log('Icons written to resources/:', ['icon-1024.png', 'icon-512.png', 'icon-256.png', 'icon.ico'].join(', '));
