import type PgBoss from 'pg-boss';
import { getClient, createLogger, env } from '@efp/shared';

const logger = createLogger('seed-recommended');

// Static recommended lists - these are the curated ENS names from EFP
// Class A: Highest priority (founders, core team, prominent community members)
// Class B: Medium priority (active community members, builders)
// Class C: Lower priority (general community)
const RECOMMENDED_LISTS = {
  List_A: [
    'brantly.eth',
    'encrypteddegen.eth',
    '0xthrpw.eth',
    'caveman.eth',
    'nick.eth',
    'matoken.eth',
    'slobo.eth',
    'cory.eth',
  ],
  List_B: [
    'bendi.eth',
    'pell.eth',
    'cerealsabre.eth',
    'gregskril.eth',
    'luc.eth',
    'validator.eth',
    'domico.eth',
  ],
  List_C: [
    'efp.eth',
    'identitykit.eth',
    'vitalik.eth',
    'jessepollak.eth',
    'alexmasmej.eth',
    'sassal.eth',
    'davidhoffman.eth',
  ],
};

interface ENSProfileResponse {
  type: 'success' | 'error';
  name?: string;
  address?: string;
  avatar?: string;
  records?: Record<string, string>;
}

interface BulkENSResponse {
  response_length: number;
  response: ENSProfileResponse[];
}

/**
 * Resolves ENS names in batches using the ENS API
 */
async function resolveENSBatch(names: string[]): Promise<ENSProfileResponse[]> {
  const ENS_API_URL = env.ENS_API_URL || 'https://ens.ethfollow.xyz';
  const results: ENSProfileResponse[] = [];

  // Process in batches of 50
  const batchSize = 50;
  for (let i = 0; i < names.length; i += batchSize) {
    const batch = names.slice(i, i + batchSize);
    const query = batch.map((name) => `names[]=${encodeURIComponent(name)}`).join('&');

    try {
      const response = await fetch(`${ENS_API_URL}/bulk/n?${query}`);
      if (response.ok) {
        const data = (await response.json()) as BulkENSResponse;
        results.push(...data.response);
      } else {
        logger.warn({ status: response.status }, 'Failed to fetch ENS batch');
      }
    } catch (err) {
      logger.error({ err }, 'Error fetching ENS batch');
    }

    // Rate limiting
    if (i + batchSize < names.length) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  return results;
}

/**
 * Seeds the efp_recommended table with curated ENS profiles
 * This job runs once on startup if the table is empty
 */
export async function handleSeedRecommended(
  job: PgBoss.Job<Record<string, never>>
): Promise<void> {
  const startTime = Date.now();

  logger.info('Starting recommended seed');

  const client = await getClient();

  try {
    // Check if table already has data
    const countResult = await client.query<{ count: string }>(
      'SELECT COUNT(*) as count FROM efp_recommended'
    );
    const existingCount = parseInt(countResult.rows[0].count, 10);

    if (existingCount > 0) {
      logger.info({ existingCount }, 'Recommended table already populated, skipping seed');
      return;
    }

    logger.info('Resolving ENS names for recommended accounts...');

    // Resolve all ENS names
    const allNames = [
      ...RECOMMENDED_LISTS.List_A,
      ...RECOMMENDED_LISTS.List_B,
      ...RECOMMENDED_LISTS.List_C,
    ];

    const profiles = await resolveENSBatch(allNames);

    // Map profiles back to their classes
    const classMap = new Map<string, string>();
    for (const name of RECOMMENDED_LISTS.List_A) {
      classMap.set(name.toLowerCase(), 'A');
    }
    for (const name of RECOMMENDED_LISTS.List_B) {
      classMap.set(name.toLowerCase(), 'B');
    }
    for (const name of RECOMMENDED_LISTS.List_C) {
      classMap.set(name.toLowerCase(), 'C');
    }

    // Filter successful profiles and format for insertion
    const validProfiles = profiles
      .filter((p) => p.type === 'success' && p.address && p.name)
      .map((profile) => {
        const name = profile.name!.toLowerCase();
        const ensClass = classMap.get(name) || 'C';

        // Format avatar URL
        let avatar = profile.avatar || '';
        if (avatar && !avatar.startsWith('http')) {
          avatar = `https://metadata.ens.domains/mainnet/avatar/${profile.name}`;
        } else if (avatar.startsWith('https://ipfs') || avatar.startsWith('ipfs')) {
          avatar = `https://metadata.ens.domains/mainnet/avatar/${profile.name}`;
        }

        // Extract header from records if available
        const header = profile.records?.header || null;

        return {
          address: profile.address!.toLowerCase(),
          name: profile.name!,
          avatar,
          header,
          class: ensClass,
        };
      });

    logger.info({ count: validProfiles.length }, 'Resolved ENS profiles');

    if (validProfiles.length === 0) {
      logger.warn('No valid profiles resolved, skipping seed');
      return;
    }

    await client.query('BEGIN');

    // Also update ens_metadata table
    for (const profile of validProfiles) {
      await client.query(
        `INSERT INTO ens_metadata (address, name, avatar, resolved_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (address) DO UPDATE SET
           name = EXCLUDED.name,
           avatar = EXCLUDED.avatar,
           resolved_at = NOW()`,
        [profile.address, profile.name, profile.avatar]
      );
    }

    // Shuffle using weighted randomization for initial order
    const shuffled = shuffleWithWeights(validProfiles);

    // Insert into efp_recommended
    for (let i = 0; i < shuffled.length; i++) {
      const profile = shuffled[i];
      await client.query(
        `INSERT INTO efp_recommended (index, address, name, avatar, header, class)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (address) DO UPDATE SET
           index = EXCLUDED.index,
           name = EXCLUDED.name,
           avatar = EXCLUDED.avatar,
           header = EXCLUDED.header,
           class = EXCLUDED.class`,
        [i, profile.address, profile.name, profile.avatar, profile.header, profile.class]
      );
    }

    await client.query('COMMIT');

    const duration = Date.now() - startTime;
    logger.info({ duration, count: shuffled.length }, 'Completed recommended seed');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Shuffles profiles using weighted randomization
 * Class A: 50% weight (top priority)
 * Class B: 35% weight + 10% offset
 * Class C: 20% weight
 */
function shuffleWithWeights(
  profiles: Array<{ address: string; name: string; avatar: string; header: string | null; class: string }>
): Array<{ address: string; name: string; avatar: string; header: string | null; class: string }> {
  return profiles
    .map((profile) => {
      let weight: number;
      switch (profile.class) {
        case 'A':
          weight = Math.random() * 0.5;
          break;
        case 'B':
          weight = 0.1 + Math.random() * 0.35;
          break;
        case 'C':
        default:
          weight = Math.random() * 0.2;
          break;
      }
      return { ...profile, weight };
    })
    .sort((a, b) => b.weight - a.weight)
    .map(({ weight, ...profile }) => profile);
}
