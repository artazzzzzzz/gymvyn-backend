const sharp = require('sharp');

const MAX_ORIGINAL_BYTES = 10 * 1024 * 1024; // 10MB
const MIN_ORIGINAL_BYTES = 5 * 1024;         // 5KB
const MAX_EDGE_PX = 1024;
const JPEG_QUALITY = 85;

async function normalizeImage(buffer, mimeType) {
  if (buffer.length > MAX_ORIGINAL_BYTES) {
    throw new Error(`Image too large: ${Math.round(buffer.length / 1024)}KB (max 10MB)`);
  }
  if (buffer.length < MIN_ORIGINAL_BYTES) {
    throw new Error(`Image too small: ${buffer.length} bytes — likely empty or corrupt`);
  }

  const normalized = await sharp(buffer)
    .resize(MAX_EDGE_PX, MAX_EDGE_PX, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: JPEG_QUALITY })
    .withMetadata(false) // strip EXIF
    .toBuffer();

  return {
    buffer: normalized,
    mimeType: 'image/jpeg',
    sizeKb: Math.round(normalized.length / 1024),
  };
}

module.exports = { normalizeImage };
