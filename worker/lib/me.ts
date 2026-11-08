import type { Env } from '../env';
import type { Me, User } from '../../shared/types';

export async function loadMe(env: Env, user: User): Promise<Me> {
  const rows = await env.DB.prepare('SELECT item_id FROM item_access WHERE user_id = ?').bind(user.id).all<{ item_id: string }>();
  return { ...user, itemIds: rows.results.map((row) => row.item_id) };
}
