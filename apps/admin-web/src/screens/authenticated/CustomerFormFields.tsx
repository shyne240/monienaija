import React from 'react';

import { normalizeIsoCountryCode } from '../../../../../src/customer/customer-validation';
import { CountrySelect } from './CountrySelect';

export interface CustomerCountrySelectProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  allowEmpty?: boolean;
  required?: boolean;
  disabled?: boolean;
  showCallingCode?: boolean;
}

export const CustomerCountrySelect: React.FC<CustomerCountrySelectProps> = ({
  id,
  label,
  value,
  onChange,
  error,
  allowEmpty = false,
  required = false,
  disabled = false,
  showCallingCode = false,
}) => {
  const selected = normalizeIsoCountryCode(value) ?? value.trim().toUpperCase();
  const errorId = `${id}-error`;
  return (
    <div className="cm-country-select-field">
      <label htmlFor={id}>{label}</label>
      <CountrySelect
        inputId={id}
        name={id}
        value={selected}
        onChange={onChange}
        required={required}
        clearable={allowEmpty}
        disabled={disabled}
        ariaLabel={label}
        ariaDescribedBy={error ? errorId : undefined}
        ariaInvalid={Boolean(error)}
        showCallingCode={showCallingCode}
      />
      {error && <CustomerFieldError id={errorId} message={error} />}
    </div>
  );
};

export interface CustomerPhoneFieldProps {
  id: string;
  label: string;
  value: string;
  country: string;
  onChange: (value: string) => void;
  onCountryChange: (country: string) => void;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  autoComplete?: string;
  helpText?: string;
}

export const CustomerPhoneField: React.FC<CustomerPhoneFieldProps> = ({
  id,
  label,
  value,
  country,
  onChange,
  onCountryChange,
  error,
  required = false,
  disabled = false,
  autoComplete = 'tel',
  helpText,
}) => {
  const countryId = `${id}-country`;
  const inputId = `${id}-number`;
  const errorId = `${id}-error`;
  return (
    <div className="cm-phone-field">
      <CustomerCountrySelect
        id={countryId}
        label="Phone country"
        value={country}
        onChange={onCountryChange}
        required
        disabled={disabled}
        showCallingCode
      />
      <div className="cm-phone-number-field">
        <label htmlFor={inputId}>
          {label}
          {required && <span className="cm-required-indicator">Required</span>}
        </label>
        <input
          id={inputId}
          type="tel"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          placeholder="Local number or +country code"
          aria-invalid={Boolean(error)}
          aria-describedby={
            [error ? errorId : null, helpText ? `${id}-help` : null].filter(Boolean).join(' ') ||
            undefined
          }
          aria-required={required}
          disabled={disabled}
        />
        {error && <CustomerFieldError id={errorId} message={error} />}
        {helpText && (
          <small id={`${id}-help`} className="cm-form-help">
            {helpText}
          </small>
        )}
      </div>
    </div>
  );
};

export interface CustomerFieldErrorProps {
  id: string;
  message?: string;
}

export const CustomerFieldError: React.FC<CustomerFieldErrorProps> = ({ id, message }) =>
  message ? (
    <span id={id} className="cm-field-error" aria-live="polite">
      {message}
    </span>
  ) : null;
