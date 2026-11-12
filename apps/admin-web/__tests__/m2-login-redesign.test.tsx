import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LoginScreen } from '../src/screens/unauthenticated/LoginScreen';
import { useAuthStore } from '../src/store/auth-store';
import { ApiClient } from '../src/services/api-client';
jest.mock('../src/config', () => ({DEV_AUTH_MOCK: true}));
jest.mock('../src/services/api-client', () => ({ApiClient: {post: jest.fn(), delete: jest.fn()}}));
beforeEach(() => { jest.clearAllMocks(); useAuthStore.setState({isAuthenticated:false,isLoading:false,error:null,principal:null,token:null,sessionId:null}); });
test('validation focuses and describes the missing credential without sending a request', () => {
  render(<LoginScreen/>); fireEvent.click(screen.getByRole('button',{name:'Sign In'}));
  const email=screen.getByLabelText('Email or username');expect(document.activeElement).toBe(email);expect(email.getAttribute('aria-invalid')).toBe('true');expect(email.getAttribute('aria-describedby')).toBe('admin-login-error');expect(screen.getByRole('alert').textContent).toMatch(/required/);
  fireEvent.change(email,{target:{value:'operator'}});fireEvent.click(screen.getByRole('button',{name:'Sign In'}));const password=screen.getByLabelText('Password');expect(document.activeElement).toBe(password);expect(password.getAttribute('aria-invalid')).toBe('true');expect(ApiClient.post).not.toHaveBeenCalled();
});
test('password submission remains single-flight and shows server failure, never synthetic success', async () => {
  let reject!: (reason: Error)=>void;const pending=new Promise((_resolve,r)=>{reject=r});(ApiClient.post as jest.Mock).mockReturnValue(pending);
  render(<LoginScreen/>);fireEvent.change(screen.getByLabelText('Email or username'),{target:{value:'operator'}});fireEvent.change(screen.getByLabelText('Password'),{target:{value:'synthetic-password'}});
  fireEvent.click(screen.getByRole('button',{name:'Sign In'}));const button=screen.getByRole('button',{name:'Signing in...'});expect((button as HTMLButtonElement).disabled).toBe(true);fireEvent.submit(button.closest('form')!);expect(ApiClient.post).toHaveBeenCalledTimes(1);
  await act(async()=>{reject(new Error('Synthetic rejection'));try{await pending;}catch{}});expect(screen.getByRole('alert').textContent).toContain('Synthetic rejection');expect(useAuthStore.getState().isAuthenticated).toBe(false);
});
test('engineering tool switching and closing clears typed assertions', () => {
  render(<LoginScreen/>);fireEvent.click(screen.getByRole('button',{name:/Advanced: OIDC/}));
  const token=screen.getByLabelText('Signed OIDC ID Assertion Token (Compact JWS)') as HTMLTextAreaElement;fireEvent.change(token,{target:{value:'synthetic-secret'}});
  fireEvent.click(screen.getByRole('button',{name:'Bootstrap Authority'}));const statement=screen.getByLabelText('Finance Admin Bootstrap Statement (JWS)') as HTMLTextAreaElement;fireEvent.change(statement,{target:{value:'synthetic-statement'}});
  fireEvent.click(screen.getByRole('button',{name:'OIDC Ingress Login'}));expect((screen.getByLabelText('Signed OIDC ID Assertion Token (Compact JWS)') as HTMLTextAreaElement).value).toBe('');
  fireEvent.change(screen.getByLabelText('Signed OIDC ID Assertion Token (Compact JWS)'),{target:{value:'another-secret'}});fireEvent.click(screen.getByRole('button',{name:/Hide advanced/}));fireEvent.click(screen.getByRole('button',{name:/Advanced: OIDC/}));
  expect((screen.getByLabelText('Signed OIDC ID Assertion Token (Compact JWS)') as HTMLTextAreaElement).value).toBe('');expect(ApiClient.post).not.toHaveBeenCalled();
});
test('successful local bootstrap clears statement and announces outcome', async () => {
  (ApiClient.post as jest.Mock).mockResolvedValue({});render(<LoginScreen/>);fireEvent.click(screen.getByRole('button',{name:/Advanced: OIDC/}));fireEvent.click(screen.getByRole('button',{name:'Bootstrap Authority'}));
  const field=screen.getByLabelText('Finance Admin Bootstrap Statement (JWS)') as HTMLTextAreaElement;fireEvent.change(field,{target:{value:'synthetic-statement'}});fireEvent.click(screen.getByRole('button',{name:'Consume Bootstrap Statement'}));
  await waitFor(()=>expect(screen.getByRole('status').textContent).toMatch(/consumed successfully/i));expect(field.value).toBe('');expect(ApiClient.post).toHaveBeenCalledWith('/internal/a2/workforce/bootstrap',{statement:'synthetic-statement'});
});
