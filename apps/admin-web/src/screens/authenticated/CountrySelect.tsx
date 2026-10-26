import React from 'react';
import Select, { type FilterOptionOption, type StylesConfig } from 'react-select';
import * as countries from 'i18n-iso-countries';
import englishLocale from 'i18n-iso-countries/langs/en.json';
import { getCountryCallingCode, isSupportedCountry, type CountryCode } from 'libphonenumber-js/max';

countries.registerLocale(englishLocale);

interface CountryOption {
  value: string;
  name: string;
  label: string;
  aliases: string[];
  callingCode: string | null;
}

const commonNames = countries.getNames('en', { select: 'alias' });
const allNames = countries.getNames('en', { select: 'all' });
const displayNames =
  typeof Intl.DisplayNames === 'function'
    ? new Intl.DisplayNames(['en'], { type: 'region' })
    : null;

export const COUNTRY_OPTIONS: CountryOption[] = Object.entries(commonNames)
  .map(([value, fallbackName]) => {
    const aliases = allNames[value] ?? [fallbackName];
    const fullName =
      aliases.find((candidate) => !/^[A-Z .'-]+$/.test(candidate)) ?? aliases[0] ?? fallbackName;
    const name = displayNames?.of(value) ?? fullName;
    const countryCode = value as CountryCode;
    const callingCode = isSupportedCountry(countryCode)
      ? `+${getCountryCallingCode(countryCode)}`
      : null;
    return {
      value,
      name,
      label: `${name} (${value})`,
      aliases,
      callingCode,
    };
  })
  .sort((left, right) => left.name.localeCompare(right.name, 'en'));

const COUNTRY_OPTIONS_BY_CODE = new Map(COUNTRY_OPTIONS.map((option) => [option.value, option]));

export function normalizeCountryCode(value: string | null | undefined): string {
  const normalized = value?.trim().toUpperCase() ?? '';
  if (!normalized) return '';
  if (COUNTRY_OPTIONS_BY_CODE.has(normalized)) return normalized;
  return countries.alpha3ToAlpha2(normalized) ?? normalized;
}

export function countryNameForCode(value: string | null | undefined): string {
  const raw = value?.trim() ?? '';
  if (!raw) return 'Not recorded';
  const normalized = normalizeCountryCode(raw);
  const option = COUNTRY_OPTIONS_BY_CODE.get(normalized);
  return option?.name ?? `Unrecognized country (${raw.toUpperCase()})`;
}

export function isNigeriaIdentityType(type: string): boolean {
  return type === 'NIN' || type === 'BVN';
}

function optionForValue(value: string | null | undefined): CountryOption | null {
  const raw = value?.trim() ?? '';
  if (!raw) return null;
  const normalized = normalizeCountryCode(raw);
  return (
    COUNTRY_OPTIONS_BY_CODE.get(normalized) ?? {
      value: normalized,
      name: raw,
      label: `Unrecognized country (${raw.toUpperCase()})`,
      aliases: [raw],
      callingCode: null,
    }
  );
}

function normalizeForSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase();
}

function filterCountryOption(
  option: FilterOptionOption<CountryOption>,
  inputValue: string,
): boolean {
  const query = normalizeForSearch(inputValue.trim());
  if (!query) return true;
  return [option.data.name, option.data.value, ...option.data.aliases].some((text) =>
    normalizeForSearch(text).includes(query),
  );
}

const selectStyles: StylesConfig<CountryOption, false> = {
  control: (base, state) => ({
    ...base,
    width: '100%',
    minHeight: 42,
    borderColor: state.isFocused ? '#0b6a52' : '#cedbd6',
    borderRadius: 9,
    boxShadow: state.isFocused ? '0 0 0 3px rgba(11, 106, 82, .12)' : 'none',
    cursor: state.isDisabled ? 'not-allowed' : 'text',
    '&:hover': { borderColor: state.isFocused ? '#0b6a52' : '#a9c4b8' },
  }),
  valueContainer: (base) => ({ ...base, minWidth: 0, padding: '0 10px' }),
  input: (base) => ({ ...base, margin: 0, padding: 0, color: '#17342b' }),
  singleValue: (base) => ({ ...base, color: '#17342b', fontSize: 13 }),
  placeholder: (base) => ({ ...base, color: '#7b8d86', fontSize: 13 }),
  indicatorsContainer: (base) => ({ ...base, minHeight: 40 }),
  menu: (base) => ({
    ...base,
    zIndex: 1000,
    overflow: 'hidden',
    borderRadius: 9,
    boxShadow: '0 12px 28px rgba(20, 45, 36, .18)',
  }),
  menuList: (base) => ({ ...base, maxHeight: 260, padding: 4 }),
  option: (base, state) => ({
    ...base,
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 13,
    padding: '9px 10px',
    backgroundColor: state.isSelected ? '#0b6a52' : state.isFocused ? '#e8f2ee' : '#fff',
    color: state.isSelected ? '#fff' : '#19372e',
    '&:active': { backgroundColor: '#d5e8df' },
  }),
};

export interface CountrySelectProps {
  inputId: string;
  name?: string;
  value: string | null | undefined;
  onChange: (countryCode: string) => void;
  required?: boolean;
  clearable?: boolean;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel: string;
  ariaDescribedBy?: string;
  ariaInvalid?: boolean;
  showCallingCode?: boolean;
}

export const CountrySelect: React.FC<CountrySelectProps> = ({
  inputId,
  name,
  value,
  onChange,
  required = false,
  clearable = false,
  disabled = false,
  placeholder = 'Search by country name or ISO code…',
  ariaLabel,
  ariaDescribedBy,
  ariaInvalid = false,
  showCallingCode = false,
}) => (
  <Select<CountryOption, false>
    inputId={inputId}
    name={name}
    value={optionForValue(value)}
    options={COUNTRY_OPTIONS}
    onChange={(option) => onChange(option?.value ?? '')}
    getOptionLabel={(option) =>
      showCallingCode && option.callingCode
        ? `${option.label} · ${option.callingCode}`
        : option.label
    }
    getOptionValue={(option) => option.value}
    filterOption={filterCountryOption}
    isSearchable
    isClearable={clearable && !disabled}
    isDisabled={disabled}
    required={required}
    aria-label={ariaLabel}
    aria-describedby={ariaDescribedBy}
    aria-invalid={ariaInvalid}
    classNamePrefix="cm-country-select"
    placeholder={placeholder}
    noOptionsMessage={({ inputValue }) =>
      inputValue ? 'No matching country' : 'No countries available'
    }
    menuPlacement="auto"
    menuPosition="fixed"
    menuShouldScrollIntoView
    maxMenuHeight={260}
    styles={selectStyles}
  />
);
