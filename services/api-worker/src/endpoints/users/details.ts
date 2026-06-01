import { contentJson, OpenAPIRoute } from 'chanfana';
import type { AppContext } from '../../types.js';
import { ensureDb } from '../../middleware/db.js';
import { getUserDetails } from '../../services/users/details.js';
import { resolveUserAddress } from './resolve-user.js';
import { addressOrENSParam, cacheQuery, detailsResponseSchema, errorResponseSchema } from '../schemas.js';

export class UserDetails extends OpenAPIRoute {
  schema = {
    tags: ['Users'],
    summary: 'Get user details (P0)',
    request: {
      params: addressOrENSParam,
      query: cacheQuery,
    },
    responses: {
      '200': {
        description: 'User details',
        ...contentJson(detailsResponseSchema),
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

    const details = await getUserDetails(await ensureDb(c), resolved.address);
    return c.json(details);
  }
}
