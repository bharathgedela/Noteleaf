import logoUrl from '../../../assets/noteleaf-logo.png';

export function BrandLogo({ className, decorative = true }: { className?: string; decorative?: boolean }) {
  return <img className={className} src={logoUrl} alt={decorative ? '' : 'Noteleaf'} draggable={false} />;
}
