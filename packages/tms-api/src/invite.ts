type TmsRole = 'therapist' | 'admin';

async function cognitoClient() {
  const { CognitoIdentityProviderClient } = await import('@aws-sdk/client-cognito-identity-provider');
  return new CognitoIdentityProviderClient({});
}

function poolId(): string | null {
  const pool = process.env.TMS_USER_POOL_ID?.trim();
  return pool || null;
}

function isUsernameExists(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const name = 'name' in err ? String(err.name) : '';
  const text = err instanceof Error ? err.message : String(err);
  return name === 'UsernameExistsException' || text.includes('UsernameExistsException');
}

function cognitoGroupForRole(role: TmsRole): 'Admin' | 'Therapist' {
  return role === 'admin' ? 'Admin' : 'Therapist';
}

function otherCognitoGroup(role: TmsRole): 'Admin' | 'Therapist' {
  return role === 'admin' ? 'Therapist' : 'Admin';
}

/** Put the user in the role group and remove the opposite group (best-effort). */
export async function ensureCognitoRoleGroups(username: string, role: TmsRole): Promise<void> {
  const pool = poolId();
  if (!pool) return;
  const { AdminAddUserToGroupCommand, AdminRemoveUserFromGroupCommand } = await import(
    '@aws-sdk/client-cognito-identity-provider'
  );
  const cognito = await cognitoClient();
  await cognito.send(
    new AdminAddUserToGroupCommand({
      UserPoolId: pool,
      Username: username,
      GroupName: cognitoGroupForRole(role),
    }),
  );
  try {
    await cognito.send(
      new AdminRemoveUserFromGroupCommand({
        UserPoolId: pool,
        Username: username,
        GroupName: otherCognitoGroup(role),
      }),
    );
  } catch {
    // Already absent from the other group.
  }
}

/**
 * Create Cognito login (or reuse existing) and sync Admin/Therapist group to `role`.
 * Returns Cognito username. When the pool is unset, returns a local placeholder.
 */
export async function inviteTherapist(email: string, displayName: string, role: TmsRole): Promise<string> {
  const pool = poolId();
  if (!pool) return `local-invite:${email}`;
  const { AdminCreateUserCommand } = await import('@aws-sdk/client-cognito-identity-provider');
  const cognito = await cognitoClient();
  let username = email;
  try {
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
    username = created.User?.Username || email;
  } catch (err) {
    if (!isUsernameExists(err)) throw err;
    // Existing Cognito user: still sync groups so admin invites cannot stay Therapist-only.
    username = email;
  }
  await ensureCognitoRoleGroups(username, role);
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
  const group = cognitoGroupForRole(role);
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
