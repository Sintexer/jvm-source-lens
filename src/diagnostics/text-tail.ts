/** Max bytes retained per subprocess stream in a diagnostic record (README §6.3). */
export const DIAGNOSTIC_STREAM_TAIL_BYTES = 4096;

export function tailText(text: string, maxBytes: number = DIAGNOSTIC_STREAM_TAIL_BYTES): string {
  if (text.length === 0) {
    return text;
  }
  const enc = new TextEncoder();
  const full = enc.encode(text);
  if (full.byteLength <= maxBytes) {
    return text;
  }
  const slice = full.subarray(full.byteLength - maxBytes);
  return new TextDecoder('utf-8', { fatal: false }).decode(slice);
}
