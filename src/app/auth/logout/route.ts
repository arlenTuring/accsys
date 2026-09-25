import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';

export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  const session = await getSession();
  session.destroy();
  return NextResponse.redirect(`${origin}/login`);
}
