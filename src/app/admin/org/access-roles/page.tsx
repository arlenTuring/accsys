import { redirect } from 'next/navigation';

/** Roles live under 帳號與權限; keep this path as a redirect for old bookmarks. */
export default function AccessRolesRedirectPage() {
  redirect('/admin/accounts/roles');
}
