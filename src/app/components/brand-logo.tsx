import Link from 'next/link';

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
  const markClass = isLight ? 'bg-white text-td-blue' : 'bg-td-blue text-white';
  const titleClass = isLight ? 'text-white' : 'text-td-blue-dark';
  const subtitleClass = isLight ? 'text-white/75' : 'text-td-muted';
  const productClass = isLight ? 'text-td-apex' : 'text-td-blue';

  const content = (
    <div className={`flex items-center gap-3 ${className}`}>
      <div
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${markClass} shadow-sm`}
        aria-hidden
      >
        <span className="text-lg font-black italic leading-none">T</span>
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
