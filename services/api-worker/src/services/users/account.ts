import type { Client } from 'pg';
import type { Address, AccountResponse } from '@efp/shared-core';
import { getENSProfile } from '../ens.js';

export async function getUserAccount(client: Client, address: Address): Promise<AccountResponse> {
  const ens = await getENSProfile(client, address);
  return { address, ens };
}
