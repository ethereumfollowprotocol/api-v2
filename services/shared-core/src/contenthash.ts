export const contenthashAbi = [
  {
    name: 'contenthash',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ name: '', type: 'bytes' }],
  },
] as const;

const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(h.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function encodeBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += BASE32_ALPHABET[(value >>> bits) & 0x1f];
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  }
  return out;
}

function encodeBase58(bytes: Uint8Array): string {
  let zeroes = 0;
  for (const b of bytes) {
    if (b !== 0) break;
    zeroes++;
  }

  let num = 0n;
  for (const b of bytes) {
    num = num * 256n + BigInt(b);
  }

  let out = '';
  while (num > 0n) {
    const rem = Number(num % 58n);
    num = num / 58n;
    out = BASE58_ALPHABET[rem] + out;
  }

  return '1'.repeat(zeroes) + out;
}

function readVarint(bytes: Uint8Array, offset: number): [number, number] {
  let value = 0;
  let shift = 0;
  let i = offset;
  while (i < bytes.length) {
    const byte = bytes[i];
    value |= (byte & 0x7f) << shift;
    i++;
    if ((byte & 0x80) === 0) break;
    shift += 7;
  }
  return [value, i - offset];
}

export function decodeContentHash(hex: string | null | undefined): string | null {
  if (!hex || hex === '0x' || hex === '0x0') return null;

  try {
    const bytes = hexToBytes(hex);
    if (bytes.length === 0) return null;

    const [codec, codecLen] = readVarint(bytes, 0);

    if (codec === 0xe3) {
      const cidBytes = bytes.slice(codecLen);
      if (cidBytes.length === 0) return null;

      const [cidVersion] = readVarint(cidBytes, 0);
      if (cidVersion === 0x12) {
        return `ipfs://${encodeBase58(cidBytes)}`;
      }
      return `ipfs://b${encodeBase32(cidBytes)}`;
    }

    if (codec === 0xe5) {
      const cidBytes = bytes.slice(codecLen);
      if (cidBytes.length === 0) return null;
      return `ipns://b${encodeBase32(cidBytes)}`;
    }

    if (codec === 0xe4) {
      const hashBytes = bytes.slice(codecLen);
      if (hashBytes.length === 0) return null;
      const hashHex = Array.from(hashBytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      return `bzz://${hashHex}`;
    }

    return null;
  } catch {
    return null;
  }
}
