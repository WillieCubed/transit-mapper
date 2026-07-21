const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/** Short URL-safe random id. Not cryptographically strong; fine for local ids. */
export function shortId(len = 8): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let out = "";
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}
