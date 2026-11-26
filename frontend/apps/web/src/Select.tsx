import {
  Children,
  Fragment,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'

type ParsedOption = {
  value: string
  label: string
  disabled: boolean
  selected: boolean
  group: string
}

type OptionGroup = {
  label: string
  options: ParsedOption[]
}

type OptionProps = {
  value?: unknown
  disabled?: boolean
  selected?: boolean
  hidden?: boolean
  label?: string
  children?: ReactNode
}

export type SelectProps = {
  value?: string | number
  defaultValue?: string | number
  onChange?: (event: ChangeEvent<HTMLSelectElement>) => void
  className?: string
  style?: CSSProperties
  disabled?: boolean
  id?: string
  name?: string
  children?: ReactNode
  'aria-label'?: string
  'aria-labelledby'?: string
}

function textFromNode(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textFromNode).join('')
  if (isValidElement<{ children?: ReactNode }>(node)) return textFromNode(node.props.children)
  return ''
}

function collectOptions(nodes: ReactNode, inheritedDisabled = false, group = ''): ParsedOption[] {
  const options: ParsedOption[] = []
  Children.forEach(nodes, (child) => {
    if (!isValidElement(child)) return
    const props = child.props as OptionProps
    if (child.type === 'option') {
      if (props.hidden) return
      const label = textFromNode(props.children).replace(/\s+/g, ' ').trim()
      options.push({
        value: props.value === undefined ? label : String(props.value),
        label: label || (props.value === undefined ? '' : String(props.value)),
        disabled: inheritedDisabled || Boolean(props.disabled),
        selected: Boolean(props.selected),
        group,
      })
      return
    }
    if (child.type === 'optgroup') {
      options.push(
        ...collectOptions(
          props.children,
          inheritedDisabled || Boolean(props.disabled),
          typeof props.label === 'string' ? props.label : '',
        ),
      )
      return
    }
    if (child.type === Fragment || props.children !== undefined) {
      options.push(...collectOptions(props.children, inheritedDisabled, group))
    }
  })
  return options
}

function groupOptions(options: ParsedOption[]): OptionGroup[] {
  const groups: OptionGroup[] = []
  for (const option of options) {
    const current = groups[groups.length - 1]
    if (!current || current.label !== option.group) {
      groups.push({ label: option.group, options: [option] })
    } else {
      current.options.push(option)
    }
  }
  return groups
}

function nextEnabledIndex(options: ParsedOption[], start: number, direction: 1 | -1): number {
  if (!options.length) return -1
  let index = start
  for (let step = 0; step < options.length; step += 1) {
    index = (index + direction + options.length) % options.length
    if (!options[index].disabled) return index
  }
  return -1
}

function SelectCheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m5 12 4.2 4.2L19 6.8" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function Select({
  value,
  defaultValue,
  onChange,
  className = '',
  style,
  disabled = false,
  id,
  name,
  children,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
}: SelectProps) {
  const generatedId = useId().replace(/:/g, '')
  const triggerId = id || `custom-select-${generatedId}`
  const listboxId = `${triggerId}-listbox`
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const typeaheadRef = useRef({ query: '', at: 0 })
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({})

  const options = useMemo(() => collectOptions(children), [children])
  const groups = useMemo(() => groupOptions(options), [options])
  const optionIndexes = useMemo(() => new Map(options.map((option, index) => [option, index])), [options])
  const controlled = value !== undefined
  const initialValue = useMemo(() => {
    if (defaultValue !== undefined) return String(defaultValue)
    return options.find((option) => option.selected && !option.disabled)?.value
      ?? options.find((option) => !option.disabled)?.value
      ?? ''
  }, [])
  const [uncontrolledValue, setUncontrolledValue] = useState(initialValue)
  const currentValue = controlled ? String(value ?? '') : uncontrolledValue
  const selectedOption = options.find((option) => option.value === currentValue)
  const selectedIndex = selectedOption ? optionIndexes.get(selectedOption) ?? -1 : -1

  useEffect(() => {
    if (controlled || !options.length || options.some((option) => option.value === uncontrolledValue && !option.disabled)) return
    const nextValue = options.find((option) => !option.disabled)?.value ?? ''
    if (nextValue !== uncontrolledValue) setUncontrolledValue(nextValue)
  }, [controlled, options, uncontrolledValue])

  const updateMenuPosition = useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const viewportPadding = 12
    const maxWidth = Math.max(0, window.innerWidth - viewportPadding * 2)
    const width = Math.min(Math.max(rect.width, 248), maxWidth)
    const left = Math.min(
      Math.max(viewportPadding, rect.left),
      Math.max(viewportPadding, window.innerWidth - width - viewportPadding),
    )
    const spaceBelow = window.innerHeight - rect.bottom - viewportPadding
    const spaceAbove = rect.top - viewportPadding
    const openAbove = spaceBelow < 190 && spaceAbove > spaceBelow
    const maxHeight = Math.min(300, Math.max(132, (openAbove ? spaceAbove : spaceBelow) - 8))
    const baseStyle: CSSProperties = {
      left,
      width,
      maxHeight,
      transformOrigin: openAbove ? 'bottom center' : 'top center',
    }
    setMenuStyle(
      openAbove
        ? { ...baseStyle, bottom: window.innerHeight - rect.top + 8 }
        : { ...baseStyle, top: rect.bottom + 8 },
    )
  }, [])

  const openMenu = useCallback((preferredIndex?: number) => {
    if (disabled) return
    updateMenuPosition()
    const fallback = selectedIndex >= 0 && !options[selectedIndex]?.disabled
      ? selectedIndex
      : options.findIndex((option) => !option.disabled)
    setActiveIndex(preferredIndex ?? fallback)
    setOpen(true)
  }, [disabled, options, selectedIndex, updateMenuPosition])

  const closeMenu = useCallback(() => setOpen(false), [])

  const chooseOption = useCallback((option: ParsedOption) => {
    if (option.disabled) return
    if (!controlled) setUncontrolledValue(option.value)
    setOpen(false)
    triggerRef.current?.focus()
    if (option.value !== currentValue) {
      onChange?.({
        target: { value: option.value },
        currentTarget: { value: option.value },
      } as unknown as ChangeEvent<HTMLSelectElement>)
    }
  }, [controlled, currentValue, onChange])

  const moveActive = useCallback((direction: 1 | -1) => {
    const start = activeIndex >= 0 ? activeIndex : selectedIndex
    const next = nextEnabledIndex(options, start, direction)
    if (next >= 0) setActiveIndex(next)
  }, [activeIndex, options, selectedIndex])

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) openMenu()
      else moveActive(event.key === 'ArrowDown' ? 1 : -1)
      return
    }
    if (event.key === 'Home' || event.key === 'End') {
      if (!open) return
      event.preventDefault()
      const ordered = event.key === 'Home' ? options : [...options].reverse()
      const option = ordered.find((item) => !item.disabled)
      if (option) setActiveIndex(optionIndexes.get(option) ?? -1)
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (!open) openMenu()
      else if (activeIndex >= 0 && options[activeIndex]) chooseOption(options[activeIndex])
      return
    }
    if (event.key === 'Escape') {
      if (open) {
        event.preventDefault()
        setOpen(false)
      }
      return
    }
    if (event.key === 'Tab') {
      if (open) setOpen(false)
      return
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const now = Date.now()
      const typed = now - typeaheadRef.current.at > 650
        ? event.key
        : `${typeaheadRef.current.query}${event.key}`
      typeaheadRef.current = { query: typed, at: now }
      const match = options.findIndex((option) => !option.disabled && option.label.toLowerCase().startsWith(typed.toLowerCase()))
      if (match >= 0) {
        if (open) setActiveIndex(match)
        else openMenu(match)
      }
    }
  }

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (target && (triggerRef.current?.contains(target) || menuRef.current?.contains(target))) return
      setOpen(false)
    }
    const reposition = () => updateMenuPosition()
    document.addEventListener('pointerdown', handlePointerDown, true)
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [open, updateMenuPosition])

  useEffect(() => {
    if (!open || activeIndex < 0) return
    menuRef.current
      ?.querySelector<HTMLElement>(`[data-option-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, open])

  useEffect(() => {
    if (!open) return
    updateMenuPosition()
  }, [open, updateMenuPosition])

  return (
    <>
      {name ? <input type="hidden" name={name} value={currentValue} readOnly /> : null}
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        className={`select select-trigger${open ? ' is-open' : ''}${className ? ` ${className}` : ''}`}
        style={style}
        disabled={disabled}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={open && activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        onClick={() => {
          if (open) closeMenu()
          else openMenu()
        }}
        onKeyDown={handleKeyDown}
      >
        <span className={`select-value${selectedOption ? '' : ' is-empty'}`}>{selectedOption?.label || ''}</span>
      </button>
      {open
        ? createPortal(
            <div
              ref={menuRef}
              id={listboxId}
              className="custom-select-menu"
              style={menuStyle}
              role="listbox"
              aria-label={ariaLabel}
              aria-labelledby={ariaLabelledBy}
            >
              {options.length ? groups.map((group, groupIndex) => (
                <div className="custom-select-group" key={`${group.label}-${groupIndex}`}>
                  {group.label ? <div className="custom-select-group-label">{group.label}</div> : null}
                  {group.options.map((option) => {
                    const index = optionIndexes.get(option) ?? -1
                    const isActive = index === activeIndex
                    const isSelected = option.value === currentValue
                    return (
                      <div
                        key={`${option.value}-${index}`}
                        id={`${listboxId}-${index}`}
                        className={`custom-select-option${isActive ? ' is-active' : ''}${isSelected ? ' is-selected' : ''}`}
                        role="option"
                        aria-selected={isSelected}
                        aria-disabled={option.disabled}
                        data-option-index={index}
                        onMouseDown={(event) => event.preventDefault()}
                        onPointerEnter={() => {
                          if (!option.disabled) setActiveIndex(index)
                        }}
                        onClick={() => chooseOption(option)}
                      >
                        <span className="custom-select-option-label">{option.label}</span>
                        {isSelected ? <span className="custom-select-check"><SelectCheckIcon /></span> : null}
                      </div>
                    )
                  })}
                </div>
              )) : <div className="custom-select-empty">暂无可选项</div>}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
