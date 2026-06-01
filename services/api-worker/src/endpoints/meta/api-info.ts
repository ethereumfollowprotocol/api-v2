import type { AppContext } from '../../types.js';

export function handleApiInfo(c: AppContext) {
  return c.json({
    name: 'efp-public-api',
    version: 'v1',
    runtime: 'cloudflare-workers',
    docs: '/docs',
    source: 'https://github.com/ethereumfollowprotocol/api',
  });
}
