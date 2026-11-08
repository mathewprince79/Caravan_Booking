import { fromBase64Url } from './util';

export interface GoogleProfile {
  sub: string;
  email: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
}

export async function exchangeGoogleCode(params: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<{ id_token: string; access_token: string }> {
  const body = new URLSearchParams({
    code: params.code,
    client_id: params.clientId,
    client_secret: params.clientSecret,
    redirect_uri: params.redirectUri,
    grant_type: 'authorization_code',
  });
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!response.ok) throw new Error(`Google token exchange failed (${response.status})`);
  return response.json<{ id_token: string; access_token: string }>();
}

export async function verifyGoogleIdToken(idToken: string, clientId: string): Promise<GoogleProfile> {
  const [headerPart, payloadPart, signaturePart] = idToken.split('.');
  if (!headerPart || !payloadPart || !signaturePart) throw new Error('Malformed Google ID token');

  const decoder = new TextDecoder();
  const header = JSON.parse(decoder.decode(fromBase64Url(headerPart)));
  const payload = JSON.parse(decoder.decode(fromBase64Url(payloadPart)));

  const response = await fetch('https://www.googleapis.com/oauth2/v3/certs');
  if (!response.ok) throw new Error('Could not load Google signing keys');
  const certs = (await response.json()) as { keys: (JsonWebKey & { kid?: string })[] };
  const jwk = (certs.keys ?? []).find((key) => key.kid === header.kid);
  if (!jwk) throw new Error('Unknown Google signing key');

  const cryptoKey = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    fromBase64Url(signaturePart) as unknown as BufferSource,
    new TextEncoder().encode(`${headerPart}.${payloadPart}`),
  );
  if (!valid) throw new Error('Google token signature is invalid');
  if (payload.aud !== clientId) throw new Error('Google token audience mismatch');
  if (payload.iss !== 'accounts.google.com' && payload.iss !== 'https://accounts.google.com') {
    throw new Error('Google token issuer mismatch');
  }
  if (Number(payload.exp) * 1000 <= Date.now()) throw new Error('Google token expired');
  if (!payload.email) throw new Error('Google account has no email');

  return payload as GoogleProfile;
}
