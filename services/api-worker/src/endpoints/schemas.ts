import { z } from 'zod';
import { ensProfileSchema } from '@efp/shared-core';

export const addressOrENSParam = z.object({
  addressOrENS: z.string().min(1),
});

export const cacheQuery = z.object({
  cache: z.enum(['fresh']).optional(),
});

export const accountResponseSchema = z.object({
  address: z.string(),
  ens: ensProfileSchema.optional(),
});

export const userRanksSchema = z.object({
  mutuals_rank: z.string().nullable(),
  followers_rank: z.string().nullable(),
  following_rank: z.string().nullable(),
  top8_rank: z.string().nullable(),
  blocks_rank: z.string().nullable(),
});

export const detailsResponseSchema = z.object({
  address: z.string(),
  ens: ensProfileSchema.optional(),
  followers_count: z.number(),
  following_count: z.number(),
  ranks: userRanksSchema,
  primary_list: z.string().nullable(),
});

export const statsResponseSchema = z.object({
  followers_count: z.number(),
  following_count: z.number(),
});

export const errorResponseSchema = z.object({
  response: z.string(),
});
