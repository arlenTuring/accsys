'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

export function TopNav({ employeeName }: { employeeName: string }) {
  const router = useRouter();
  return (
    <div className="flex items-center gap-4 border-b bg-gray-50 px-4 py-2 text-sm">
      <button
        type="button"
        onClick={() => router.back()}
        className="text-gray-600 hover:underline"
      >
        ← 上一頁
      </button>
      <Link href="/dashboard" className="text-gray-600 hover:underline">
        🏠 儀表板
      </Link>
      <span className="ml-auto text-gray-400">{employeeName}</span>
    </div>
  );
}
