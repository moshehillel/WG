export async function inviteTherapist(email: string, displayName: string, role: 'therapist' | 'admin'): Promise<string> {
  const pool = process.env.TMS_USER_POOL_ID?.trim();
  if (!pool) return `local-invite:${email}`;
  const { CognitoIdentityProviderClient, AdminCreateUserCommand, AdminAddUserToGroupCommand } =
    await import('@aws-sdk/client-cognito-identity-provider');
  const cognito = new CognitoIdentityProviderClient({});
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
  await cognito.send(
    new AdminAddUserToGroupCommand({
      UserPoolId: pool,
      Username: created.User?.Username || email,
      GroupName: group,
    }),
  );
  return created.User?.Username || email;
}
