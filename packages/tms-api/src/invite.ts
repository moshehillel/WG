type TmsRole = 'therapist' | 'admin';

async function cognitoClient() {
  const { CognitoIdentityProviderClient } = await import('@aws-sdk/client-cognito-identity-provider');
  return new CognitoIdentityProviderClient({});
}

function poolId(): string | null {
  const pool = process.env.TMS_USER_POOL_ID?.trim();
  return pool || null;
}

export async function inviteTherapist(email: string, displayName: string, role: TmsRole): Promise<string> {
  const pool = poolId();
  if (!pool) return `local-invite:${email}`;
  const { AdminCreateUserCommand, AdminAddUserToGroupCommand } = await import(
    '@aws-sdk/client-cognito-identity-provider'
  );
  const cognito = await cognitoClient();
  const created = await cognito.send(
    new AdminCreateUserCommand({
      UserPoolId: pool,
      Username: email,
      UserAttributes: [
        { Name: 'email', Value: email },
        { Name: 'email_verified', Value: 'true' },
        { Name: 'name', Value: displayName || email },
      ],
      DesiredDeliveryMediums: ['EMAIL'],
    }),
  );
  const group = role === 'admin' ? 'Admin' : 'Therapist';
  const username = created.User?.Username || email;
  await cognito.send(
    new AdminAddUserToGroupCommand({
      UserPoolId: pool,
      Username: username,
      GroupName: group,
    }),
  );
  return username;
}

/** Disable Cognito login and drop Admin group membership (best-effort). */
export async function deactivateCognitoLogin(usernameOrEmail: string, role: TmsRole): Promise<void> {
  const pool = poolId();
  if (!pool) return;
  const {
    AdminDisableUserCommand,
    AdminRemoveUserFromGroupCommand,
  } = await import('@aws-sdk/client-cognito-identity-provider');
  const cognito = await cognitoClient();
  const username = usernameOrEmail;
  const group = role === 'admin' ? 'Admin' : 'Therapist';
  try {
    await cognito.send(
      new AdminRemoveUserFromGroupCommand({
        UserPoolId: pool,
        Username: username,
        GroupName: group,
      }),
    );
  } catch {
    // User may already be out of the group or only exist in app state.
  }
  await cognito.send(
    new AdminDisableUserCommand({
      UserPoolId: pool,
      Username: username,
    }),
  );
}

function isLocalInviteUsername(value: string): boolean {
  return value.startsWith('invite-') || value.startsWith('local-invite:');
}

function isUserNotFound(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const name = 'name' in err ? String(err.name) : '';
  const text = err instanceof Error ? err.message : String(err);
  return name === 'UserNotFoundException' || text.includes('UserNotFound');
}

/** Permanently remove the Cognito user (best-effort across sub vs email username). */
export async function deleteCognitoLogin(cognitoSub: string, email: string): Promise<void> {
  const pool = poolId();
  if (!pool) return;
  const { AdminDeleteUserCommand } = await import('@aws-sdk/client-cognito-identity-provider');
  const cognito = await cognitoClient();
  const tried = new Set<string>();
  const candidates = [cognitoSub, email].map((v) => v.trim()).filter(Boolean);
  let lastErr: unknown;
  for (const username of candidates) {
    if (isLocalInviteUsername(username) || tried.has(username.toLowerCase())) continue;
    tried.add(username.toLowerCase());
    try {
      await cognito.send(
        new AdminDeleteUserCommand({
          UserPoolId: pool,
          Username: username,
        }),
      );
      return;
    } catch (err) {
      lastErr = err;
      if (isUserNotFound(err)) continue;
    }
  }
  if (tried.size === 0) return;
  if (lastErr && !isUserNotFound(lastErr)) throw lastErr;
}
