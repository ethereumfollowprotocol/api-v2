import { Client } from '@elastic/elasticsearch';
import { env } from '../config/index.js';
import { logger } from '../logger.js';

let esClient: Client | null = null;

export function getElasticsearch(): Client {
  if (esClient) return esClient;

  esClient = new Client({
    node: env.ELASTICSEARCH_URL,
    maxRetries: 3,
    requestTimeout: 30000,
  });

  return esClient;
}

export async function closeElasticsearch(): Promise<void> {
  if (esClient) {
    await esClient.close();
    esClient = null;
    logger.info('Elasticsearch client closed');
  }
}

// Index names
export const ES_INDICES = {
  users: 'efp_users',
} as const;

// Create users index with mapping
export async function ensureUsersIndex(): Promise<void> {
  const client = getElasticsearch();

  const exists = await client.indices.exists({ index: ES_INDICES.users });
  if (exists) {
    logger.debug('Users index already exists');
    return;
  }

  await client.indices.create({
    index: ES_INDICES.users,
    mappings: {
      properties: {
        address: { type: 'keyword' },
        ens_name: {
          type: 'text',
          analyzer: 'autocomplete',
          search_analyzer: 'standard',
        },
        ens_name_keyword: { type: 'keyword' },
        avatar: { type: 'keyword', index: false },
        header: { type: 'keyword', index: false },
        primary_list_id: { type: 'long' },
        followers_count: { type: 'integer' },
        following_count: { type: 'integer' },
        mutuals_count: { type: 'integer' },
        followers_rank: { type: 'integer' },
        following_rank: { type: 'integer' },
        mutuals_rank: { type: 'integer' },
        blocks_rank: { type: 'integer' },
        top8_rank: { type: 'integer' },
        has_primary_list: { type: 'boolean' },
        updated_at: { type: 'date' },
      },
    },
    settings: {
      analysis: {
        analyzer: {
          autocomplete: {
            tokenizer: 'autocomplete',
            filter: ['lowercase'],
          },
        },
        tokenizer: {
          autocomplete: {
            type: 'ngram',
            min_gram: 2,
            max_gram: 20,
            token_chars: ['letter', 'digit'],
          },
        },
      },
    },
  });

  logger.info('Created users index');
}

export type { Client } from '@elastic/elasticsearch';
