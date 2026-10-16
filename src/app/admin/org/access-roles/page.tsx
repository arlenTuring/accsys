import { listAccessRoles } from '@/lib/admin/access-roles/queries';
import { AccessRolesManager } from './access-roles-manager';

export default async function AccessRolesPage() {
  const roles = await listAccessRoles();
  return <AccessRolesManager roles={roles} />;
}
