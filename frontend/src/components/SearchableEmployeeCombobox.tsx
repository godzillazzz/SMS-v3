import React, { useEffect, useMemo, useRef, useState } from 'react';

export type EmployeeComboboxOption = { value: string; label: string };

type SearchableEmployeeComboboxProps = {
  id: string;
  value: string;
  options?: EmployeeComboboxOption[];
  onChange(value: string): void;
  onSearch(query: string): Promise<EmployeeComboboxOption[]>;
};

export function SearchableEmployeeCombobox({ id, value, options = [], onChange, onSearch }: SearchableEmployeeComboboxProps) {
  const [inputValue, setInputValue] = useState('');
  const [selectedOption, setSelectedOption] = useState<EmployeeComboboxOption>();
  const [remoteOptions, setRemoteOptions] = useState<EmployeeComboboxOption[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const requestSequence = useRef(0);
  const onSearchRef = useRef(onSearch);
  const previousValue = useRef(value);
  onSearchRef.current = onSearch;

  useEffect(() => {
    if (value !== previousValue.current) {
      previousValue.current = value;
      if (!value && selectedOption) {
        setSelectedOption(undefined);
        setInputValue('');
      } else if (value && selectedOption?.value !== value) {
        const match = options.find((option) => option.value === value);
        if (match) {
          setSelectedOption(match);
          setInputValue(match.label);
        }
      }
    }
  }, [options, selectedOption, value]);

  const normalizedQuery = inputValue.trim();
  useEffect(() => {
    const sequence = ++requestSequence.current;
    setSearchError(false);
    setActiveIndex(-1);
    if (normalizedQuery.length < 2 || selectedOption?.label === inputValue) {
      setRemoteOptions([]);
      setLoading(false);
      return () => { requestSequence.current += 1; };
    }

    setRemoteOptions([]);
    setLoading(true);
    const timer = window.setTimeout(() => {
      void onSearchRef.current(normalizedQuery)
        .then((results) => {
          if (requestSequence.current === sequence) setRemoteOptions(results);
        })
        .catch(() => {
          if (requestSequence.current === sequence) setSearchError(true);
        })
        .finally(() => {
          if (requestSequence.current === sequence) setLoading(false);
        });
    }, 200);
    return () => {
      window.clearTimeout(timer);
      requestSequence.current += 1;
    };
  }, [inputValue, normalizedQuery, selectedOption]);

  const visibleOptions = useMemo(() => {
    const query = normalizedQuery.toLocaleLowerCase();
    const local = options.filter((option) => !query || option.label.toLocaleLowerCase().includes(query));
    const unique = new Map<string, EmployeeComboboxOption>();
    for (const option of [...remoteOptions, ...local]) unique.set(option.value, option);
    return [...unique.values()].slice(0, 20);
  }, [normalizedQuery, options, remoteOptions]);

  const selectOption = (option: EmployeeComboboxOption) => {
    setSelectedOption(option);
    setInputValue(option.label);
    setRemoteOptions([option]);
    setOpen(false);
    setActiveIndex(-1);
    onChange(option.value);
  };

  const clearSelection = () => {
    setSelectedOption(undefined);
    setInputValue('');
    setRemoteOptions([]);
    setOpen(false);
    setActiveIndex(-1);
    onChange('');
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => visibleOptions.length ? (index + 1) % visibleOptions.length : -1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => visibleOptions.length ? (index <= 0 ? visibleOptions.length - 1 : index - 1) : -1);
    } else if (event.key === 'Enter' && open && activeIndex >= 0 && visibleOptions[activeIndex]) {
      event.preventDefault();
      selectOption(visibleOptions[activeIndex]);
    } else if (event.key === 'Escape') {
      setOpen(false);
      setActiveIndex(-1);
    }
  };

  const listboxId = `${id}-options`;
  const activeDescendant = activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined;

  return <div className="employee-combobox">
    <div className="employee-combobox__input-wrap">
      <input
        id={id}
        type="search"
        role="combobox"
        autoComplete="off"
        aria-autocomplete="list"
        aria-controls={listboxId}
        aria-expanded={open && visibleOptions.length > 0}
        aria-activedescendant={activeDescendant}
        aria-required="true"
        aria-invalid={!value}
        aria-describedby={`${id}-help`}
        value={inputValue}
        placeholder="ค้นหาชื่อหรือรหัสพนักงานอย่างน้อย 2 ตัวอักษร"
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        onChange={(event) => {
          const nextValue = event.target.value;
          setInputValue(nextValue);
          setSelectedOption(undefined);
          setOpen(true);
          if (value) onChange('');
        }}
      />
      {inputValue && <button type="button" className="employee-combobox__clear" aria-label="ล้างพนักงานที่เลือก" onClick={clearSelection}>ล้าง</button>}
    </div>
    <small id={`${id}-help`}>ค้นหาจากชื่อหรือรหัส แล้วเลือกพนักงานจากรายการ</small>
    {open && (loading || searchError || visibleOptions.length > 0 || normalizedQuery.length >= 2) && <div className="employee-combobox__results">
      {loading && <div className="employee-combobox__status" role="status">กำลังค้นหาพนักงาน…</div>}
      {searchError && <div className="employee-combobox__status employee-combobox__status--error" role="alert">ค้นหาพนักงานไม่สำเร็จ กรุณาลองอีกครั้ง</div>}
      {!loading && !searchError && visibleOptions.length > 0 && <ul id={listboxId} role="listbox" aria-label="ผลการค้นหาพนักงาน">
        {visibleOptions.map((option, index) => <li
          id={`${id}-option-${index}`}
          key={option.value}
          role="option"
          aria-selected={index === activeIndex || option.value === value}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => selectOption(option)}
        >{option.label}</li>)}
      </ul>}
      {!loading && !searchError && normalizedQuery.length >= 2 && visibleOptions.length === 0 && <div className="employee-combobox__status" role="status">ไม่พบพนักงานที่ตรงกับคำค้นหา</div>}
    </div>}
  </div>;
}
