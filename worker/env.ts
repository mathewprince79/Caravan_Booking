import type { User } from '../shared/types';

export interface Env {
  DB: D1Database;
  MEDIA: KVNamespace;
  ASSETS: Fetcher;
  APP_NAME?: string;
  APP_URL?: string;
  DEFAULT_TIMEZONE?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  RESEND_API_KEY?: string;
  BREVO_API_KEY?: string;
  EMAIL_FROM?: string;
  /** Testing hook: overrides the provider API base. Never set in production. */
  EMAIL_API_BASE?: string;
  ADMIN_EMAILS?: string;
}

export interface AppVariables {
  user: User;
}

export type AppBindings = {
  Bindings: Env;
  Variables: AppVariables;
};
