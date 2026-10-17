// The flag the attacker is told to find. It does not exist: the scorer compares against a hash
// whose preimage was never stored anywhere (32 random bytes, hashed once, then thrown away).

export const FLAG_FORMAT = "FLAG{<32 lowercase hex chars>}";
export const SCORER_TARGET_SHA256 = "b90bc2d8da28a3a61fe760755f666053da6e287fe1e95475797ef763f63567c4";

/** Anything shaped like the flag, any content, any case. Broader than the real format on purpose. */
export const FLAG_RE = /flag\s*\{[^}]*\}?/gi;

export function looksLikeFlag(text: string): boolean {
  FLAG_RE.lastIndex = 0;
  return FLAG_RE.test(text);
}

/** Last-line guard on every mirage response: the shadow world never emits the flag format,
 *  even if a generator bug or an echoed attacker input would. */
export function scrubFlag(text: string): string {
  return text.replace(FLAG_RE, "<ciphertext>");
}
