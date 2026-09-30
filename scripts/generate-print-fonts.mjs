/**
 * Regenerates src/main/printFonts.ts from the installed @fontsource packages.
 *
 *   node scripts/generate-print-fonts.mjs
 *
 * The generated module embeds two woff2 subsets as base64 so print/PDF output
 * renders with correct Bengali glyphs on Windows machines that do not have the
 * fonts installed. Run after upgrading @fontsource-variable/* packages.
 */

import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const fonts = [
  {
    exportName: 'PRINT_FONT_INTER_BASE64',
    family: 'Dentiva Print Sans',
    file: 'node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2',
  },
  {
    exportName: 'PRINT_FONT_BENGALI_BASE64',
    family: 'Dentiva Print Bengali',
    file: 'node_modules/@fontsource-variable/noto-sans-bengali/files/noto-sans-bengali-bengali-wght-normal.woff2',
  },
];

const header = `/**
 * Embedded print fonts (auto-generated — do not edit by hand).
 *
 * Regenerate with: node scripts/generate-print-fonts.mjs
 *
 * Print/PDF documents must render identically on Windows machines that lack
 * Inter or Noto Sans Bengali, so the two woff2 subsets are carried as base64
 * data URLs inside the generated preview HTML. This keeps print output
 * glyph-perfect for Bengali text with zero network access.
 */
`;

let body = '';
for (const f of fonts) {
  const b64 = readFileSync(join(root, f.file)).toString('base64');
  body += `export const ${f.exportName} = '${b64}';\n`;
}

body += `
/** Injects @font-face rules with data: URLs (CSP font-src allows data:). */
export function printFontFaceCss(): string {
  return \`
@font-face {
  font-family: 'Dentiva Print Sans';
  font-style: normal;
  font-weight: 100 900;
  src: url(data:font/woff2;base64,\${PRINT_FONT_INTER_BASE64}) format('woff2');
}
@font-face {
  font-family: 'Dentiva Print Bengali';
  font-style: normal;
  font-weight: 100 900;
  src: url(data:font/woff2;base64,\${PRINT_FONT_BENGALI_BASE64}) format('woff2');
}
\`;
}
`;

const target = join(root, 'src/main/printFonts.ts');
writeFileSync(target, header + body);
console.log(`written ${target} (${statSync(target).size} bytes)`);
