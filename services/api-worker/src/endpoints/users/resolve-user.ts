import type { Address } from '@efp/shared-core';
import type { AppContext } from '../../types.js';
import { resolveAddressOrENS, isENSName } from '../../services/address.js';

type ResolveUserResult =
  | { ok: true; address: Address }
  | { ok: false; message: string };

export async function resolveUserAddress(
  c: AppContext,
  addressOrENS: string
): Promise<ResolveUserResult> {
  const address = await resolveAddressOrENS(addressOrENS, c.env.PRIMARY_RPC_ETH);
  if (!address) {
    const message = isENSName(addressOrENS)
      ? 'ENS name not valid or does not exist'
      : 'Invalid address format';
    return { ok: false, message };
  }
  return { ok: true, address };
}
