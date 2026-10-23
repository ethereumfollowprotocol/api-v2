import { isAddress } from 'viem';
import { normalize } from 'viem/ens';
import { fetchENSProfileByName, type Address } from '@efp/shared';

// Resolve ENS name or validate address.
// `fresh` bypasses the ENS worker's cache (for ?cache=fresh requests).
export async function resolveAddressOrENS(
  addressOrENS: string,
  { fresh = false }: { fresh?: boolean } = {}
): Promise<Address | null> {
  // Check if it's already a valid address
  if (isAddress(addressOrENS)) {
    return addressOrENS.toLowerCase() as Address;
  }

  // Try to resolve as ENS name (v1 or v2) via the ENS worker
  try {
    const profile = await fetchENSProfileByName(normalize(addressOrENS), fresh);
    const resolvedAddress = profile?.address;

    if (resolvedAddress && isAddress(resolvedAddress)) {
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
