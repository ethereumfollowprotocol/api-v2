import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import { UserAccount } from './account.js';
import { UserDetails } from './details.js';
import { UserStats } from './stats.js';

export const usersRouter = fromHono(new Hono());

usersRouter.get('/:addressOrENS/account', UserAccount);
usersRouter.get('/:addressOrENS/details', UserDetails);
usersRouter.get('/:addressOrENS/stats', UserStats);
