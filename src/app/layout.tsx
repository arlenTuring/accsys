import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '台灣智慧駕駛 電子採購與簽核系統',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
