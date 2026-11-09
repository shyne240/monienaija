import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { AgentNetworkScreen } from '../src/screens/authenticated/AgentNetworkScreen';
import { useAuthStore } from '../src/store/auth-store';
import { ApiClient } from '../src/services/api-client';
jest.mock('../src/services/api-client', () => ({ ApiClient:{get:jest.fn(),post:jest.fn(),patch:jest.fn()} }));

const agent=(id='agent')=>({id,reference:`AG-${id}`,status:'ACTIVE',agentClassId:null,createdAt:'2026-01-01',updatedAt:'2026-01-01'});
const outlet=(id='outlet',agentId='agent')=>({id,agentId,reference:'OUT-1',name:'Desk',code:null,displayName:null,addressLine:null,city:null,state:null,country:'NG',status:'ACTIVE',version:1});
const terminal=(agentId='agent')=>({id:'terminal',agentId,outletId:'outlet',reference:'TRM-1',code:null,label:null,serialNumber:null,status:'ACTIVE',version:1});
function setup(){
 useAuthStore.setState({principal:{type:'OPERATOR',principalId:'manager',sessionId:'session',audience:'workforce-admin',roles:[],scopes:['agent.view','agent.manage_outlets_terminals'],customerAccess:'NONE',assuranceLevel:'MFA'}});
 (ApiClient.get as jest.Mock).mockImplementation((path:string)=>path.startsWith('/internal/agents?')?Promise.resolve({data:[agent()],total:1}):path.endsWith('/outlets')?Promise.resolve([outlet()]):path.endsWith('/terminals')?Promise.resolve([terminal()]):Promise.resolve([]));
}
beforeEach(()=>{jest.resetAllMocks();setup();});
async function open(){render(<AgentNetworkScreen/>);await screen.findByText('AG-agent');fireEvent.click(screen.getByRole('button',{name:'View'}));fireEvent.click(screen.getByRole('button',{name:'Load outlets & terminals'}));await screen.findByRole('button',{name:'Edit outlet'});return screen.getByLabelText('Agent outlets and terminals');}

test('unconfirmed create preserves draft, blocks other writes, and needs valid fresh read plus explicit review',async()=>{
 (ApiClient.post as jest.Mock).mockResolvedValue({id:'bad',agentId:'other',reference:'OUT-NEW',name:'New Desk',status:'ACTIVE',version:1});
 const section=await open();fireEvent.change(within(section).getByLabelText('Outlet reference'),{target:{value:'OUT-NEW'}});fireEvent.change(within(section).getByLabelText('Outlet name'),{target:{value:'New Desk'}});fireEvent.click(within(section).getByRole('button',{name:'Create outlet'}));
 expect(await within(section).findByText(/Outlet creation outcome is unconfirmed/)).toBeTruthy();expect((within(section).getByLabelText('Outlet reference') as HTMLInputElement).value).toBe('OUT-NEW');expect((within(section).getByRole('button',{name:'Create outlet'}) as HTMLButtonElement).disabled).toBe(true);expect((within(section).getByRole('button',{name:'Suspend terminal'}) as HTMLButtonElement).disabled).toBe(true);
 (ApiClient.get as jest.Mock).mockImplementation((path:string)=>path.endsWith('/outlets')?Promise.resolve([outlet('outlet','other')]):path.endsWith('/terminals')?Promise.resolve([terminal()]):Promise.resolve([]));
 fireEvent.click(within(section).getByRole('button',{name:'Refresh outlets & terminals'}));expect(await within(section).findByText(/Invalid or cross-Agent/)).toBeTruthy();expect(within(section).queryByRole('button',{name:'I reviewed the records and audit history'})).toBeNull();
 (ApiClient.get as jest.Mock).mockImplementation((path:string)=>path.endsWith('/outlets')?Promise.resolve([outlet()]):path.endsWith('/terminals')?Promise.resolve([terminal()]):Promise.resolve([]));
 fireEvent.click(within(section).getByRole('button',{name:'Load outlets & terminals'}));await within(section).findByRole('button',{name:'I reviewed the records and audit history'});expect((within(section).getByLabelText('Outlet reference') as HTMLInputElement).value).toBe('OUT-NEW');
 fireEvent.click(within(section).getByRole('button',{name:'I reviewed the records and audit history'}));expect((within(section).getByRole('button',{name:'Create outlet'}) as HTMLButtonElement).disabled).toBe(false);expect(ApiClient.post).toHaveBeenCalledTimes(1);
});

