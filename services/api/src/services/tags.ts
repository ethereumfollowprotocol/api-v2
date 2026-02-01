import { query, type Address, createLogger } from '@efp/shared';

const logger = createLogger('tags-service');

interface TagCount {
  tag: string;
  count: number;
}

interface TaggedAddress {
  address: string;
  tag: string;
}

interface TagsResponse {
  address?: string;
  token_id?: string;
  tags: string[];
  tagCounts: TagCount[];
  taggedAddresses: TaggedAddress[];
}

// Get tags a user has applied to others (via their primary list)
export async function getUserTags(address: Address): Promise<TagsResponse> {
  // First get user's primary list
  const primaryListResult = await query<{
    token_id: string;
    list_storage_location_chain_id: number;
    list_storage_location_contract_address: string;
    list_storage_location_slot: string;
  }>(
    `
    SELECT l.token_id::TEXT, l.list_storage_location_chain_id,
           l.list_storage_location_contract_address, l.list_storage_location_slot
    FROM efp_account_metadata am
    JOIN efp_lists l ON l.token_id = convert_hex_to_bigint(am.value)
    WHERE am.address = $1 AND am.key = 'primary-list'
    `,
    [address]
  );

  if (primaryListResult.rows.length === 0) {
    return { address, tags: [], tagCounts: [], taggedAddresses: [] };
  }

  const { list_storage_location_chain_id, list_storage_location_contract_address, list_storage_location_slot } =
    primaryListResult.rows[0];

  // Get all tags and addresses
  const result = await query<{ tag: string; record_data: string }>(
    `
    SELECT t.tag, convert_from(r.record_data, 'UTF8') as record_data
    FROM efp_list_record_tags t
    JOIN efp_list_records r ON
      r.chain_id = t.chain_id AND
      r.contract_address = t.contract_address AND
      r.slot = t.slot AND
      r.record = t.record
    WHERE t.chain_id = $1 AND t.contract_address = $2 AND t.slot = $3
    `,
    [list_storage_location_chain_id, list_storage_location_contract_address, list_storage_location_slot]
  );

  // Build response
  const tagSet = new Set<string>();
  const tagCountMap = new Map<string, number>();
  const taggedAddresses: TaggedAddress[] = [];

  for (const row of result.rows) {
    tagSet.add(row.tag);
    tagCountMap.set(row.tag, (tagCountMap.get(row.tag) || 0) + 1);
    taggedAddresses.push({
      address: row.record_data.toLowerCase(),
      tag: row.tag,
    });
  }

  const tags = Array.from(tagSet);
  const tagCounts = tags.map((tag) => ({ tag, count: tagCountMap.get(tag)! }));

  return { address, tags, tagCounts, taggedAddresses };
}

// Get tags others have applied to this user
export async function getUserTaggedAs(address: Address): Promise<TagsResponse> {
  // Look at efp_followers - these contain tags from others who follow this address
  const result = await query<{ follower_address: string; tags: string[] }>(
    `
    SELECT follower_address, tags
    FROM efp_followers
    WHERE address = $1 AND tags IS NOT NULL AND array_length(tags, 1) > 0
    `,
    [address]
  );

  const tagSet = new Set<string>();
  const tagCountMap = new Map<string, number>();
  const taggedAddresses: TaggedAddress[] = [];

  for (const row of result.rows) {
    if (row.tags) {
      for (const tag of row.tags) {
        tagSet.add(tag);
        tagCountMap.set(tag, (tagCountMap.get(tag) || 0) + 1);
        taggedAddresses.push({
          address: row.follower_address.toLowerCase(),
          tag,
        });
      }
    }
  }

  const tags = Array.from(tagSet);
  const tagCounts = tags.map((tag) => ({ tag, count: tagCountMap.get(tag)! }));

  return { address, tags, tagCounts, taggedAddresses };
}

// Get tags for a list (tags it has applied)
export async function getListTags(tokenId: string): Promise<TagsResponse> {
  // Get list storage location
  const listResult = await query<{
    list_storage_location_chain_id: number;
    list_storage_location_contract_address: string;
    list_storage_location_slot: string;
  }>(
    `
    SELECT list_storage_location_chain_id, list_storage_location_contract_address, list_storage_location_slot
    FROM efp_lists WHERE token_id = $1
    `,
    [tokenId]
  );

  if (listResult.rows.length === 0) {
    return { token_id: tokenId, tags: [], tagCounts: [], taggedAddresses: [] };
  }

  const { list_storage_location_chain_id, list_storage_location_contract_address, list_storage_location_slot } =
    listResult.rows[0];

  // Get all tags with their addresses
  const result = await query<{ tag: string; record_data: string }>(
    `
    SELECT t.tag, convert_from(r.record_data, 'UTF8') as record_data
    FROM efp_list_record_tags t
    JOIN efp_list_records r ON
      r.chain_id = t.chain_id AND
      r.contract_address = t.contract_address AND
      r.slot = t.slot AND
      r.record = t.record
    WHERE t.chain_id = $1 AND t.contract_address = $2 AND t.slot = $3
    `,
    [list_storage_location_chain_id, list_storage_location_contract_address, list_storage_location_slot]
  );

  const tagSet = new Set<string>();
  const tagCountMap = new Map<string, number>();
  const taggedAddresses: TaggedAddress[] = [];

  for (const row of result.rows) {
    tagSet.add(row.tag);
    tagCountMap.set(row.tag, (tagCountMap.get(row.tag) || 0) + 1);
    taggedAddresses.push({
      address: row.record_data.toLowerCase(),
      tag: row.tag,
    });
  }

  const tags = Array.from(tagSet);
  const tagCounts = tags.map((tag) => ({ tag, count: tagCountMap.get(tag)! }));

  return { token_id: tokenId, tags, tagCounts, taggedAddresses };
}

// Get tags others have applied to this list's user
export async function getListTaggedAs(tokenId: string, userAddress: Address): Promise<TagsResponse> {
  const result = await getUserTaggedAs(userAddress);
  return { token_id: tokenId, tags: result.tags, tagCounts: result.tagCounts, taggedAddresses: result.taggedAddresses };
}
