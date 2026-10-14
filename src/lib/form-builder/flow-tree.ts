import type { ConditionBlock, FlowBlock, FlowDef } from '@/lib/approval/flow/types';

/**
 * Immutable edits of the block tree. Every block and branch id is unique in a
 * flow, so a list is addressed by the condition block and branch holding it
 * (null = the top level). Client-safe.
 */

export type ListRef = null | { conditionId: string; branchId: string | 'otherwise' };

export function sameList(a: ListRef, b: ListRef): boolean {
  if (a === null || b === null) return a === b;
  return a.conditionId === b.conditionId && a.branchId === b.branchId;
}

/** Every block and branch id in the flow. */
export function flowIds(blocks: FlowBlock[]): string[] {
  const out: string[] = [];
  const visit = (list: FlowBlock[]) => {
    for (const b of list) {
      out.push(b.id);
      if (b.type === 'condition') {
        for (const br of b.branches) {
          out.push(br.id);
          visit(br.blocks);
        }
        visit(b.otherwise.blocks);
      }
    }
  };
  visit(blocks);
  return out;
}

function mapLists(blocks: FlowBlock[], ref: ListRef, fn: (list: FlowBlock[]) => FlowBlock[]): FlowBlock[] {
  if (ref === null) return fn(blocks);
  return blocks.map((b) => {
    if (b.type !== 'condition') return b;
    if (b.id === ref.conditionId) {
      return ref.branchId === 'otherwise'
        ? { ...b, otherwise: { ...b.otherwise, blocks: fn(b.otherwise.blocks) } }
        : { ...b, branches: b.branches.map((br) => (br.id === ref.branchId ? { ...br, blocks: fn(br.blocks) } : br)) };
    }
    return {
      ...b,
      branches: b.branches.map((br) => ({ ...br, blocks: mapLists(br.blocks, ref, fn) })),
      otherwise: { ...b.otherwise, blocks: mapLists(b.otherwise.blocks, ref, fn) },
    };
  });
}

/** The list holding block `id` and its index there. */
export function locate(blocks: FlowBlock[], id: string, ref: ListRef = null): { ref: ListRef; index: number } | null {
  for (let i = 0; i < blocks.length; i += 1) {
    const b = blocks[i];
    if (b.id === id) return { ref, index: i };
    if (b.type === 'condition') {
      for (const br of b.branches) {
        const hit = locate(br.blocks, id, { conditionId: b.id, branchId: br.id });
        if (hit) return hit;
      }
      const hit = locate(b.otherwise.blocks, id, { conditionId: b.id, branchId: 'otherwise' });
      if (hit) return hit;
    }
  }
  return null;
}

export function findBlock(blocks: FlowBlock[], id: string): FlowBlock | null {
  for (const b of blocks) {
    if (b.id === id) return b;
    if (b.type === 'condition') {
      const hit = findBlock([...b.branches.flatMap((br) => br.blocks), ...b.otherwise.blocks], id);
      if (hit) return hit;
    }
  }
  return null;
}

export function insertBlock(blocks: FlowBlock[], ref: ListRef, index: number, block: FlowBlock): FlowBlock[] {
  return mapLists(blocks, ref, (list) => [...list.slice(0, index), block, ...list.slice(index)]);
}

export function removeBlock(blocks: FlowBlock[], id: string): FlowBlock[] {
  const at = locate(blocks, id);
  if (!at) return blocks;
  return mapLists(blocks, at.ref, (list) => list.filter((b) => b.id !== id));
}

export function updateBlock(blocks: FlowBlock[], id: string, fn: (b: FlowBlock) => FlowBlock): FlowBlock[] {
  const at = locate(blocks, id);
  if (!at) return blocks;
  return mapLists(blocks, at.ref, (list) => list.map((b) => (b.id === id ? fn(b) : b)));
}

/**
 * Moves block `id` to `index` of list `ref` (index counted before the move).
 * Refused (returns the input) when a condition block would land inside itself.
 */
export function moveBlock(blocks: FlowBlock[], id: string, ref: ListRef, index: number): FlowBlock[] {
  const from = locate(blocks, id);
  const block = findBlock(blocks, id);
  if (!from || !block) return blocks;
  if (ref !== null && block.type === 'condition' && (ref.conditionId === id || flowIds([block]).includes(ref.conditionId))) return blocks;
  const target = sameList(from.ref, ref) && from.index < index ? index - 1 : index;
  if (sameList(from.ref, ref) && target === from.index) return blocks;
  return insertBlock(removeBlock(blocks, id), ref, target, block);
}

export function updateFlowBlocks(flow: FlowDef, fn: (blocks: FlowBlock[]) => FlowBlock[]): FlowDef {
  return { ...flow, blocks: fn(flow.blocks) };
}

export function updateCondition(blocks: FlowBlock[], id: string, fn: (b: ConditionBlock) => ConditionBlock): FlowBlock[] {
  return updateBlock(blocks, id, (b) => (b.type === 'condition' ? fn(b) : b));
}