test('conflicted metadata preserves editor until review and explicit discard; editor switching and exit warn',async()=>{
 const confirm=jest.spyOn(window,'confirm').mockReturnValue(false);(ApiClient.patch as jest.Mock).mockRejectedValue({status:409,message:'stale version'});const section=await open();
 fireEvent.click(within(section).getByRole('button',{name:'Edit outlet'}));fireEvent.change(within(section).getByLabelText('Edit outlet name for OUT-1'),{target:{value:'New name'}});fireEvent.click(within(section).getByRole('button',{name:'Edit terminal'}));expect(within(section).getByLabelText('Edit outlet name for OUT-1')).toBeTruthy();
 fireEvent.click(within(section).getByRole('button',{name:'Save outlet changes'}));expect(await within(section).findByText(/outcome is unconfirmed or conflicted/)).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Close'}));expect(screen.getByLabelText('Agent outlets and terminals')).toBeTruthy();
 const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);expect(event.defaultPrevented).toBe(true);
 fireEvent.click(within(section).getByRole('button',{name:'Refresh outlets & terminals'}));await within(section).findByRole('button',{name:'I reviewed the records and audit history'});fireEvent.click(within(section).getByRole('button',{name:'I reviewed the records and audit history'}));expect(within(section).getByLabelText('Edit outlet name for OUT-1')).toBeTruthy();
 confirm.mockReturnValue(true);fireEvent.click(within(section).getByRole('button',{name:'I reviewed the records and audit history'}));expect(within(section).queryByLabelText('Edit outlet name for OUT-1')).toBeNull();expect(ApiClient.patch).toHaveBeenCalledTimes(1);confirm.mockRestore();
});

test('a late prior-Agent outlet read cannot populate a new Agent workspace',async()=>{
 let resolve!:(v:any)=>void;const old=new Promise<any>(r=>{resolve=r});
 (ApiClient.get as jest.Mock).mockImplementation((path:string)=>path.startsWith('/internal/agents?')?Promise.resolve({data:[agent('one'),agent('two')],total:2}):path.endsWith('/one/outlets')?old:path.endsWith('/one/terminals')?Promise.resolve([]):path.endsWith('/two/outlets')?Promise.resolve([outlet('two-outlet','two')]):path.endsWith('/two/terminals')?Promise.resolve([]):Promise.resolve([]));
 render(<AgentNetworkScreen/>);await screen.findByText('AG-one');fireEvent.click(screen.getAllByRole('button',{name:'View'})[0]);fireEvent.click(screen.getByRole('button',{name:'Load outlets & terminals'}));fireEvent.click(screen.getAllByRole('button',{name:'View'})[1]);fireEvent.click(screen.getByRole('button',{name:'Load outlets & terminals'}));await screen.findByRole('button',{name:'Edit outlet'});
 await act(async()=>{resolve([outlet('old','one')]);await old;});expect(screen.getByRole('button',{name:'Edit outlet'})).toBeTruthy();expect(screen.getByRole('button',{name:'Refresh outlets & terminals'})).toBeTruthy();
});

test.each(['outlet','terminal'])('%s lifecycle submits the observed version and locks on a mismatched receipt',async(kind)=>{
 (ApiClient.post as jest.Mock).mockResolvedValue(kind === 'outlet' ? {...outlet(),status:'SUSPENDED',version:3} : {...terminal(),status:'SUSPENDED',version:3});
 const section=await open();fireEvent.click(within(section).getByRole('button',{name:`Suspend ${kind}`}));
 expect(ApiClient.post).toHaveBeenCalledWith(`/internal/${kind}s/${kind}/suspend`,{expectedVersion:1});
 expect(await within(section).findByText(/outcome is unconfirmed/)).toBeTruthy();
 expect((within(section).getByRole('button',{name:`Suspend ${kind}`}) as HTMLButtonElement).disabled).toBe(true);
});

