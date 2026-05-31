import { contentJson, OpenAPIRoute } from 'chanfana';
import type { AppContext } from '../../types.js';
import { resolveAddressOrENS, isENSName } from '../../services/address.js';
import { getUserStats } from '../../services/users.js';
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

    const address = await resolveAddressOrENS(addressOrENS, c.env.PRIMARY_RPC_ETH);
    if (!address) {
      const message = isENSName(addressOrENS)
        ? 'ENS name not valid or does not exist'
        : 'Invalid address format';
      return c.json({ response: message }, 400);
    }

    const stats = await getUserStats(c.get('db'), address);
    return c.json(stats);
  }
}
