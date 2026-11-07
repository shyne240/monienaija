import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { CustomerTier3ReadinessPanel } from '../src/screens/authenticated/CustomerTier3ReadinessPanel';

const props = { customerType:'INDIVIDUAL', customerStatus:'ACTIVE', phoneVerified:null, kycLevel:'LEVEL_1', kycStatus:'PENDING', financialEligibility:null };
test('separates recorded account context from policy-dependent review and exposes no decision action', () => {
  render(<CustomerTier3ReadinessPanel {...props} phoneVerified={true} financialEligibility="ELIGIBLE" />);
  const signals = screen.getByRole('region',{name:'Recorded signals'});
  const workflows = screen.getByRole('region',{name:'Review and tier workflows'});
  expect(within(signals).getByText('Verified primary phone')).toBeTruthy();
  expect(within(signals).getByText('LEVEL_1 · PENDING')).toBeTruthy();
  expect(within(signals).getByText('ELIGIBLE')).toBeTruthy();
  expect(within(workflows).getByText('Not separately recorded')).toBeTruthy();
  expect(within(workflows).getAllByText('Not configured')).toHaveLength(2);
  expect(screen.getByText('No eligibility decision')).toBeTruthy();
  expect(screen.queryByRole('button')).toBeNull();
});
test('loading signals do not claim unavailable or false verification, and unavailable remains explicit afterward', () => {
  const view = render(<CustomerTier3ReadinessPanel {...props} signalsLoading />);
  const signals = screen.getByRole('region',{name:'Recorded signals'});
  expect(within(signals).getAllByText('Loading…')).toHaveLength(2);
  expect(within(signals).queryByText('Not verified')).toBeNull();
  view.rerender(<CustomerTier3ReadinessPanel {...props} />);
  expect(within(signals).getByText('Unavailable')).toBeTruthy();
  expect(within(signals).getByText('Not recorded / unavailable')).toBeTruthy();
  expect(within(signals).queryByText('Not verified')).toBeNull();
});
