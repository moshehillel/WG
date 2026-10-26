import { resolveSessionCoordinatorIds } from '@white-glove/shared';

/** Sessions unscheduled-visit coordinators. Ignores any other configured id. */
export async function resolveEntCoordinatorIds(
  _token?: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  return resolveSessionCoordinatorIds(env.HHA_ENT_COORDINATOR_ID);
}

export async function fetchServiceCoordinators(
  ..._args: unknown[]
): Promise<Array<{ text: string; value: string }>> {
  return [
    { text: 'Billu Markowitz', value: '84898' },
    { text: 'Grace Greenfeld', value: '67321' },
    { text: 'Grace Greenfeld', value: '67322' },
  ];
}
