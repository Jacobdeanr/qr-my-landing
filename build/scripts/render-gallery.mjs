#!/usr/bin/env node
// build/scripts/render-gallery.mjs
//
// Pre-render the 16 customization-gallery QR codes by calling the real public
// preview API (POST /api/public/qrcodes/preview). Saves PNGs to
// build/assets/gallery/{shape}-{colorName}.png. The browser shows them as
// static <img> tags so the gallery is authentic to the dashboard renderer
// down to the pixel.
//
// Usage:
//   node build/scripts/render-gallery.mjs
//   QRMY_API_BASE=https://dashboard.qrmy.app node build/scripts/render-gallery.mjs
//
// The TILES list MUST be kept in sync with main.js's TILES array.
// 16 codes at ~7 sec/code (under the 10/min anonymous rate limit) ≈ 2 min.
//
// Requires Node 18+ (uses native fetch).

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = resolve(__dirname, "../assets/gallery");
const API_BASE = process.env.QRMY_API_BASE || "https://dashboard.qrmy.app";
const SIZE = 560; // displayed at 280px → 2× retina crisp
const FORMAT = "png";
const THROTTLE_MS = 7000; // ≤ ~8 req/min, under the 10/min anonymous limit

// Mirror of main.js TILES — keep in sync.
const TILES = [
  // Row 1 — square modules
  { shape: "square", color: "#7C3AED", colorName: "violet", target_type: "url",   payload: { url: "https://qrmy.app" } },
  { shape: "square", color: "#2563EB", colorName: "blue",   target_type: "wifi",  payload: { ssid: "Cafe", password: "summer2026", encryption: "WPA" } },
  { shape: "square", color: "#059669", colorName: "green",  target_type: "vcard", payload: { name: "Sam Lee", company: "Acme" } },
  { shape: "square", color: "#D97706", colorName: "amber",  target_type: "url",   payload: { url: "https://example.com/menu" } },

  // Row 2 — rounded modules
  { shape: "rounded", color: "#E11D48", colorName: "rose",   target_type: "url",   payload: { url: "https://example.com/sale" } },
  { shape: "rounded", color: "#0891B2", colorName: "cyan",   target_type: "wifi",  payload: { ssid: "Office", password: "guest12345", encryption: "WPA" } },
  { shape: "rounded", color: "#7C3AED", colorName: "violet", target_type: "phone", payload: { phone: "+15555550101" } },
  { shape: "rounded", color: "#2563EB", colorName: "blue",   target_type: "vcard", payload: { name: "Jamie Park", company: "Studio" } },

  // Row 3 — circle modules
  { shape: "circle", color: "#059669", colorName: "green", target_type: "url",   payload: { url: "https://example.com/scan" } },
  { shape: "circle", color: "#D97706", colorName: "amber", target_type: "url",   payload: { url: "https://example.com/event" } },
  { shape: "circle", color: "#E11D48", colorName: "rose",  target_type: "vcard", payload: { name: "Alex Rivera" } },
  { shape: "circle", color: "#0891B2", colorName: "cyan",  target_type: "url",   payload: { url: "https://example.com/wifi-help" } },

  // Row 4 — gapped modules
  { shape: "gapped", color: "#7C3AED", colorName: "violet", target_type: "url", payload: { url: "https://example.com/brunch" } },
  { shape: "gapped", color: "#2563EB", colorName: "blue",   target_type: "url", payload: { url: "https://example.com/promo" } },
  { shape: "gapped", color: "#059669", colorName: "green",  target_type: "url", payload: { url: "https://example.com/coupon" } },
  { shape: "gapped", color: "#E11D48", colorName: "rose",   target_type: "url", payload: { url: "https://example.com/launch" } },
];

function buildUrl(tile) {
  const params = new URLSearchParams({
    format: FORMAT,
    size: String(SIZE),
    fg_color: tile.color,
    module_style: tile.shape,
  });
  return `${API_BASE}/api/public/qrcodes/preview?${params}`;
}

async function renderTile(tile, index) {
  const slug = `${tile.shape}-${tile.colorName}`;
  process.stdout.write(`[${index + 1}/${TILES.length}] ${slug}.png ... `);

  const url = buildUrl(tile);
  const body = { target_type: tile.target_type, payload: tile.payload };

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error(`network error: ${err.message}`);
    throw err;
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error(`HTTP ${res.status} ${res.statusText} — ${detail.slice(0, 240)}`);
    throw new Error(`API returned ${res.status} for ${slug}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  const outPath = resolve(OUTPUT_DIR, `${slug}.png`);
  await writeFile(outPath, buffer);
  console.log(`${buffer.length.toLocaleString()} bytes`);
}

async function main() {
  console.log(`Rendering ${TILES.length} gallery codes via ${API_BASE}/api/public/qrcodes/preview`);
  console.log(`Output:    ${OUTPUT_DIR}`);
  console.log(`Throttle:  ${THROTTLE_MS}ms between requests (≤8 req/min, under 10/min anonymous limit)\n`);

  await mkdir(OUTPUT_DIR, { recursive: true });

  for (let i = 0; i < TILES.length; i++) {
    await renderTile(TILES[i], i);
    if (i < TILES.length - 1) {
      await new Promise((r) => setTimeout(r, THROTTLE_MS));
    }
  }

  console.log(`\nDone. ${TILES.length} files written to ${OUTPUT_DIR}`);
}

main().catch((err) => {
  console.error("\nFailed:", err.message);
  process.exit(1);
});
