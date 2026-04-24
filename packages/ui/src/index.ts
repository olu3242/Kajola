export type ButtonVariant = 'primary' | 'secondary';

export function buttonClass(variant: ButtonVariant = 'primary') {
  return variant === 'primary'
    ? 'background: #D9922A; color: #0B0705; padding: 12px 20px; border-radius: 8px;'
    : 'background: #F8FAFC; color: #111827; padding: 12px 20px; border-radius: 8px;';
}
