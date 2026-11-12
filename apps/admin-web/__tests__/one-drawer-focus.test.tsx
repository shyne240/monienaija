import React, { useRef, useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { WorkspaceDrawer } from '../src/design-system/WorkspaceDrawer';
import { useDialogFocus } from '../src/utils/use-dialog-focus';

function Confirm({ close }: { close: () => void }) {
  const ref = useRef<HTMLElement>(null);
  useDialogFocus(ref, true, close);
  return <section role="dialog" aria-label="Confirm leave" ref={ref}><button onClick={close}>Keep working</button></section>;
}
function Example() {
  const [open, setOpen] = useState(false); const [confirm, setConfirm] = useState(false);
  return <><button onClick={() => setOpen(true)}>Open detail</button>{open && <WorkspaceDrawer label="Detail" onDismiss={() => setOpen(false)}><button onClick={() => setConfirm(true)}>Leave detail</button></WorkspaceDrawer>}{confirm && <Confirm close={() => setConfirm(false)}/>}</>;
}
test('nested confirmation owns focus and Escape, then returns focus to the drawer', () => {
  render(<Example/>);
  const trigger = screen.getByRole('button',{name:'Open detail'}); trigger.focus(); fireEvent.click(trigger);
  const leave = screen.getByRole('button',{name:'Leave detail'}); expect(document.activeElement).toBe(leave);
  fireEvent.click(leave);
  expect(document.activeElement).toBe(screen.getByRole('button',{name:'Keep working'}));
  fireEvent.keyDown(document,{key:'Escape'});
  expect(screen.queryByRole('dialog',{name:'Confirm leave'})).toBeNull();
  expect(screen.getByRole('dialog',{name:'Detail'})).toBeTruthy(); expect(document.activeElement).toBe(leave);
  fireEvent.keyDown(document,{key:'Escape'});
  expect(screen.queryByRole('dialog',{name:'Detail'})).toBeNull(); expect(document.activeElement).toBe(trigger);
});
