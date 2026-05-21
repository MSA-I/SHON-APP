/**
 * TextArea — multi-line variant of Input.
 *
 * Same visual contract as Input:
 *  - label-sm-caps above (gold-dark, uppercase, 0.12em tracking).
 *  - bottom-border only: 1px var(--border-subtle) at rest, 2px gold on focus.
 *  - no background fill.
 *
 * Differences:
 *  - min-height: 80px.
 *  - resize: vertical only.
 *  - dir defaults to 'rtl' (Hebrew copy is the default content).
 *
 * SOP 16 § Components, SOP 09 §9.4.
 */

import { useId } from 'react';

export interface TextAreaProps {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  dir?: 'rtl' | 'ltr';
  testId?: string;
  rows?: number;
}

export function TextArea({
  label,
  value,
  onChange,
  placeholder,
  dir = 'rtl',
  testId,
  rows,
}: TextAreaProps) {
  const id = useId();

  return (
    <label htmlFor={id} className="flex flex-col gap-2 w-full">
      <span
        className={[
          'font-sans text-label uppercase',
          'text-gold-dark',
          'tracking-[0.12em] leading-none',
        ].join(' ')}
      >
        {label}
      </span>

      <textarea
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        dir={dir}
        rows={rows}
        data-testid={testId}
        className={[
          'w-full bg-transparent',
          'border-0 border-b border-solid border-border-subtle',
          'rounded-none',
          'px-0 py-3',
          'font-sans text-body text-cream placeholder:text-cream-muted',
          'min-h-20', // 80px
          'resize-y',
          'focus:outline-none focus:border-b-2 focus:border-gold focus:pb-[10px]',
          'transition-[border-color,padding-bottom] duration-150 ease-[cubic-bezier(0.4,0,0.2,1)]',
        ].join(' ')}
      />
    </label>
  );
}
