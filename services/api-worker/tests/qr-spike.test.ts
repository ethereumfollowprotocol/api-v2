import { describe, it, expect } from 'vitest';
import { generateQrSvg, probeQrImageSupport } from '../src/qr/generate.js';

describe('QR code portability spike', () => {
  it('generates SVG with Workers-safe qrcode-svg replacement', () => {
    const svg = generateQrSvg({ content: 'https://ethfollow.xyz/0xd8da6bf26964af9d7eed9e03e53415d37aa96045' });
    expect(svg).toContain('<svg');
    expect(svg.length).toBeGreaterThan(100);
  });

  it('documents qr-image compatibility under nodejs_compat', async () => {
    const result = await probeQrImageSupport();
    // qr-image uses Node streams/zlib — typically fails on Workers even with nodejs_compat.
    // When unsupported, qrcode-svg is the documented replacement.
    if (!result.supported) {
      expect(result.error).toBeDefined();
      console.info('[qr-spike] qr-image unsupported on Workers:', result.error);
      console.info('[qr-spike] Use generateQrSvg() (qrcode-svg) instead');
    } else {
      expect(result.svgLength).toBeGreaterThan(0);
      console.info('[qr-spike] qr-image unexpectedly supported, svgLength=', result.svgLength);
    }
  });
});
