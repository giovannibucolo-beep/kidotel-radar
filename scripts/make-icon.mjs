// Rasterizza l'SVG del brand in un PNG 1024x1024, poi `pnpm tauri icon` genera il set
// completo (icns per macOS, ico per Windows, png vari). Sorgente: src-tauri/icons/icon.svg
import sharp from "sharp";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const svg = resolve(root, "src-tauri/icons/icon.svg");
const out = resolve(root, "src-tauri/icons/source-1024.png");

await sharp(svg, { density: 384 })
  .resize(1024, 1024, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toFile(out);

console.log("PNG creato:", out);
