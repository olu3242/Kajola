export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive';

export function buttonClass(variant: ButtonVariant = 'primary') {
  return `kj-button kj-button--${variant}`;
}

export function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}
