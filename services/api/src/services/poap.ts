import { type Address, createLogger } from '@efp/shared';

const logger = createLogger('poap-service');

// EFP POAP collection IDs
const EFP_COLLECTION_IDS = ['177709', '178064', '178065', '178066', '183182'];

interface POAPEvent {
  id: number;
  fancy_id: string;
  name: string;
  event_url: string;
  image_url: string;
  country: string;
  city: string;
  description: string;
  year: number;
  start_date: string;
  end_date: string;
  timezone: string;
  expiry_date: string;
}

interface POAPCollection {
  event: POAPEvent;
  tokenId: string;
  owner: string;
}

interface POAPResult {
  eventId: string;
  participated: boolean;
  collection: POAPCollection | null;
}

// Fetch POAP badges for an address
export async function getPOAPBadges(address: Address): Promise<POAPResult[]> {
  const apiToken = process.env.POAP_API_TOKEN;

  if (!apiToken) {
    logger.warn('POAP_API_TOKEN not configured');
    // Return empty results if no token
    return EFP_COLLECTION_IDS.map((eventId) => ({
      eventId,
      participated: false,
      collection: null,
    }));
  }

  const headers = {
    'X-API-Key': apiToken,
    'Content-Type': 'application/json',
  };

  const results = await Promise.all(
    EFP_COLLECTION_IDS.map(async (eventId) => {
      try {
        const res = await fetch(`https://api.poap.tech/actions/scan/${address}/${eventId}`, {
          headers,
        });

        if (!res.ok) {
          logger.debug(`POAP API returned ${res.status} for event ${eventId}`);
          return {
            eventId,
            participated: false,
            collection: null,
          };
        }

        const data = (await res.json()) as POAPCollection | null;

        if (data && data.tokenId) {
          return {
            eventId,
            participated: true,
            collection: data as POAPCollection,
          };
        }

        return {
          eventId,
          participated: false,
          collection: null,
        };
      } catch (error) {
        logger.error(`Error fetching POAP for event ${eventId}:`, error);
        return {
          eventId,
          participated: false,
          collection: null,
        };
      }
    })
  );

  return results;
}
