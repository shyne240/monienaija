import React from 'react';
import { fireEvent, render } from '@testing-library/react';

import {
  COUNTRY_OPTIONS,
  CountrySelect,
  countryNameForCode,
  normalizeCountryCode,
} from '../src/screens/authenticated/CountrySelect';

describe('CountrySelect', () => {
  test('uses the complete ISO country dataset and normalizes saved alpha-3 codes', () => {
    expect(COUNTRY_OPTIONS.length).toBeGreaterThan(200);
    expect(COUNTRY_OPTIONS.find((country) => country.value === 'NG')?.name).toBe('Nigeria');
    expect(COUNTRY_OPTIONS.find((country) => country.value === 'US')?.name).toBe('United States');
    expect(normalizeCountryCode(' usa ')).toBe('US');
    expect(countryNameForCode('NGA')).toBe('Nigeria');
  });

  test('defaults to Nigeria, searches by ISO code, and supports keyboard selection', async () => {
    const onChange = jest.fn();
    const view = render(
      <label htmlFor="country-code-test">
        Country
        <CountrySelect
          inputId="country-code-test"
          value="NG"
          onChange={onChange}
          ariaLabel="Country"
        />
      </label>,
    );

    expect(view.getByText('Nigeria (NG)')).toBeTruthy();
    const input = view.getByRole('combobox', { name: 'Country' });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'GH' } });
    expect(await view.findByRole('option', { name: 'Ghana (GH)' })).toBeTruthy();
    fireEvent.keyDown(input, { key: 'ArrowDown', code: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    expect(onChange).toHaveBeenCalledWith('GH');
  });

  test('can show calling codes for the country-aware phone selector', () => {
    const view = render(
      <CountrySelect
        inputId="phone-country-test"
        value="NG"
        onChange={jest.fn()}
        ariaLabel="Phone country"
        showCallingCode
      />,
    );

    expect(view.getByText('Nigeria (NG) · +234')).toBeTruthy();
  });

  test('searches by country name and reports when no country matches', async () => {
    const onChange = jest.fn();
    const view = render(
      <label htmlFor="country-name-test">
        Country
        <CountrySelect
          inputId="country-name-test"
          value="NG"
          onChange={onChange}
          ariaLabel="Country"
        />
      </label>,
    );
    const input = view.getByRole('combobox', { name: 'Country' });

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'new zealand' } });
    expect(await view.findByRole('option', { name: 'New Zealand (NZ)' })).toBeTruthy();
    fireEvent.change(input, { target: { value: 'not a country' } });
    expect(await view.findByText('No matching country')).toBeTruthy();
  });
});
