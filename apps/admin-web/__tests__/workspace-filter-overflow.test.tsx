import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { WorkspaceFilterTabs } from '../src/design-system/WorkspaceDrawer';

test('overflowed filters announce a scroll hint and remain operable', () => {
  const onChange = jest.fn();
  render(<WorkspaceFilterTabs label="Status filters" value="ALL" options={[{value:'ALL',label:'All'}, {value:'CLOSED',label:'Closed'}]} onChange={onChange} />);
  const group = screen.getByRole('group', {name:'Status filters'});
  Object.defineProperty(group, 'clientWidth', {configurable:true,value:100});
  Object.defineProperty(group, 'scrollWidth', {configurable:true,value:220});
  act(() => window.dispatchEvent(new Event('resize')));
  const hint = screen.getByText('Scroll horizontally to see all filters.');
  expect(group.getAttribute('aria-describedby')).toBe(hint.id);
  fireEvent.click(screen.getByRole('button',{name:'Closed'}));
  expect(onChange).toHaveBeenCalledWith('CLOSED');
  Object.defineProperty(group, 'clientWidth', {configurable:true,value:220});
  act(() => window.dispatchEvent(new Event('resize')));
  expect(screen.queryByText('Scroll horizontally to see all filters.')).toBeNull();
  expect(group.getAttribute('aria-describedby')).toBeNull();
});
