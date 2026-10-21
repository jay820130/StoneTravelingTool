export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_SOURCE_IMAGE_BYTES = 12 * 1024 * 1024;
export const MAX_IMAGES = 6;
export const IMAGE_MIMES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;
export const IMAGE_ACCEPT = IMAGE_MIMES.join(",") + ",.heic,.heif";

/** Inspect signatures, not the filename or browser's sometimes-empty MIME type. */
export function imageMime(bytes: Uint8Array): (typeof IMAGE_MIMES)[number] | null {
  const ascii = (a: number, b: number) => String.fromCharCode(...bytes.subarray(a, b));
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)) return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (ascii(4, 8) === "ftyp") {
    const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
    const brands = [ascii(8, 12)];
    for (let i = 16; i + 4 <= Math.min(size, bytes.length, 256); i += 4)
      brands.push(ascii(i, i + 4));
    if (brands.some((b) => ["avif", "avis"].includes(b))) return null;
    if (brands.some((b) => ["heic", "heix", "hevc", "hevx"].includes(b))) return "image/heic";
    if (brands.includes("mif1")) return "image/heif";
  }
  return null;
}
export function meaningfulText(text: string, metadata = false) {
  const stripped = text.replace(/https?:\/\/\S+/gi, "").trim();
  if (!stripped || /^(?:url|link|網址|連結)\s*[:：]?$/i.test(stripped)) return false;
  if (/^(instagram|threads|google maps|登入|登錄|log ?in|sign ?in)[\s.!。]*$/i.test(stripped))
    return false;
  if (
    metadata &&
    /(?:log in|sign up|登入).{0,80}(?:instagram|threads)|(?:instagram|threads).{0,80}(?:log in|sign up|登入)|instagram photos and videos|join threads|share ideas.{0,30}trends/i.test(
      stripped,
    )
  )
    return false;
  return (stripped.match(/[\p{L}\p{N}]/gu)?.length ?? 0) >= (metadata ? 12 : 2);
}
