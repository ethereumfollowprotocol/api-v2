import type { FastifyInstance, FastifyReply } from 'fastify';
import { query, createLogger } from '@efp/shared';

const logger = createLogger('token-routes');

interface TokenParams {
  tokenId: string;
}

export async function tokenRoutes(app: FastifyInstance) {
  // GET /token/metadata/:tokenId (P2)
  // NFT metadata for token - follows ERC-721 metadata standard
  app.get<{ Params: TokenParams }>(
    '/token/metadata/:tokenId',
    async (request, reply) => {
      const { tokenId } = request.params;

      // Check if token exists
      const result = await query<{ token_id: string }>(
        `SELECT token_id::TEXT FROM efp_lists WHERE token_id = $1`,
        [tokenId]
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({ error: 'Token not found' });
      }

      const baseUrl = process.env.API_BASE_URL || 'https://api.ethfollow.xyz';
      const appUrl = process.env.APP_BASE_URL || 'https://ethfollow.xyz';

      return {
        name: `EFP List #${tokenId}`,
        description: 'Ethereum Follow Protocol (EFP) is an onchain social graph protocol for Ethereum accounts.',
        image: `${baseUrl}/api/v1/token/image/${tokenId}`,
        external_url: `${appUrl}/${tokenId}`,
        attributes: [],
      };
    }
  );

  // GET /token/image/:tokenId (P2)
  // Returns SVG image for the token
  app.get<{ Params: TokenParams }>(
    '/token/image/:tokenId',
    async (request, reply: FastifyReply) => {
      const { tokenId } = request.params;

      // Check if token exists and get owner info
      const result = await query<{
        token_id: string;
        owner: string;
        user: string | null;
      }>(
        `SELECT token_id::TEXT, owner, "user" FROM efp_lists WHERE token_id = $1`,
        [tokenId]
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({ error: 'Token not found' });
      }

      const row = result.rows[0];
      const address = (row.user || row.owner).toLowerCase();
      const shortAddr = `${address.slice(0, 6)}...${address.slice(-4)}`;

      // Generate SVG
      const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#667eea;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#764ba2;stop-opacity:1" />
    </linearGradient>
  </defs>
  <rect width="400" height="400" fill="url(#bg)" rx="20" ry="20"/>
  <text x="200" y="160" font-family="Arial, sans-serif" font-size="24" fill="white" text-anchor="middle" font-weight="bold">EFP List</text>
  <text x="200" y="210" font-family="Arial, sans-serif" font-size="48" fill="white" text-anchor="middle" font-weight="bold">#${tokenId}</text>
  <text x="200" y="280" font-family="monospace" font-size="16" fill="rgba(255,255,255,0.8)" text-anchor="middle">${shortAddr}</text>
</svg>`.trim();

      reply.type('image/svg+xml').send(svg);
    }
  );
}
