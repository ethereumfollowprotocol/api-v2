import type { FastifyRequest, FastifyReply } from 'fastify';
import { env, getPhase, type Phase } from '@efp/shared';

export async function phaseMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  // Always allow health endpoints
  if (
    request.url.startsWith('/health') ||
    request.url.startsWith('/api/v1/health') ||
    request.url.startsWith('/api/v1/serviceHealth')
  ) {
    return;
  }

  let phase: Phase;
  try {
    phase = await getPhase();
  } catch {
    // If we can't read phase, assume historical
    phase = 'historical';
  }

  // Add phase header for debugging
  reply.header('X-EFP-Phase', phase);

  // Skip check if override enabled
  if (env.SERVE_DURING_SYNC) {
    return;
  }

  // Block requests during sync
  if (phase !== 'listening') {
    return reply
      .code(503)
      .header('Retry-After', '60')
      .send({
        error: 'Service initializing',
        phase: phase,
        message: 'System is syncing blockchain data. Please retry shortly.',
      });
  }
}
