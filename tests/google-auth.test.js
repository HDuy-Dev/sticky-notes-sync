import test from 'node:test';
import assert from 'node:assert/strict';
import { AuthRequired, DriveAccessMissing, buildAuthUrl, parseRedirect, createAuth } from '../src/lib/google-auth.js';

const REDIRECT = 'https://abc.chromiumapp.org/';

function memoryArea(initial = {}) {
  const data = { ...initial };
  return {
    data,
    get: async key => (key in data ? { [key]: data[key] } : {}),
    set: async obj => Object.assign(data, obj),
    remove: async key => { delete data[key]; },
  };
}

function harness({ flow, session = {}, local = {}, nowMs = 1_000_000 } = {}) {
  const h = { flows: [], fetches: [], now: nowMs };
  h.session = memoryArea(session);
  h.local = memoryArea(local);
  h.auth = createAuth({
    identity: {
      getRedirectURL: () => REDIRECT,
      launchWebAuthFlow: async opts => { h.flows.push(opts); return flow ? flow(opts) : `${REDIRECT}#access_token=T1&expires_in=3600`; },
    },
    session: h.session,
    local: h.local,
    fetchFn: async (url, init) => {
      h.fetches.push({ url, init });
      return { ok: true, status: 200, json: async () => ({ email: 'a@x.com' }) };
    },
    clientId: 'cid',
    now: () => h.now,
  });
  return h;
}

test('buildAuthUrl silent vs interactive', () => {
  const i = new URL(buildAuthUrl({ clientId: 'cid', redirectUri: REDIRECT, interactive: true }));
  assert.equal(i.origin + i.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(i.searchParams.get('client_id'), 'cid');
  assert.equal(i.searchParams.get('redirect_uri'), REDIRECT);
  assert.equal(i.searchParams.get('response_type'), 'token');
  assert.equal(i.searchParams.get('scope'), 'openid email https://www.googleapis.com/auth/drive.file');
  assert.equal(i.searchParams.get('prompt'), 'select_account');
  assert.equal(i.searchParams.get('login_hint'), null);

  const s = new URL(buildAuthUrl({ clientId: 'cid', redirectUri: REDIRECT, interactive: false, loginHint: 'a@x.com' }));
  assert.equal(s.searchParams.get('prompt'), 'none');
  assert.equal(s.searchParams.get('login_hint'), 'a@x.com');
});

test('parseRedirect token and error', () => {
  assert.deepEqual(parseRedirect(`${REDIRECT}#access_token=abc&token_type=Bearer&expires_in=3599`), { token: 'abc', expiresIn: 3599 });
  assert.deepEqual(parseRedirect(`${REDIRECT}#error=interaction_required`), { error: 'interaction_required' });
  assert.deepEqual(parseRedirect(`${REDIRECT}`), { error: 'no_token' });
});

test('cached token reused', async () => {
  const h = harness({ session: { googleToken: { token: 'C', expiresAt: 1_000_000 + 120_000 } } });
  assert.equal(await h.auth.getToken({ interactive: false }), 'C');
  assert.equal(h.flows.length, 0);
});

test('silent renewal', async () => {
  const h = harness({ session: { googleToken: { token: 'C', expiresAt: 1_000_000 + 30_000 } }, local: { account: { email: 'a@x.com' } } });
  assert.equal(await h.auth.getToken({ interactive: false }), 'T1');
  assert.equal(h.flows.length, 1);
  assert.equal(h.flows[0].interactive, false);
  const url = new URL(h.flows[0].url);
  assert.equal(url.searchParams.get('prompt'), 'none');
  assert.equal(url.searchParams.get('login_hint'), 'a@x.com');
  assert.deepEqual(h.session.data.googleToken, { token: 'T1', expiresAt: 1_000_000 + 3_600_000 });
});

test('silent failure throws AuthRequired', async () => {
  const thrown = harness({ flow: () => { throw new Error('User interaction required.'); } });
  await assert.rejects(thrown.auth.getToken({ interactive: false }), AuthRequired);
  const errored = harness({ flow: () => `${REDIRECT}#error=interaction_required` });
  await assert.rejects(errored.auth.getToken({ interactive: false }), AuthRequired);
});

test('signIn returns email without storing the account', async () => {
  const h = harness();
  assert.deepEqual(await h.auth.signIn(), { email: 'a@x.com', token: 'T1' });
  assert.equal(h.flows[0].interactive, true);
  assert.equal(h.fetches[0].url, 'https://openidconnect.googleapis.com/v1/userinfo');
  assert.equal(h.fetches[0].init.headers.Authorization, 'Bearer T1');
  assert.equal(h.session.data.googleToken.token, 'T1');
  assert.equal(h.local.data.account, undefined);
});

test('signIn cancelled by the user throws AuthRequired', async () => {
  const h = harness({ flow: () => { throw new Error('The user did not approve access.'); } });
  await assert.rejects(h.auth.signIn(), AuthRequired);
});

test('signOut revokes and clears', async () => {
  const h = harness({ session: { googleToken: { token: 'C', expiresAt: 2_000_000 } }, local: { account: { email: 'a@x.com' } } });
  await h.auth.signOut();
  assert.equal(h.fetches[0].url, 'https://oauth2.googleapis.com/revoke?token=C');
  assert.equal(h.fetches[0].init.method, 'POST');
  assert.equal(h.session.data.googleToken, undefined);
  assert.equal(h.local.data.account, undefined);
  assert.equal(await h.auth.getAccount(), null);
});

test('invalidate drops the cached token', async () => {
  const h = harness({ session: { googleToken: { token: 'C', expiresAt: 9_000_000 } } });
  await h.auth.invalidate();
  assert.equal(await h.auth.getToken({ interactive: false }), 'T1');
});

const DRIVE = 'https://www.googleapis.com/auth/drive.file';

test('parseRedirect returns granted scopes', () => {
  const r = parseRedirect(`${REDIRECT}#access_token=abc&expires_in=10&scope=email%20openid%20${encodeURIComponent(DRIVE)}`);
  assert.deepEqual(r, { token: 'abc', expiresIn: 10, scopes: ['email', 'openid', DRIVE] });
});

test('buildAuthUrl can force the consent screen', () => {
  const u = new URL(buildAuthUrl({ clientId: 'cid', redirectUri: REDIRECT, interactive: true, forceConsent: true }));
  assert.equal(u.searchParams.get('prompt'), 'consent select_account');
});

test('signIn without the Drive permission throws DriveAccessMissing', async () => {
  const h = harness({ flow: () => `${REDIRECT}#access_token=T1&expires_in=3600&scope=email%20openid` });
  await assert.rejects(h.auth.signIn(), DriveAccessMissing);
  assert.equal(h.session.data.googleToken, undefined);
  assert.equal(h.fetches.length, 0);
});

test('signIn with forceConsent asks Google to show the consent screen again', async () => {
  const h = harness({ flow: () => `${REDIRECT}#access_token=T1&expires_in=3600&scope=email%20${encodeURIComponent(DRIVE)}` });
  await h.auth.signIn({ forceConsent: true });
  assert.equal(new URL(h.flows[0].url).searchParams.get('prompt'), 'consent select_account');
});

test('silent renewal without the Drive permission throws DriveAccessMissing', async () => {
  const h = harness({ flow: () => `${REDIRECT}#access_token=T2&expires_in=3600&scope=email` });
  await assert.rejects(h.auth.getToken({ interactive: false }), DriveAccessMissing);
});
