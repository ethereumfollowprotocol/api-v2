import { createPublicClient, http, isAddress } from 'viem';
import { normalize } from 'viem/ens';
import { mainnet } from 'viem/chains';
import type { Address } from '@efp/shared-core';

let _client: ReturnType<typeof createPublicClient> | null = null;

function getClient(rpcUrl: string) {
  if (!_client) {
    _client = createPublicClient({
      chain: mainnet,
      transport: http(rpcUrl),
    });
  }
  return _client;
}

export async function resolveAddressOrENS(
  addressOrENS: string,
  rpcUrl: string
): Promise<Address | null> {
  if (isAddress(addressOrENS)) {
    return addressOrENS.toLowerCase() as Address;
  }

  try {
    const client = getClient(rpcUrl);
    const resolvedAddress = await client.getEnsAddress({
      name: normalize(addressOrENS),
    });

    if (resolvedAddress) {
      return resolvedAddress.toLowerCase() as Address;
    }
  } catch {
    // ENS resolution failed
  }

  return null;
}

export function normalizeAddress(address: string): Address | null {
  if (!isAddress(address)) {
    return null;
  }
  return address.toLowerCase() as Address;
}

export function isENSName(value: string): boolean {
  return value.includes('.') && !isAddress(value);
}
