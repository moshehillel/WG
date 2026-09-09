/** Clear Cognito MFA preferences so USER_PASSWORD_AUTH is password-only. */

async function cognitoClient() {
  const { CognitoIdentityProviderClient } = await import('@aws-sdk/client-cognito-identity-provider');
  return new CognitoIdentityProviderClient({});
}

function poolId(): string | null {
  const pool = process.env.TMS_USER_POOL_ID?.trim();
  return pool || null;
}

const disabledMfa = {
  SoftwareTokenMfaSettings: { Enabled: false, PreferredMfa: false },
  SMSMfaSettings: { Enabled: false, PreferredMfa: false },
  EmailMfaSettings: { Enabled: false, PreferredMfa: false },
} as const;

/**
 * When org requireMfa is off, enrolled users still get EMAIL_OTP / TOTP challenges
 * because Cognito OPTIONAL MFA still honors PreferredMfaSetting. Clearing preferences
 * restores password-only login until a user opts back in.
 */
export async function clearAllCognitoMfaPreferences(): Promise<{
  cleared: number;
  errors: number;
  skipped: boolean;
}> {
  const pool = poolId();
  if (!pool) return { cleared: 0, errors: 0, skipped: true };

  const { ListUsersCommand, AdminSetUserMFAPreferenceCommand } = await import(
    '@aws-sdk/client-cognito-identity-provider'
  );
  const cognito = await cognitoClient();
  let cleared = 0;
  let errors = 0;
  let paginationToken: string | undefined;

  do {
    const page = await cognito.send(
      new ListUsersCommand({
        UserPoolId: pool,
        Limit: 60,
        PaginationToken: paginationToken,
      }),
    );
    for (const user of page.Users || []) {
      const username = user.Username;
      if (!username) continue;
      try {
        await cognito.send(
          new AdminSetUserMFAPreferenceCommand({
            UserPoolId: pool,
            Username: username,
            ...disabledMfa,
          }),
        );
        cleared += 1;
      } catch {
        errors += 1;
      }
    }
    paginationToken = page.PaginationToken;
  } while (paginationToken);

  return { cleared, errors, skipped: false };
}
