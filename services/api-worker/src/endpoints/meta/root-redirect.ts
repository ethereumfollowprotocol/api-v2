import type { AppContext } from '../../types.js';

export function handleRootRedirect(c: AppContext) {
  return c.redirect('/api/v1', 301);
}
