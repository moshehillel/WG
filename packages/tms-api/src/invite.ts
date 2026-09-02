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
