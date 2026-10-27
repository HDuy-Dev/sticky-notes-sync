// Google sign-in for any Chromium browser via launchWebAuthFlow. Uses the
// implicit flow (no client secret in the extension). Tokens last ~1 hour and
// are renewed silently while the browser stays signed in to Google.

import { SCOPES } from '../config.js';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const RENEW_MARGIN_MS = 60_000;

export class AuthRequired extends Error {}

export function buildAuthUrl({ clientId, redirectUri, interactive, loginHint }) {
  const url = new URL(AUTH_URL);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'token');
  url.searchParams.set('scope', SCOPES.join(' '));
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('prompt', interactive ? 'select_account' : 'none');
  if (loginHint) url.searchParams.set('login_hint', loginHint);
  return url.toString();
}

export function parseRedirect(redirectUrl) {
  const params = new URLSearchParams(new URL(redirectUrl).hash.slice(1));
  if (params.get('error')) return { error: params.get('error') };
  const token = params.get('access_token');
  if (!token) return { error: 'no_token' };
  return { token, expiresIn: Number(params.get('expires_in')) || 3600 };
}

export function createAuth({ identity, session, local, fetchFn, clientId, now }) {
  async function getAccount() {
    const { account } = await local.get('account');
    return account || null;
  }

  async function runFlow(interactive, loginHint) {
    let redirect;
    try {
      redirect = await identity.launchWebAuthFlow({
        url: buildAuthUrl({ clientId, redirectUri: identity.getRedirectURL(), interactive, loginHint }),
        interactive,
      });
    } catch (err) {
      throw new AuthRequired(err?.message || 'Sign-in failed');
    }
    const result = parseRedirect(redirect || 'about:blank');
    if (result.error) throw new AuthRequired(result.error);
    await session.set({ googleToken: { token: result.token, expiresAt: now() + result.expiresIn * 1000 } });
    return result.token;
  }

  async function getToken({ interactive = false } = {}) {
    const { googleToken } = await session.get('googleToken');
    if (googleToken && googleToken.expiresAt - RENEW_MARGIN_MS > now()) return googleToken.token;
    return runFlow(interactive, (await getAccount())?.email);
  }

  async function signIn() {
    const token = await runFlow(true);
    const res = await fetchFn(USERINFO_URL, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new AuthRequired(`userinfo ${res.status}`);
    const { email } = await res.json();
    return { email, token };
  }

  async function signOut() {
    const { googleToken } = await session.get('googleToken');
    if (googleToken) {
      try {
        await fetchFn(`${REVOKE_URL}?token=${encodeURIComponent(googleToken.token)}`, { method: 'POST' });
      } catch {
        // Revoking is best effort; the token expires within the hour anyway.
      }
    }
    await session.remove('googleToken');
    await local.remove('account');
  }

  async function invalidate() {
    await session.remove('googleToken');
  }

  return { getToken, signIn, signOut, getAccount, invalidate };
}
