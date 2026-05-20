import { countUsers } from './user.repo';

export async function isAdminSetupAvailable(db: D1Database): Promise<boolean> {
  const userCount = await countUsers(db);
  return userCount === 0;
}
