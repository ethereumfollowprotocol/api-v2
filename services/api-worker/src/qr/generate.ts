/**
 * Workers-safe QR SVG generator.
 * Replaces `qr-image` which relies on Node streams/zlib and is incompatible with Workers.
 */
// @ts-expect-error qrcode-svg has no types
import QRCode from 'qrcode-svg';

export interface QrOptions {
  content: string;
  width?: number;
  height?: number;
  color?: string;
  background?: string;
}

export function generateQrSvg(options: QrOptions): string {
  const qr = new QRCode({
    content: options.content,
    padding: 0,
    width: options.width ?? 39,
    height: options.height ?? 39,
    color: options.color ?? '#FFE067',
    background: options.background ?? '#333333',
    ecl: 'M',
  });
  return qr.svg();
}

/**
 * Spike helper: attempt qr-image import under nodejs_compat.
 * Returns { supported: boolean, error?: string }.
 */
export async function probeQrImageSupport(): Promise<{ supported: boolean; error?: string; svgLength?: number }> {
  try {
    const qrcode = await import('qr-image');
    const svg = qrcode.imageSync('https://ethfollow.xyz/test', { type: 'svg' }).toString('utf-8');
    return { supported: true, svgLength: svg.length };
  } catch (err) {
    return {
      supported: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
