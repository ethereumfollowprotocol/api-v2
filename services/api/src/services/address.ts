import { createPublicClient, http, isAddress } from 'viem';
import { normalize } from 'viem/ens';
import { mainnet } from 'viem/chains';
import { env, type Address } from '@efp/shared';

// Viem client for ENS resolution
const client = createPublicClient({
  chain: mainnet,
  transport: http(env.PRIMARY_RPC_ETH),
});

// Resolve ENS name or validate address
export async function resolveAddressOrENS(addressOrENS: string): Promise<Address | null> {
  // Check if it's already a valid address
  if (isAddress(addressOrENS)) {
    return addressOrENS.toLowerCase() as Address;
  }

  // Try to resolve as ENS name
  try {
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

// Validate and normalize address
export function normalizeAddress(address: string): Address | null {
  if (!isAddress(address)) {
    return null;
  }
  return address.toLowerCase() as Address;
}

// Check if string is an ENS name
export function isENSName(value: string): boolean {
  return value.includes('.') && !isAddress(value);
}
