import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { getServerI18n } from '@/lib/i18n/server';
import { ApplicationsDraftLibrary } from './applications-draft-library';

export default async function ApplicationsDraftsPage() {
  const employee = await getCurrentEmployee();
  if (!employee) redirect('/login?returnTo=/applications/drafts');
  const { t } = await getServerI18n();

  return (
    <main className="page-shell space-y-6">
      <section>
        <p className="section-title">{t.draftsPage.sectionTitle}</p>
        <h1 className="page-title">{t.draftsPage.title}</h1>
        <p className="page-subtitle">{t.draftsPage.subtitle}</p>
        <p className="mt-2 text-sm">
          <Link className="underline" href="/f">
            {t.draftsPage.otherFormsLink}
          </Link>
          {' · '}
          <Link className="underline" href="/tools/ai-chat">
            {t.draftsPage.aiAssistantLink}
          </Link>
        </p>
      </section>
      <ApplicationsDraftLibrary />
    </main>
  );
}
