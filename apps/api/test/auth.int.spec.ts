import { currentTotp } from '@healthcare/auth';
import { as, auditRows, createStaff, createTenant, createTestApp, login, PASSWORD, type Tenant, type TestContext } from './harness';

describe('authentication', () => {
  let ctx: TestContext;
  let tenant: Tenant;

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, 'auth-org');
    await createStaff(ctx.pool, tenant, 'nurse@example.ph', ['nurse']);
  });

  afterAll(() => ctx.close());

  it('signs in, exposes the effective permissions and audits the login', async () => {
    const { accessToken } = await login(ctx, 'nurse@example.ph');
    const me = await ctx.http().get('/api/v1/auth/me').set(as(accessToken)).expect(200);
    expect(me.body.organization.id).toBe(tenant.organizationId);
    expect(me.body.permissions).toContain('patient.register');
    expect(me.body.permissions).not.toContain('user.manage');
    const [event] = await auditRows(ctx.pool, `action = 'auth.login' AND outcome = 'success'`);
    expect(event).toMatchObject({ actor_type: 'user' });
  });

  it('rejects unauthenticated requests with the standard error envelope', async () => {
    const response = await ctx.http().get('/api/v1/patients?q=juan').expect(401);
    expect(response.body.error).toMatchObject({ code: 'unauthenticated' });
    expect(response.body.error.requestId).toBeDefined();
    expect(response.headers['x-request-id']).toBe(response.body.error.requestId);
  });

  it('does not reveal whether an email is registered', async () => {
    const unknown = await ctx.http().post('/api/v1/auth/login').send({ email: 'nobody@example.ph', password: PASSWORD }).expect(401);
    const wrong = await ctx
      .http()
      .post('/api/v1/auth/login')
      .send({ email: 'nurse@example.ph', password: 'wrong-password-123' })
      .expect(401);
    expect(unknown.body.error.code).toBe('invalid_credentials');
    expect(wrong.body.error.code).toBe('invalid_credentials');
  });

  it('locks the account after repeated failures, even with the right password', async () => {
    await createStaff(ctx.pool, tenant, 'locked@example.ph', ['nurse']);
    for (let i = 0; i < 5; i++) {
      await ctx.http().post('/api/v1/auth/login').send({ email: 'locked@example.ph', password: 'wrong-password-123' }).expect(401);
    }
    const response = await ctx.http().post('/api/v1/auth/login').send({ email: 'locked@example.ph', password: PASSWORD }).expect(401);
    expect(response.body.error.code).toBe('account_locked');
  });

  it('rotates refresh tokens and revokes the session when an old token is replayed', async () => {
    const first = await login(ctx, 'nurse@example.ph');
    const rotated = await ctx.http().post('/api/v1/auth/refresh').send({ refreshToken: first.refreshToken }).expect(200);
    expect(rotated.body.refreshToken).not.toBe(first.refreshToken);

    // Replaying the rotated-out token signals theft: the whole session ends.
    await ctx.http().post('/api/v1/auth/refresh').send({ refreshToken: first.refreshToken }).expect(401);
    await ctx.http().post('/api/v1/auth/refresh').send({ refreshToken: rotated.body.refreshToken }).expect(401);
    await ctx.http().get('/api/v1/auth/me').set(as(rotated.body.accessToken)).expect(401);
    const reuse = await auditRows(ctx.pool, `reason = 'refresh_token_reuse'`);
    expect(reuse).toHaveLength(1);
  });

  it('ends access immediately on logout', async () => {
    const { accessToken } = await login(ctx, 'nurse@example.ph');
    await ctx.http().post('/api/v1/auth/logout').set(as(accessToken)).expect(204);
    const response = await ctx.http().get('/api/v1/auth/me').set(as(accessToken)).expect(401);
    expect(response.body.error.code).toBe('session_ended');
  });

  it('enrolls TOTP MFA and then requires it at sign-in', async () => {
    await createStaff(ctx.pool, tenant, 'doctor@example.ph', ['physician']);
    const { accessToken } = await login(ctx, 'doctor@example.ph');
    const setup = await ctx.http().post('/api/v1/auth/mfa/setup').set(as(accessToken)).expect(201);
    expect(setup.body.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
    await ctx.http().post('/api/v1/auth/mfa/confirm').set(as(accessToken)).send({ code: '000000' }).expect(422);
    await ctx
      .http()
      .post('/api/v1/auth/mfa/confirm')
      .set(as(accessToken))
      .send({ code: currentTotp(setup.body.secret) })
      .expect(204);

    const stored = await ctx.pool.query(`SELECT mfa_secret_encrypted FROM app_user WHERE email = 'doctor@example.ph'`);
    expect(stored.rows[0].mfa_secret_encrypted).not.toContain(setup.body.secret);

    const challenge = await ctx.http().post('/api/v1/auth/login').send({ email: 'doctor@example.ph', password: PASSWORD }).expect(200);
    expect(challenge.body).toEqual({ status: 'mfa_required', challengeToken: expect.any(String) });
    await ctx.http().post('/api/v1/auth/mfa/verify').send({ challengeToken: challenge.body.challengeToken, code: '000000' }).expect(401);
    const verified = await ctx
      .http()
      .post('/api/v1/auth/mfa/verify')
      .send({ challengeToken: challenge.body.challengeToken, code: currentTotp(setup.body.secret) })
      .expect(200);
    expect(verified.body.status).toBe('authenticated');
    // A challenge token is not an access token.
    await ctx.http().get('/api/v1/auth/me').set(as(challenge.body.challengeToken)).expect(401);
  });

  it('signs out other sessions when the password changes', async () => {
    await createStaff(ctx.pool, tenant, 'clerk@example.ph', ['receptionist']);
    const other = await login(ctx, 'clerk@example.ph');
    const current = await login(ctx, 'clerk@example.ph');
    await ctx
      .http()
      .post('/api/v1/auth/password')
      .set(as(current.accessToken))
      .send({ currentPassword: PASSWORD, newPassword: 'A-Brand-New-Passphrase-7' })
      .expect(204);
    await ctx.http().get('/api/v1/auth/me').set(as(other.accessToken)).expect(401);
    await ctx.http().get('/api/v1/auth/me').set(as(current.accessToken)).expect(200);
  });

  it('asks users with several organizations to choose one', async () => {
    const second = await createTenant(ctx.pool, 'second-org');
    await createStaff(ctx.pool, second, 'nurse@example.ph', ['nurse']);
    const response = await ctx.http().post('/api/v1/auth/login').send({ email: 'nurse@example.ph', password: PASSWORD }).expect(409);
    expect(response.body.error.code).toBe('organization_selection_required');
    expect(response.body.error.details.organizations).toHaveLength(2);
    const chosen = await login(ctx, 'nurse@example.ph', second.organizationId);
    const me = await ctx.http().get('/api/v1/auth/me').set(as(chosen.accessToken)).expect(200);
    expect(me.body.organization.id).toBe(second.organizationId);
  });
});
