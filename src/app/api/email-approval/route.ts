import { NextResponse, type NextRequest } from 'next/server';
import { submitEmailApprovalDecision } from '@/app/email-approval/actions';

export const dynamic = 'force-dynamic';

function buildAmpCorsHeaders(request?: NextRequest): Record<string, string> {
  const origin = request?.headers.get('origin') || '*';
  const sourceOrigin =
    request?.nextUrl.searchParams.get('__amp_source_origin') ||
    request?.headers.get('amp-same-origin') ||
    '';

  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, AMP-Same-Origin',
    'Access-Control-Allow-Credentials': 'true',
  };

  if (sourceOrigin) {
    headers['AMP-Access-Control-Allow-Source-Origin'] = sourceOrigin;
    headers['Access-Control-Expose-Headers'] =
      'AMP-Access-Control-Allow-Source-Origin';
  } else {
    headers['Access-Control-Expose-Headers'] =
      'AMP-Access-Control-Allow-Source-Origin';
  }
  return headers;
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: buildAmpCorsHeaders(request),
  });
}

export async function POST(request: NextRequest) {
  const corsHeaders = buildAmpCorsHeaders(request);
  try {
    let token = '';
    let decision: 'approve' | 'return' = 'approve';
    let reason: string | undefined;

    const contentType = request.headers.get('content-type') || '';
    if (
      contentType.includes('multipart/form-data') ||
      contentType.includes('application/x-www-form-urlencoded')
    ) {
      const formData = await request.formData();
      token = String(formData.get('token') ?? '');
      decision = formData.get('decision') === 'return' ? 'return' : 'approve';
      const rawReason = formData.get('reason');
      reason = typeof rawReason === 'string' ? rawReason : undefined;
    } else {
      const body = (await request.json().catch(() => ({}))) as {
        token?: string;
        decision?: 'approve' | 'return';
        reason?: string;
      };
      token = typeof body.token === 'string' ? body.token : '';
      decision = body.decision === 'return' ? 'return' : 'approve';
      reason = typeof body.reason === 'string' ? body.reason : undefined;
    }

    const result = await submitEmailApprovalDecision({
      token,
      decision,
      confirmedDetails: true,
      reason,
    });

    return NextResponse.json(result, {
      status: result.ok ? 200 : 400,
      headers: corsHeaders,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : '簽核 API 發生未預期錯誤',
      },
      { status: 500, headers: corsHeaders }
    );
  }
}
