// Google sign-in for any Chromium browser via launchWebAuthFlow. Uses the
// implicit flow (no client secret in the extension). Tokens last ~1 hour and
// are renewed silently while the browser stays signed in to Google.

import { SCOPES } from '../config.js';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const RENEW_MARGIN_MS = 60_000;

export class AuthRequired extends Error {}

// Google's consent screen lets people untick the Drive permission.
export class DriveAccessMissing extends Error {}

const DRIVE_SCOPE = SCOPES.find(s => s.endsWith('/drive.file'));

export function buildAuthUrl({ clientId, redirectUri, interactive, loginHint, forceConsent = false }) {
  const url = new URL(AUTH_URL);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'token');
  url.searchParams.set('scope', SCOPES.join(' '));
  url.searchParams.set('include_granted_scopes', 'true');
  // 'consent' makes Google show the permission checkboxes again.
  url.searchParams.set('prompt', !interactive ? 'none' : forceConsent ? 'consent select_account' : 'select_account');
  if (loginHint) url.searchParams.set('login_hint', loginHint);
  return url.toString();
}

export function parseRedirect(redirectUrl) {
  const params = new URLSearchParams(new URL(redirectUrl).hash.slice(1));
  if (params.get('error')) return { error: params.get('error') };
  const token = params.get('access_token');
  if (!token) return { error: 'no_token' };
  const result = { token, expiresIn: Number(params.get('expires_in')) || 3600 };
  if (params.get('scope')) result.scopes = params.get('scope').split(' ');
  return result;
}

export function createAuth({ identity, session, local, fetchFn, clientId, now }) {
  async function getAccount() {
    const { account } = await local.get('account');
    return account || null;
  }

  async function runFlow(interactive, loginHint, forceConsent = false) {
    let redirect;
    try {
      redirect = await identity.launchWebAuthFlow({
        url: buildAuthUrl({ clientId, redirectUri: identity.getRedirectURL(), interactive, loginHint, forceConsent }),
        interactive,
      });
    } catch (err) {
      throw new AuthRequired(err?.message || 'Sign-in failed');
    }
    const result = parseRedirect(redirect || 'about:blank');
    if (result.error) throw new AuthRequired(result.error);
    if (result.scopes && !result.scopes.includes(DRIVE_SCOPE)) throw new DriveAccessMissing('Drive permission not granted');
    await session.set({ googleToken: { token: result.token, expiresAt: now() + result.expiresIn * 1000 } });
    return result.token;
  }

  async function getToken({ interactive = false } = {}) {
    const { googleToken } = await session.get('googleToken');
    if (googleToken && googleToken.expiresAt - RENEW_MARGIN_MS > now()) return googleToken.token;
    return runFlow(interactive, (await getAccount())?.email);
  }

  async function signIn({ forceConsent = false } = {}) {
    const token = await runFlow(true, undefined, forceConsent);
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
