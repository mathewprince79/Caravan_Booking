import type { Context } from 'hono';
import type { AppBindings } from '../env';

export async function readBody<T = any>(c: Context<AppBindings>): Promise<T> {
  try {
    return (await c.req.json()) as T;
  } catch {
    return {} as T;
  }
}
