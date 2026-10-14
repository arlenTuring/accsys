import type { Tx } from '@/lib/workflow/tx';
import { loadOrgSnapshot, referencedRecords } from './load';
import { resolveFlow } from './resolve';
import type { FlowContext, FlowDef, ResolvedStepStatus } from './types';

export type SimulatedStep = {
  label: string;
  approverName: string | null;
  delegatedFromName: string | null;
  status: ResolvedStepStatus;
  note: string | null;
};

export type Simulation =
  | { ok: true; steps: SimulatedStep[]; path: string[]; autoApproved: boolean }
  | { ok: false; error: string; blockLabel: string | null };

function blockLabel(flow: FlowDef, id: string | null): string | null {
  if (!id) return null;
  const stack = [...flow.blocks];
  while (stack.length > 0) {
    const b = stack.pop()!;
    if (b.id === id) return b.label;
    if (b.type === 'condition') stack.push(...b.branches.flatMap((br) => br.blocks), ...b.otherwise.blocks);
  }
  return null;
}

/**
 * Resolves `flow` against the live organisation without writing anything, with
 * names instead of ids. Run it in a read-only transaction.
 */
export async function simulateFlow(tx: Tx, flow: FlowDef, ctx: FlowContext): Promise<Simulation> {
  const org = await loadOrgSnapshot(tx, referencedRecords(flow, ctx.fields), ctx.today);
  const result = resolveFlow(flow, ctx, org);
  if (!result.ok) return { ok: false, error: result.error, blockLabel: blockLabel(flow, result.blockId) };
  const name = (id: string | null) => (id ? (org.employees.get(id)?.name ?? '（已刪除的員工）') : null);
  return {
    ok: true,
    path: result.path,
    autoApproved: !result.steps.some((s) => s.status === 'pending'),
    steps: result.steps.map((s) => ({
      label: s.label,
      approverName: name(s.approverEmployeeId),
      delegatedFromName: name(s.delegatedFromEmployeeId),
      status: s.status,
      note: s.systemNote,
    })),
  };
}
