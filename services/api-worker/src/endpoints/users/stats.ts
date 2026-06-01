import { contentJson, OpenAPIRoute } from 'chanfana';
import type { AppContext } from '../../types.js';
import { ensureDb } from '../../middleware/db.js';
import { getUserStats } from '../../services/users/stats.js';
import { resolveUserAddress } from './resolve-user.js';
import { addressOrENSParam, errorResponseSchema, statsResponseSchema } from '../schemas.js';

export class UserStats extends OpenAPIRoute {
  schema = {
    tags: ['Users'],
    summary: 'Get user stats (P0)',
    request: {
      params: addressOrENSParam,
    },
    responses: {
      '200': {
        description: 'User stats',
        ...contentJson(statsResponseSchema),
      },
      '400': {
        description: 'Invalid address or ENS',
        ...contentJson(errorResponseSchema),
      },
    },
  };

  async handle(c: AppContext) {
    const data = await this.getValidatedData<typeof this.schema>();
    const { addressOrENS } = data.params;

    const resolved = await resolveUserAddress(c, addressOrENS);
    if (!resolved.ok) {
      return c.json({ response: resolved.message }, 400);
    }

    const stats = await getUserStats(await ensureDb(c), resolved.address);
    return c.json(stats);
  }
}
