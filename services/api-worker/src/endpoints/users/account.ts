import { contentJson, OpenAPIRoute } from 'chanfana';
import type { AppContext } from '../../types.js';
import { ensureDb } from '../../middleware/db.js';
import { resolveAddressOrENS, isENSName } from '../../services/address.js';
import { getUserAccount } from '../../services/users.js';
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

    const address = await resolveAddressOrENS(addressOrENS, c.env.PRIMARY_RPC_ETH);
    if (!address) {
      const message = isENSName(addressOrENS)
        ? 'ENS name not valid or does not exist'
        : 'Invalid address format';
      return c.json({ response: message }, 400);
    }

    const account = await getUserAccount(await ensureDb(c), address);
    return c.json(account);
  }
}
