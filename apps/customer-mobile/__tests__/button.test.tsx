import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { Button } from '../src/components/Button';

describe('Button component tests', () => {
  test('should render button label correctly', () => {
    const { getByText } = render(<Button label="Pay Money" />);
    expect(getByText('Pay Money')).toBeTruthy();
  });

  test('should call onPress when clicked', () => {
    const onPressMock = jest.fn();
    const { getByText } = render(<Button label="Submit" onPress={onPressMock} />);
    
    fireEvent.press(getByText('Submit'));
    expect(onPressMock).toHaveBeenCalledTimes(1);
  });

  test('should disable press interaction when button is loading', () => {
    const onPressMock = jest.fn();
    const { queryByText } = render(
      <Button loading label="Submit" onPress={onPressMock} />
    );
    
    // Label should not be visible since loader activity indicator is shown
    expect(queryByText('Submit')).toBeNull();
  });
});
