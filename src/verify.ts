const encoder = new TextEncoder();

function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Discord Interactions のリクエスト署名 (Ed25519) を検証する */
export async function verifyDiscordRequest(
  signature: string | null,
  timestamp: string | null,
  body: string,
  publicKeyHex: string,
): Promise<boolean> {
  if (!signature || !timestamp) return false;
  const sig = hexToBytes(signature);
  const pub = hexToBytes(publicKeyHex);
  if (!sig || !pub) return false;
  try {
    const key = await crypto.subtle.importKey("raw", pub, { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify({ name: "Ed25519" }, key, sig, encoder.encode(timestamp + body));
  } catch {
    return false;
  }
}
