import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getRequiredEnv } from '@/lib/env';
import { isAllowedEmail } from '@/lib/auth/allowed-domain';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=auth_failed`);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(`${origin}/login?error=auth_failed`);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const allowedDomain = getRequiredEnv('ALLOWED_GOOGLE_DOMAIN');

  if (!user?.email || !isAllowedEmail(user.email, allowedDomain)) {
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/login?error=domain_not_allowed`);
  }

  return NextResponse.redirect(`${origin}/dashboard`);
}
