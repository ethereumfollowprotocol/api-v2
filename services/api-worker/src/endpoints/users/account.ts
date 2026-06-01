import { contentJson, OpenAPIRoute } from 'chanfana';
import type { AppContext } from '../../types.js';
import { ensureDb } from '../../middleware/db.js';
import { getUserAccount } from '../../services/users/account.js';
import { resolveUserAddress } from './resolve-user.js';
import { accountResponseSchema, addressOrENSParam, cacheQuery, errorResponseSchema } from '../schemas.js';

export class UserAccount extends OpenAPIRoute {
  schema = {
    tags: ['Users'],
    summary: 'Get user account (P0)',
    request: {
      params: addressOrENSParam,
      query: cacheQuery,
    },
    responses: {
      '200': {
        description: 'User account',
        ...contentJson(accountResponseSchema),
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

    const account = await getUserAccount(await ensureDb(c), resolved.address);
    return c.json(account);
  }
}
