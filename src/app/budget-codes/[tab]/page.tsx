import { renderBudgetPlatformPage } from '../page';

export default async function BudgetCodesSubPage({
  params,
}: {
  params: Promise<{ tab: string }>;
}) {
  const { tab } = await params;
  return renderBudgetPlatformPage(tab);
}
