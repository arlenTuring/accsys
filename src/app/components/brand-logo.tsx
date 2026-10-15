import Image from 'next/image';
import Link from 'next/link';
import mark from './turing-drive-mark.png';

type BrandLogoProps = {
  variant?: 'light' | 'dark';
  showProduct?: boolean;
  href?: string;
  className?: string;
};

export function BrandLogo({
  variant = 'dark',
  showProduct = true,
  href = '/dashboard',
  className = '',
}: BrandLogoProps) {
  const isLight = variant === 'light';
  const markClass = isLight ? '' : 'ring-1 ring-black/10';
  const titleClass = isLight ? 'text-white' : 'text-td-blue-dark';
  const subtitleClass = isLight ? 'text-white/75' : 'text-td-muted';
  const productClass = isLight ? 'text-td-apex' : 'text-td-blue';

  const content = (
    <div className={`flex items-center gap-3 ${className}`}>
      <div
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white p-1.5 ${markClass} shadow-sm`}
        aria-hidden
      >
        <Image src={mark} alt="" className="h-full w-full object-contain" sizes="40px" loading="eager" />
      </div>
      <div className="min-w-0">
        <div className={`truncate text-sm font-bold italic tracking-wide ${titleClass}`}>
          TURING DRIVE
        </div>
        <div className={`truncate text-xs ${subtitleClass}`}>台灣智慧駕駛</div>
        {showProduct && (
          <div className={`truncate text-[11px] font-semibold tracking-[0.12em] ${productClass}`}>
            ACCSYS
          </div>
        )}
      </div>
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="inline-flex shrink-0">
        {content}
      </Link>
    );
  }

  return content;
}
