// Builds the app icons from assets/mushabbab.jpg (the same photo as the Telegram bot's profile).
// Run: npm run icons
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';

const SRC = 'assets/mushabbab.jpg'; // 640×640
// Square crops (left, top, size) centred on the face / upper body.
const TIGHT = { left: 170, top: 45, width: 310, height: 310 };   // regular icons
const LOOSE = { left: 130, top: 20, width: 390, height: 390 };   // maskable: keep the face inside the safe zone

await mkdir('public/icons', { recursive: true });
const out = [
  ['icon-192.png', 192, TIGHT],
  ['icon-512.png', 512, TIGHT],
  ['icon-maskable-512.png', 512, LOOSE],
  ['apple-touch-icon.png', 180, TIGHT],
  ['badge-96.png', 96, TIGHT],
];
for (const [name, size, crop] of out) {
  await sharp(SRC).extract(crop).resize(size, size, { kernel: 'lanczos3' }).png().toFile(`public/icons/${name}`);
  console.log('wrote', name);
}
