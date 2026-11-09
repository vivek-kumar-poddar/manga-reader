import { Children, isValidElement, type ReactNode, type SelectHTMLAttributes } from 'react';
import * as Select from '@radix-ui/react-select';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
type Option = { value: string | number; children: ReactNode; disabled?: boolean };
type Props = Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  'value' | 'onChange' | 'defaultValue'
> & { value?: string | number; onChange?: (event: { target: { value: string } }) => void };
export default function Dropdown({
  value,
  onChange,
  children,
  className = '',
  disabled,
  title,
  id,
  'aria-label': label,
  'aria-labelledby': labelledby,
}: Props) {
  const options = Children.toArray(children).filter(isValidElement<Option>);
  return (
    <Select.Root
      value={value === undefined ? undefined : String(value)}
      onValueChange={(v) => onChange?.({ target: { value: v } })}
      disabled={disabled}
    >
      <Select.Trigger
        id={id}
        className={'dropdown-trigger ' + className}
        title={title}
        aria-label={label}
        aria-labelledby={labelledby}
      >
        <Select.Value />
        <Select.Icon className="dropdown-chevron">
          <ChevronDown size={14} />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          data-reader-dropdown
          className="dropdown-content"
          position="popper"
          sideOffset={6}
          collisionPadding={10}
        >
          <Select.ScrollUpButton className="dropdown-scroll">
            <ChevronUp size={14} />
          </Select.ScrollUpButton>
          <Select.Viewport className="dropdown-viewport">
            {options.map((option) => (
              <Select.Item
                key={String(option.props.value)}
                value={String(option.props.value)}
                disabled={option.props.disabled}
                className="dropdown-item"
              >
                <Select.ItemText>{option.props.children}</Select.ItemText>
                <Select.ItemIndicator className="dropdown-check">
                  <Check size={14} />
                </Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
          <Select.ScrollDownButton className="dropdown-scroll">
            <ChevronDown size={14} />
          </Select.ScrollDownButton>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
