'use client';

import { DraftPanel } from '@/app/tools/ai-chat/draft-panel';

/** Full-page editor reusing the same DraftPanel / draft ID as the AI assistant. */
export function DraftFullEditor(props: { draftId: string; conversationId: string; initialVersion: number }) {
  return (
    <div className="card p-3 sm:p-4">
      <DraftPanel
        draftId={props.draftId}
        conversationId={props.conversationId}
        refreshKey={props.initialVersion}
      />
    </div>
  );
}
