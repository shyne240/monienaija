import React from 'react';
import { render, screen } from '@testing-library/react';
import { LoginScreen } from '../src/screens/unauthenticated/LoginScreen';
import { useAuthStore } from '../src/store/auth-store';
jest.mock('../src/config',()=>({DEV_AUTH_MOCK:false}));
test('production configuration never exposes local engineering assertion tools',()=>{
 useAuthStore.setState({isLoading:false,error:null});render(<LoginScreen/>);expect(screen.queryByRole('button',{name:/Advanced/})).toBeNull();expect(screen.queryByText('Local development build')).toBeNull();expect(screen.getByText(/only where the local workforce authentication endpoint is enabled/)).toBeTruthy();
});
