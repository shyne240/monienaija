import React from 'react';
import {fireEvent,render,screen} from '@testing-library/react';
import {AgentClassAssignmentPanel} from '../src/components/AgentClassAssignmentPanel';
import {AgentTransactionPinSupportPanel} from '../src/components/AgentTransactionPinSupportPanel';

test('production-style class panel identifies the current class and keeps reclassification policy blocked',()=>{
 render(<AgentClassAssignmentPanel agentId="agent" currentClassId="class-1" availableClasses={[{id:'class-1',code:'STANDARD',name:'Standard',isActive:true}]} canManageClasses />);
 expect(screen.getByText('Current assigned class')).toBeTruthy();expect(screen.getByText('Standard (STANDARD)')).toBeTruthy();
 expect(screen.getByTestId('agent-reclassify-dependency').textContent).toContain('not enabled in V1 policy');
 expect((screen.getByRole('button',{name:'Reclassify Agent (Policy blocked)'}) as HTMLButtonElement).disabled).toBe(true);
 expect(screen.queryByLabelText('Target Agent class')).toBeNull();
});

test('production-style PIN panel shows its security boundary and both controls disabled',()=>{
 render(<AgentTransactionPinSupportPanel agentId="agent" canManageSupport />);
 expect(screen.getByTestId('agent-pin-support-dependency').textContent).toContain('dual-control governance policy');
 expect((screen.getByRole('button',{name:'Inspect PIN state (Unavailable)'}) as HTMLButtonElement).disabled).toBe(true);
 expect((screen.getByRole('button',{name:'Clear PIN Lockout (Policy blocked)'}) as HTMLButtonElement).disabled).toBe(true);
});

test('injected status-only workflow makes lack of unlock action explicit',async()=>{
 const load=jest.fn().mockResolvedValue({agentId:'agent',status:'LOCKED'});
 render(<AgentTransactionPinSupportPanel agentId="agent" canManageSupport loadPinStatus={load}/>);
 expect(screen.getByText(/PIN state has not been loaded/)).toBeTruthy();expect(screen.getByText(/Lockout reset is unavailable/)).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Inspect PIN state'}));expect(await screen.findByText('LOCKED')).toBeTruthy();expect(screen.queryByRole('button',{name:'Clear PIN Lockout'})).toBeNull();
});

test('panels preserve their permission restrictions',()=>{
 const reclassify=jest.fn();const view=render(<AgentClassAssignmentPanel agentId="agent" currentClassId={null} availableClasses={[]} canManageClasses={false} onReclassify={reclassify}/>);
 expect(screen.getByText(/Reclassification requires/)).toBeTruthy();expect(screen.queryByRole('button',{name:'Reclassify Agent'})).toBeNull();view.unmount();
 render(<AgentTransactionPinSupportPanel agentId="agent" canManageSupport={false}/>);expect(screen.queryByRole('region',{name:'Agent Transaction PIN support controls'})).toBeNull();expect(reclassify).not.toHaveBeenCalled();
});