test('terminal lifecycle rejects a receipt for a different outlet',async()=>{
 (ApiClient.post as jest.Mock).mockResolvedValue({...terminal(),outletId:'other',status:'SUSPENDED',version:2});
 const section=await open();fireEvent.click(within(section).getByRole('button',{name:'Suspend terminal'}));
 expect(await within(section).findByText(/outcome is unconfirmed/)).toBeTruthy();
});

test.each([
 ['unexpected code',{code:'OTHER'}],
 ['unexpected city',{city:'Another City'}],
 ['unexpected version',{version:2}],
 ['incorrect default country',{country:'US'}],
])('outlet creation rejects %s even when identity and requested fields match',async(_case,change)=>{
 (ApiClient.post as jest.Mock).mockResolvedValue({...outlet('new'),reference:'OUT-NEW',name:'New Desk',...change});
 const section=await open();fireEvent.change(within(section).getByLabelText('Outlet reference'),{target:{value:'OUT-NEW'}});fireEvent.change(within(section).getByLabelText('Outlet name'),{target:{value:'New Desk'}});fireEvent.click(within(section).getByRole('button',{name:'Create outlet'}));
 expect(await within(section).findByText(/Outlet creation outcome is unconfirmed/)).toBeTruthy();expect((within(section).getByLabelText('Outlet reference') as HTMLInputElement).value).toBe('OUT-NEW');
});

test.each([
 ['unexpected code',{code:'OTHER'}],
 ['unexpected label',{label:'Wrong label'}],
 ['unexpected version',{version:2}],
])('terminal creation rejects %s even when identity and requested fields match',async(_case,change)=>{
 (ApiClient.post as jest.Mock).mockResolvedValue({...terminal(),id:'new-terminal',reference:'TRM-NEW',...change});
 const section=await open();fireEvent.change(within(section).getByLabelText('Terminal reference'),{target:{value:'TRM-NEW'}});fireEvent.change(within(section).getByLabelText('Terminal outlet'),{target:{value:'outlet'}});fireEvent.click(within(section).getByRole('button',{name:'Create terminal'}));
 expect(await within(section).findByText(/Terminal creation outcome is unconfirmed/)).toBeTruthy();expect((within(section).getByLabelText('Terminal reference') as HTMLInputElement).value).toBe('TRM-NEW');
});

test('matching outlet and terminal creation receipts accept server defaults',async()=>{
 (ApiClient.post as jest.Mock).mockResolvedValueOnce({...outlet('new'),reference:'OUT-NEW',name:'New Desk'}).mockResolvedValueOnce({...terminal(),id:'new-terminal',reference:'TRM-NEW'});
 const section=await open();fireEvent.change(within(section).getByLabelText('Outlet reference'),{target:{value:'OUT-NEW'}});fireEvent.change(within(section).getByLabelText('Outlet name'),{target:{value:'New Desk'}});fireEvent.click(within(section).getByRole('button',{name:'Create outlet'}));
 expect(await within(section).findByText('Outlet OUT-NEW created.')).toBeTruthy();expect((within(section).getByLabelText('Outlet reference') as HTMLInputElement).value).toBe('');
 fireEvent.change(within(section).getByLabelText('Terminal reference'),{target:{value:'TRM-NEW'}});fireEvent.change(within(section).getByLabelText('Terminal outlet'),{target:{value:'outlet'}});fireEvent.click(within(section).getByRole('button',{name:'Create terminal'}));
 expect(await within(section).findByText('Terminal TRM-NEW created.')).toBeTruthy();expect((within(section).getByLabelText('Terminal reference') as HTMLInputElement).value).toBe('');
});
