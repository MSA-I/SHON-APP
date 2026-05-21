/**
 * Input — Luxury Editorial bottom-border-only field.
 *
 * SOP 09 §9.4 (numeric inputs in RTL forms keep dir="ltr" + tabular-nums).
 * SOP 16 § Components (input fields: bottom-border only, label-sm-caps above).
 *
 * Geometry:
 *  - bottom border only: 1px var(--border-subtle) at rest, 2px gold on focus.
 *  - no background fill (inherits page canvas).
 *  - label sits above input: tiny + gold + uppercase + 0.12em letterspacing.
 *  - numeric inputs (number / date / time / tel): tabular-nums + lining-nums.
 *  - Hebrew text inputs: dir="rtl" (default).
 *  - Phone / date / time / number: dir="ltr" caller-supplied.
 *
 * Focus-visible: 2px gold outline + 2px offset (global rule in styles/index.css).
 *
 * Layer 2 only — no @tauri-apps, no idb.
 */

import { useId } from 'react';

export type InputType = 'text' | 'email' | 'tel' | 'date' | 'time' | 'number';

export interface InputProps {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  type?: InputType;
  /**
   * Caller-controlled. Hebrew text fields default to 'rtl'; numeric / phone /
   * date / time should pass 'ltr' so digits render naturally inside an RTL
   * page.
   */
  dir?: 'rtl' | 'ltr';
  testId?: string;
}

const NUMERIC_TYPES: InputType[] = ['number', 'tel', 'date', 'time'];

export function Input({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  dir = 'rtl',
  testId,
}: InputProps) {
  const id = useId();
  const isNumeric = NUMERIC_TYPES.includes(type);

  return (
    <label
      htmlFor={id}
      className="flex flex-col gap-2 w-full"
      // The label container always inherits the page direction; we control
      // the input element direction explicitly below.
    >
      <span
        className={[
          'font-sans text-label uppercase',
          'text-gold-dark',
          'tracking-[0.12em] leading-none',
        ].join(' ')}
      >
        {label}
      </span>

      <input
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        dir={dir}
        data-testid={testId}
        className={[
          'w-full bg-transparent',
          // Bottom-border only at rest. Override the global 1px box border
          // from styles/index.css §base that targets all <input>.
          'border-0 border-b border-solid border-border-subtle',
          'rounded-none',
          // Padding: zero horizontal (label sits flush with field edge per
          // mockup), 12px vertical for breathing room.
          'px-0 py-3',
          'font-sans text-body text-cream placeholder:text-cream-muted',
          // 2px gold focus border replaces the 1px hairline.
          'focus:outline-none focus:border-b-2 focus:border-gold focus:pb-[10px]',
          'transition-[border-color,padding-bottom] duration-150 ease-[cubic-bezier(0.4,0,0.2,1)]',
          isNumeric ? 'font-tabular' : '',
        ].join(' ')}
      />
    </label>
  );
}
