import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { ApiClient } from '../src/services/api-client';
import { useAuthStore } from '../src/store/auth-store';
import { CustomerProofOfAddressPanel } from '../src/screens/authenticated/CustomerProofOfAddressPanel';
import { CustomerTier3ReadinessPanel } from '../src/screens/authenticated/CustomerTier3ReadinessPanel';

jest.mock('../src/services/api-client', () => ({
  ApiClient: {
    get: jest.fn(),
    post: jest.fn(),
    postForm: jest.fn(),
    getBlob: jest.fn(),
  },
}));

const customerId = 'f8094370-c4e7-49d7-8af4-28c3a86612f1';
const rootPath = `/customers/${customerId}/proof-of-address`;
const address = {
  id: '9cd3027c-7e70-4132-a65b-bb7a67b4a74a',
  type: 'RESIDENTIAL' as const,
  lineOne: '14 Sample Crescent',
  lineTwo: null,
  city: 'Abuja',
  state: 'FCT',
  country: 'NG',
  postalCode: null,
  isPrimary: true,
};
const capabilities = {
  enabled: true,
  maxUploadBytes: 10 * 1024 * 1024,
  allowedMimeTypes: ['application/pdf', 'image/jpeg', 'image/png'],
  previewAvailable: true,
  documentaryReviewEnabled: false,
  physicalVerificationEnabled: false,
  tier3OrWalletChangesEnabled: false,
};
const documentRecord = (overrides: Record<string, unknown> = {}) => ({
  id: '168ac94b-f3cf-45f0-9aa1-5093e78475f1',
  submissionGroupId: '884534fc-f93b-4c44-b213-87ef27111ac8',
  revisionNumber: 1,
  supersedesSubmissionId: null,
  customerId,
  residentialAddressId: address.id,
  category: 'UTILITY',
  documentType: 'UTILITY_BILL',
  issuerName: 'Example provider',
  documentDate: '2026-06-02',
  reviewStatus: 'PENDING',
  documentStatus: 'AVAILABLE',
  scannerResult: 'CLEAN',
  originalFileName: 'utility-bill.pdf',
  detectedMimeType: 'application/pdf',
  fileSizeBytes: '2048',
  uploadedAt: '2026-06-03T10:30:00.000Z',
  withdrawnAt: null,
  archivedAt: null,
  createdAt: '2026-06-03T10:30:00.000Z',
  updatedAt: '2026-06-03T10:30:00.000Z',
  ...overrides,
});
const historyEvent = {
  id: '7c7ab6ee-a106-4a4a-8999-625d8e5c3c79',
  submissionId: '168ac94b-f3cf-45f0-9aa1-5093e78475f1',
  action: 'UPLOADED',
  previousDocumentStatus: null,
  newDocumentStatus: 'AVAILABLE',
  actorRoleKey: 'OPERATIONS',
  reason: null,
  createdAt: '2026-06-03T10:30:00.000Z',
};

function setPermissions(scopes: string[], roles: string[] = ['OPERATIONS']) {
  useAuthStore.setState({
    isAuthenticated: true,
    isLoading: false,
    token: 'test-token',
    sessionId: 'test-session',
    principal: {
      type: 'OPERATOR',
      principalId: 'operator-1',
      sessionId: 'test-session',
      audience: 'workforce-admin',
      roles,
      scopes,
      customerAccess: 'ALL',
      assuranceLevel: 'AAL2',
    },
  });
}

function configureEnabledApi(options?: {
  documents?: ReturnType<typeof documentRecord>[];
  total?: number;
  addresses?: Array<typeof address & { deletedAt?: string | null }>;
  history?: (typeof historyEvent)[];
  nextPage?: ReturnType<typeof documentRecord>[];
}) {
  const documents = options?.documents ?? [documentRecord()];
  const addresses = options?.addresses ?? [address];
  const history = options?.history ?? [historyEvent];
  const total = options?.total ?? documents.length;

  (ApiClient.get as jest.Mock).mockImplementation((path: string) => {
    if (path === `${rootPath}/capabilities`) return Promise.resolve(capabilities);
    if (path === `${rootPath}?page=1&limit=20`) {
      return Promise.resolve({ items: documents, page: 1, limit: 20, total });
    }
    if (path === `${rootPath}?page=2&limit=20`) {
      return Promise.resolve({
        items: options?.nextPage ?? [],
        page: 2,
        limit: 20,
        total,
      });
    }
    if (path === `/customers/${customerId}/addresses`) return Promise.resolve(addresses);
    if (path.endsWith('/history?page=1&limit=20')) {
      return Promise.resolve({ items: history, page: 1, limit: 20, total: history.length });
    }
    return Promise.reject(new Error(`Unexpected GET ${path}`));
  });
  (ApiClient.post as jest.Mock).mockImplementation((path: string) => Promise.resolve(documentRecord({ documentStatus: path.endsWith('/archive') ? 'ARCHIVED' : 'WITHDRAWN' })));
  (ApiClient.postForm as jest.Mock).mockResolvedValue(documentRecord());
  (ApiClient.getBlob as jest.Mock).mockResolvedValue(
    new Blob(['%PDF-1.4\nsynthetic test document\n%%EOF'], { type: 'application/pdf' }),
  );
}

const operationsScopes = [
  'customer.view_proof_of_address_metadata',
  'customer.view_address',
  'customer.upload_proof_of_address',
  'customer.withdraw_proof_of_address',
];

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  useAuthStore.setState({ isAuthenticated: false, principal: null, token: null, sessionId: null });
  Object.defineProperty(globalThis.crypto, 'getRandomValues', {
    configurable: true,
    value: (bytes: Uint8Array) => {
      bytes.fill(17);
      return bytes;
    },
  });
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: jest.fn(() => 'blob:poa-preview-test'),
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: jest.fn(),
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('Customer Proof of Address and readiness interfaces', () => {
  test('does not fetch customer records or expose controls without metadata permission', () => {
    setPermissions(['customer.view']);
    render(<CustomerProofOfAddressPanel customerId={customerId} />);

    expect(screen.getByText(/not authorized to view Proof of Address metadata/i)).toBeTruthy();
    expect(ApiClient.get).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Document file (PDF, JPG, JPEG, PNG)')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Upload Proof of Address' })).toBeNull();
  });

  test('keeps all file actions disabled when the server feature flag is off', async () => {
    setPermissions(operationsScopes);
    (ApiClient.get as jest.Mock).mockResolvedValueOnce({ ...capabilities, enabled: false });
    render(<CustomerProofOfAddressPanel customerId={customerId} />);

    expect((await screen.findByRole('status')).textContent).toMatch(/POA_UPLOADS_ENABLED/);
    expect(ApiClient.get).toHaveBeenCalledTimes(1);
    expect(ApiClient.get).toHaveBeenCalledWith(`${rootPath}/capabilities`, expect.any(Object));
    expect(screen.queryByLabelText('Document file (PDF, JPG, JPEG, PNG)')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Upload Proof of Address' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Physical address verification' })).toBeTruthy();
  });

  test('fails closed when the server capability/configuration check fails', async () => {
    setPermissions(operationsScopes);
    (ApiClient.get as jest.Mock).mockRejectedValueOnce(
      Object.assign(new Error('Private storage is unavailable'), { status: 503 }),
    );
    render(<CustomerProofOfAddressPanel customerId={customerId} />);

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByLabelText('Document file (PDF, JPG, JPEG, PNG)')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Upload Proof of Address' })).toBeNull();
    expect(ApiClient.postForm).not.toHaveBeenCalled();
  });

  test('keeps upload controls hidden without the dedicated upload scope even when the server is enabled', async () => {
    setPermissions(['customer.view_proof_of_address_metadata', 'customer.view_address']);
    configureEnabledApi();
    render(<CustomerProofOfAddressPanel customerId={customerId} />);

    expect(await screen.findByRole('heading', { name: 'Utility bill · revision 1' })).toBeTruthy();
    expect(screen.queryByLabelText('Document file (PDF, JPG, JPEG, PNG)')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Upload Proof of Address' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Replace with a new revision' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Preview' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Download' })).toBeNull();
    expect(ApiClient.postForm).not.toHaveBeenCalled();
  });

  test('keeps upload disabled without residential-address permission', async () => {
    setPermissions(['customer.view_proof_of_address_metadata', 'customer.upload_proof_of_address']);
    configureEnabledApi();
    render(<CustomerProofOfAddressPanel customerId={customerId} />);

    expect(
      await screen.findByText(/authorized to view a customer residential address/i),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Upload Proof of Address' })).toHaveProperty(
      'disabled',
      true,
    );
    expect(ApiClient.get).not.toHaveBeenCalledWith(
      `/customers/${customerId}/addresses`,
      expect.any(Object),
    );
  });

  test('does not offer a deleted residential address for a new upload', async () => {
    setPermissions(operationsScopes);
    configureEnabledApi({
      addresses: [{ ...address, deletedAt: '2026-06-04T10:00:00.000Z' }],
    });
    render(<CustomerProofOfAddressPanel customerId={customerId} />);

    expect(await screen.findByText(/No active residential address is available/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Upload Proof of Address' })).toHaveProperty(
      'disabled',
      true,
    );
  });

  test('loads authorized metadata, previews a clean file, and shows recorded history', async () => {
    setPermissions([...operationsScopes, 'customer.download_proof_of_address']);
    configureEnabledApi();
    render(<CustomerProofOfAddressPanel customerId={customerId} />);

    expect(await screen.findByRole('heading', { name: 'Utility bill · revision 1' })).toBeTruthy();
    expect(screen.getByText(/does not verify or approve the evidence/i)).toBeTruthy();
    expect(screen.getByLabelText('Associated residential address')).toHaveProperty(
      'value',
      address.id,
    );

    fireEvent.click(screen.getByRole('button', { name: 'View history' }));
    expect(await screen.findByText('UPLOADED')).toBeTruthy();
    expect(ApiClient.get).toHaveBeenCalledWith(
      `${rootPath}/${documentRecord().id}/history?page=1&limit=20`,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    const previewFrame = await screen.findByTitle('Preview of utility-bill.pdf');
    expect(previewFrame.getAttribute('sandbox')).toBe('');
    expect(ApiClient.getBlob).toHaveBeenCalledWith(
      `${rootPath}/${documentRecord().id}/content?disposition=inline`,
      expect.any(Object),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close preview' }));
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:poa-preview-test'));
  });

  test('uploads multipart metadata with a stable idempotency key and can request a download', async () => {
    setPermissions([...operationsScopes, 'customer.download_proof_of_address']);
    configureEnabledApi();
    (ApiClient.postForm as jest.Mock).mockImplementation((_path: string, body: FormData) => Promise.resolve(documentRecord({ originalFileName: (body.get('file') as File).name, fileSizeBytes: String((body.get('file') as File).size), issuerName: body.get('issuerName'), documentDate: body.get('documentDate') })));
    const anchorClick = jest
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});
    render(<CustomerProofOfAddressPanel customerId={customerId} />);

    await screen.findByRole('heading', { name: 'Utility bill · revision 1' });
    const file = new File(['%PDF-1.4\nlocal test content\n%%EOF'], 'new-bill.pdf', {
      type: 'application/pdf',
    });
    fireEvent.change(screen.getByLabelText('Document file (PDF, JPG, JPEG, PNG)'), {
      target: { files: [file] },
    });
    fireEvent.change(screen.getByLabelText('Issuer (optional)'), {
      target: { value: 'Test utility' },
    });
    fireEvent.submit(
      screen.getByRole('button', { name: 'Upload Proof of Address' }).closest('form')!,
    );

    await waitFor(() => expect(ApiClient.postForm).toHaveBeenCalledTimes(1));
    const [uploadPath, body, requestOptions] = (ApiClient.postForm as jest.Mock).mock.calls[0];
    expect(uploadPath).toBe(rootPath);
    expect(body).toBeInstanceOf(window.FormData);
    expect(((body as FormData).get('file') as File).name).toBe(file.name);
    expect((body as FormData).get('residentialAddressId')).toBe(address.id);
    expect((body as FormData).get('category')).toBe('UTILITY');
    expect((body as FormData).get('documentType')).toBe('UTILITY_BILL');
    expect((body as FormData).get('issuerName')).toBe('Test utility');
    expect(requestOptions).toEqual({ idempotencyKey: expect.any(String) });
    expect(
      await screen.findByText(/clean scan does not verify or approve the evidence/i),
    ).toBeTruthy();

    fireEvent.click(await screen.findByRole('button', { name: 'Download' }));
    await waitFor(() => expect(anchorClick).toHaveBeenCalledTimes(1));
    expect(ApiClient.getBlob).toHaveBeenCalledWith(
      `${rootPath}/${documentRecord().id}/content?disposition=attachment`,
    );
  });

  test('does not claim a clean upload for a mismatched or inconsistent receipt', async () => {
    setPermissions(operationsScopes);
    configureEnabledApi();
    (ApiClient.postForm as jest.Mock).mockResolvedValueOnce(documentRecord({ customerId: 'another-customer' }))
      .mockResolvedValueOnce(documentRecord({ documentStatus: 'AVAILABLE', scannerResult: 'UNAVAILABLE' }));
    render(<CustomerProofOfAddressPanel customerId={customerId} />);
    await screen.findByRole('heading', { name: 'Utility bill · revision 1' });
    fireEvent.change(screen.getByLabelText('Document file (PDF, JPG, JPEG, PNG)'), { target: { files: [new File(['synthetic'], 'synthetic.pdf', { type: 'application/pdf' })] } });
    const upload = screen.getByRole('button', { name: 'Upload Proof of Address' });
    fireEvent.submit(upload.closest('form')!);
    expect(await screen.findByText(/Upload outcome could not be confirmed/)).toBeTruthy();
    expect(screen.queryByText(/submission is available with a clean malware scan/)).toBeNull();
    fireEvent.submit(upload.closest('form')!);
    expect(ApiClient.postForm).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Document file (PDF, JPG, JPEG, PNG)').matches(':disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name:'Refresh records for upload review' }));
    await waitFor(() => expect((screen.getByRole('button',{name:'I reviewed the records and history'}) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button',{name:'I reviewed the records and history'}));
    fireEvent.click(screen.getByRole('button',{name:'Retry same upload'}));
    await waitFor(() => expect(ApiClient.postForm).toHaveBeenCalledTimes(2));
    expect((ApiClient.postForm as jest.Mock).mock.calls[0][2]).toEqual((ApiClient.postForm as jest.Mock).mock.calls[1][2]);
    const firstBody = (ApiClient.postForm as jest.Mock).mock.calls[0][1] as FormData;
    const retryBody = (ApiClient.postForm as jest.Mock).mock.calls[1][1] as FormData;
    for (const name of ['file', 'category', 'documentType', 'residentialAddressId', 'issuerName', 'documentDate', 'supersedesSubmissionId']) {
      expect(retryBody.get(name)).toEqual(firstBody.get(name));
    }
    expect(await screen.findByText(/Upload outcome could not be confirmed/)).toBeTruthy();
  });

  test('upload replay in withdrawn state is not reported as a new clean upload', async () => {
    setPermissions(operationsScopes);
    configureEnabledApi();
    (ApiClient.postForm as jest.Mock).mockResolvedValueOnce(documentRecord({ documentStatus: 'WITHDRAWN', originalFileName: 'synthetic.pdf', fileSizeBytes: '9', issuerName: null, documentDate: null }));
    render(<CustomerProofOfAddressPanel customerId={customerId} />);
    await screen.findByRole('heading', { name: 'Utility bill · revision 1' });
    fireEvent.change(screen.getByLabelText('Document file (PDF, JPG, JPEG, PNG)'), { target: { files: [new File(['synthetic'], 'synthetic.pdf', { type: 'application/pdf' })] } });
    fireEvent.submit(screen.getByRole('button', { name: 'Upload Proof of Address' }).closest('form')!);
    expect(await screen.findByText(/currently has status WITHDRAWN/)).toBeTruthy();
    expect(screen.queryByText(/submission is available with a clean malware scan/)).toBeNull();
  });

  test('replacement locks the original address and classification and creates a new revision request', async () => {
    setPermissions([...operationsScopes, 'customer.download_proof_of_address']);
    configureEnabledApi();
    (ApiClient.postForm as jest.Mock).mockResolvedValue(documentRecord({ revisionNumber: 2, supersedesSubmissionId: documentRecord().id }));
    render(<CustomerProofOfAddressPanel customerId={customerId} />);

    await screen.findByRole('heading', { name: 'Utility bill · revision 1' });
    fireEvent.click(screen.getByRole('button', { name: 'Replace with a new revision' }));
    expect(screen.getByText('Upload replacement for revision 1')).toBeTruthy();
    expect(screen.getByLabelText('Candidate category')).toHaveProperty('disabled', true);
    expect(screen.getByLabelText('Candidate document type')).toHaveProperty('disabled', true);
    expect(screen.getByLabelText('Associated residential address')).toHaveProperty(
      'disabled',
      true,
    );

    const replacement = new File(['%PDF-1.4\nnew revision\n%%EOF'], 'replacement.pdf', {
      type: 'application/pdf',
    });
    fireEvent.change(screen.getByLabelText('Document file (PDF, JPG, JPEG, PNG)'), {
      target: { files: [replacement] },
    });
    fireEvent.submit(screen.getByRole('button', { name: 'Upload replacement' }).closest('form')!);
    await waitFor(() => expect(ApiClient.postForm).toHaveBeenCalledTimes(1));
    const form = (ApiClient.postForm as jest.Mock).mock.calls[0][1] as FormData;
    expect(form.get('supersedesSubmissionId')).toBe(documentRecord().id);
    expect(form.get('residentialAddressId')).toBe(address.id);
    expect(form.get('category')).toBe('UTILITY');
    expect(form.get('documentType')).toBe('UTILITY_BILL');
  });

  test('malformed or cross-customer document lists are unavailable rather than empty', async () => {
    setPermissions(operationsScopes);
    configureEnabledApi({ documents: [documentRecord({ customerId: 'other-customer' })] });
    render(<CustomerProofOfAddressPanel customerId={customerId} />);
    expect(await screen.findByText('Document records are unavailable: invalid response.')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Utility bill · revision 1' })).toBeNull();
    expect(screen.queryByText(/No Proof of Address records/i)).toBeNull();
  });

  test('a history page from another document is reported as unavailable', async () => {
    setPermissions(operationsScopes);
    configureEnabledApi({ history: [{ ...historyEvent, submissionId: 'other-document' }] });
    render(<CustomerProofOfAddressPanel customerId={customerId} />);
    await screen.findByRole('heading', { name: 'Utility bill · revision 1' });
    fireEvent.click(screen.getByRole('button', { name: 'View history' }));
    expect(await screen.findByText(/Loading document history could not be completed/)).toBeTruthy();
    expect(screen.queryByText('UPLOADED')).toBeNull();
  });

  test('failed document refresh does not present previous records as current or empty', async () => {
    setPermissions(operationsScopes);
    configureEnabledApi();
    render(<CustomerProofOfAddressPanel customerId={customerId} />);
    await screen.findByRole('heading', { name: 'Utility bill · revision 1' });
    const previous = (ApiClient.get as jest.Mock).getMockImplementation()!;
    (ApiClient.get as jest.Mock).mockImplementation((path: string, options: unknown) =>
      path === `${rootPath}?page=1&limit=20` ? Promise.reject(new Error('Synthetic unavailable')) : previous(path, options));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh Proof of Address records' }));
    expect(await screen.findByText(/Loading document records.*could not/i)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Utility bill · revision 1' })).toBeNull();
    expect(screen.queryByText(/No Proof of Address records are stored/i)).toBeNull();
  });

  test('asynchronous preview restores focus to its trigger even when focus leaves during loading', async () => {
    setPermissions([...operationsScopes, 'customer.download_proof_of_address']);
    configureEnabledApi();
    let resolvePreview!: (blob: Blob) => void;
    (ApiClient.getBlob as jest.Mock).mockImplementation(() => new Promise<Blob>((resolve) => { resolvePreview = resolve; }));
    render(<CustomerProofOfAddressPanel customerId={customerId} />);
    await screen.findByRole('heading', { name: 'Utility bill · revision 1' });
    const trigger = screen.getByRole('button', { name: 'Preview' });
    trigger.focus();
    fireEvent.click(trigger);
    expect(trigger).toHaveProperty('disabled', true);
    trigger.blur();
    resolvePreview(new Blob(['synthetic'], { type: 'application/pdf' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Close preview' })).toBe(document.activeElement);
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  test('document lifecycle dialog supports Escape and restores focus without submitting', async () => {
    setPermissions(operationsScopes);
    configureEnabledApi();
    render(<CustomerProofOfAddressPanel customerId={customerId} />);
    await screen.findByRole('heading', { name: 'Utility bill · revision 1' });
    const trigger = screen.getByRole('button', { name: 'Withdraw' });
    trigger.focus();
    fireEvent.click(trigger);
    expect(document.activeElement).toBe(screen.getByLabelText('Reason (required)'));
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(ApiClient.post).not.toHaveBeenCalled();
  });

  test('withdrawal requires a non-empty reason and records the action', async () => {
    setPermissions(operationsScopes);
    configureEnabledApi();
    render(<CustomerProofOfAddressPanel customerId={customerId} />);

    await screen.findByRole('heading', { name: 'Utility bill · revision 1' });
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Confirm withdrawal' })).toHaveProperty(
      'disabled',
      true,
    );
    fireEvent.change(within(dialog).getByLabelText('Reason (required)'), {
      target: { value: 'Customer supplied a replacement document' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm withdrawal' }));

    await waitFor(() =>
      expect(ApiClient.post).toHaveBeenCalledWith(`${rootPath}/${documentRecord().id}/withdraw`, {
        reason: 'Customer supplied a replacement document',
      }),
    );
    expect(
      await screen.findByText(/document was withdrawn. Content access is disabled/i),
    ).toBeTruthy();
  });

  test('a mismatched withdrawal receipt leaves the action unconfirmed', async () => {
    setPermissions(operationsScopes);
    configureEnabledApi();
    (ApiClient.post as jest.Mock).mockResolvedValueOnce(documentRecord({ id: 'different-document', documentStatus: 'WITHDRAWN' }));
    render(<CustomerProofOfAddressPanel customerId={customerId} />);
    await screen.findByRole('heading', { name: 'Utility bill · revision 1' });
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Reason (required)'), { target: { value: 'Synthetic reason' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm withdrawal' }));
    expect(await within(dialog).findByText(/Withdrawal outcome could not be confirmed/)).toBeTruthy();
    expect(screen.queryByText(/document was withdrawn. Content access is disabled/i)).toBeNull();
  });

  test('late document actions cannot populate a different workforce session', async () => {
    setPermissions(operationsScopes);
    configureEnabledApi();
    let resolveAction!: (value: ReturnType<typeof documentRecord>) => void;
    (ApiClient.post as jest.Mock).mockImplementationOnce(() => new Promise((resolve) => { resolveAction = resolve; }));
    render(<CustomerProofOfAddressPanel customerId={customerId} />);
    await screen.findByRole('heading', { name: 'Utility bill · revision 1' });
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Reason (required)'), { target: { value: 'Synthetic reason' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm withdrawal' }));
    const principal = useAuthStore.getState().principal!;
    act(() => useAuthStore.setState({ sessionId: 'new-session', principal: { ...principal, sessionId: 'new-session', principalId: 'new-user' } }));
    await act(async () => { resolveAction(documentRecord({ documentStatus: 'WITHDRAWN' })); });
    expect(screen.queryByText(/document was withdrawn. Content access is disabled/i)).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('archive requires a withdrawn record and a separate archive scope', async () => {
    const withdrawnDocument = documentRecord({
      documentStatus: 'WITHDRAWN',
      withdrawnAt: '2026-06-04T10:00:00.000Z',
    });
    setPermissions([
      'customer.view_proof_of_address_metadata',
      'customer.view_address',
      'customer.withdraw_proof_of_address',
      'customer.archive_proof_of_address',
    ]);
    configureEnabledApi({ documents: [withdrawnDocument] });
    render(<CustomerProofOfAddressPanel customerId={customerId} />);

    await screen.findByRole('heading', { name: 'Utility bill · revision 1' });
    expect(screen.queryByRole('button', { name: 'Preview' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Archive withdrawn record' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Reason (required)'), {
      target: { value: 'Retention review completed' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm archive' }));

    await waitFor(() =>
      expect(ApiClient.post).toHaveBeenCalledWith(`${rootPath}/${withdrawnDocument.id}/archive`, {
        reason: 'Retention review completed',
      }),
    );
    expect(await screen.findByText(/archived. Archival retains the audit record/i)).toBeTruthy();
  });

  test('does not expose withdrawal to a principal without the withdrawal scope', async () => {
    setPermissions([
      'customer.view_proof_of_address_metadata',
      'customer.view_address',
      'customer.upload_proof_of_address',
    ]);
    configureEnabledApi();
    render(<CustomerProofOfAddressPanel customerId={customerId} />);

    await screen.findByRole('heading', { name: 'Utility bill · revision 1' });
    expect(screen.queryByRole('button', { name: 'Withdraw' })).toBeNull();
  });

  test('does not expose archival to a principal without the archive scope', async () => {
    const withdrawnDocument = documentRecord({ documentStatus: 'WITHDRAWN' });
    setPermissions([
      'customer.view_proof_of_address_metadata',
      'customer.view_address',
      'customer.withdraw_proof_of_address',
    ]);
    configureEnabledApi({ documents: [withdrawnDocument] });
    render(<CustomerProofOfAddressPanel customerId={customerId} />);

    await screen.findByRole('heading', { name: 'Utility bill · revision 1' });
    expect(screen.queryByRole('button', { name: 'Archive withdrawn record' })).toBeNull();
  });

  test('keeps quarantined content unavailable even when the caller has download permission', async () => {
    setPermissions([...operationsScopes, 'customer.download_proof_of_address']);
    configureEnabledApi({
      documents: [documentRecord({ documentStatus: 'QUARANTINED', scannerResult: 'UNAVAILABLE' })],
    });
    render(<CustomerProofOfAddressPanel customerId={customerId} />);

    await screen.findByRole('heading', { name: 'Utility bill · revision 1' });
    expect(screen.getByText(/quarantined. Preview and download are unavailable/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Preview' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Download' })).toBeNull();
    expect(ApiClient.getBlob).not.toHaveBeenCalled();
  });

  test('paginates document metadata without displaying approval or wallet-tier actions', async () => {
    setPermissions([...operationsScopes, 'customer.download_proof_of_address']);
    const secondPageDocument = documentRecord({
      id: 'd05d0f96-cc4d-4bdb-8ef5-1cf293a36ea9',
      originalFileName: 'bank-statement.png',
      category: 'BANK',
      documentType: 'BANK_STATEMENT',
      detectedMimeType: 'image/png',
    });
    configureEnabledApi({ total: 21, nextPage: [secondPageDocument] });
    render(<CustomerProofOfAddressPanel customerId={customerId} />);

    await screen.findByRole('heading', { name: 'Utility bill · revision 1' });
    fireEvent.click(screen.getByRole('button', { name: 'Load more records' }));
    expect(
      await screen.findByRole('heading', { name: 'Bank statement · revision 1' }),
    ).toBeTruthy();
    expect(ApiClient.get).toHaveBeenCalledWith(`${rootPath}?page=2&limit=20`);
    expect(screen.queryByRole('button', { name: /approve|verify|tier 3|wallet/i })).toBeNull();
  });

  test('keeps activation, phone, identity, PoA, physical review, KYC, eligibility, and wallet-tier signals distinct', () => {
    render(
      <CustomerTier3ReadinessPanel
        customerType="INDIVIDUAL"
        customerStatus="DRAFT"
        phoneVerified={false}
        kycLevel="LEVEL_1"
        kycStatus="PENDING"
        financialEligibility="PENDING"
      />,
    );

    expect(screen.getByRole('heading', { name: 'Tier 3 readiness factors' })).toBeTruthy();
    expect(screen.getByText('DRAFT')).toBeTruthy();
    expect(screen.getByText('Not verified')).toBeTruthy();
    expect(screen.getByText('Not separately recorded')).toBeTruthy();
    expect(screen.getAllByText('Not configured').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('LEVEL_1 · PENDING')).toBeTruthy();
    expect(screen.getByText('PENDING')).toBeTruthy();
    expect(screen.getByText('No action')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /upgrade|activate wallet tier/i })).toBeNull();
    expect(
      screen.getByText(/no wallet-tier or customer privilege change is available/i),
    ).toBeTruthy();
  });
});

test('read-only session can view evidence but cannot upload, withdraw or archive despite write grants',async()=>{
 setPermissions([...operationsScopes,'customer.archive_proof_of_address']);useAuthStore.setState(state=>({principal:state.principal?{...state.principal,readOnlyPrincipal:true}:null}));configureEnabledApi();render(<CustomerProofOfAddressPanel customerId={customerId}/>);await screen.findByText(/utility-bill.pdf/);expect(screen.queryByRole('button',{name:'Upload Proof of Address'})).toBeNull();expect(screen.queryByRole('button',{name:'Withdraw'})).toBeNull();expect(screen.queryByRole('button',{name:'Archive withdrawn record'})).toBeNull();expect(ApiClient.post).not.toHaveBeenCalled();expect(ApiClient.postForm).not.toHaveBeenCalled();
});

test('uncertain withdrawal is locked until a fresh record and its history are reviewed',async()=>{
 setPermissions(operationsScopes);configureEnabledApi();(ApiClient.post as jest.Mock).mockResolvedValueOnce(documentRecord({id:'wrong',documentStatus:'WITHDRAWN'}));render(<CustomerProofOfAddressPanel customerId={customerId}/>);await screen.findByRole('heading',{name:'Utility bill · revision 1'});fireEvent.click(screen.getByRole('button',{name:'Withdraw'}));const dialog=screen.getByRole('dialog');fireEvent.change(within(dialog).getByLabelText('Reason (required)'),{target:{value:'Synthetic reason'}});fireEvent.click(within(dialog).getByRole('button',{name:'Confirm withdrawal'}));expect(await within(dialog).findByText(/outcome could not be confirmed/)).toBeTruthy();expect((within(dialog).getByRole('button',{name:'Confirm withdrawal'}) as HTMLButtonElement).disabled).toBe(true);fireEvent.click(within(dialog).getByRole('button',{name:'Cancel'}));expect((screen.getByRole('button',{name:'Withdraw'}) as HTMLButtonElement).disabled).toBe(true);fireEvent.click(screen.getByRole('button',{name:'Refresh Proof of Address records'}));await screen.findByRole('heading',{name:'Utility bill · revision 1'});expect((screen.getByRole('button',{name:'I reviewed this document and history'}) as HTMLButtonElement).disabled).toBe(true);fireEvent.click(screen.getByRole('button',{name:'View history'}));await screen.findByText('UPLOADED');expect((screen.getByRole('button',{name:'I reviewed this document and history'}) as HTMLButtonElement).disabled).toBe(false);fireEvent.click(screen.getByRole('button',{name:'I reviewed this document and history'}));expect((screen.getByRole('button',{name:'Withdraw'}) as HTMLButtonElement).disabled).toBe(false);expect(ApiClient.post).toHaveBeenCalledTimes(1);
});
test('failed document refresh cannot unlock an unconfirmed upload retry',async()=>{
 setPermissions(operationsScopes);configureEnabledApi();(ApiClient.postForm as jest.Mock).mockRejectedValueOnce(new Error('network'));render(<CustomerProofOfAddressPanel customerId={customerId}/>);await screen.findByRole('heading',{name:'Utility bill · revision 1'});fireEvent.change(screen.getByLabelText('Document file (PDF, JPG, JPEG, PNG)'),{target:{files:[new File(['synthetic'],'synthetic.pdf',{type:'application/pdf'})]}});fireEvent.submit(screen.getByRole('button',{name:'Upload Proof of Address'}).closest('form')!);await screen.findByText(/Upload outcome could not be confirmed/);const old=(ApiClient.get as jest.Mock).getMockImplementation()!;(ApiClient.get as jest.Mock).mockImplementation((path:string,opts:unknown)=>path===`${rootPath}?page=1&limit=20`?Promise.reject(new Error('unavailable')):old(path,opts));fireEvent.click(screen.getByRole('button',{name:'Refresh records for upload review'}));await screen.findByText(/Loading document records.*could not/i);expect((screen.getByRole('button',{name:'I reviewed the records and history'}) as HTMLButtonElement).disabled).toBe(true);expect((screen.getByRole('button',{name:'Retry same upload'}) as HTMLButtonElement).disabled).toBe(true);expect(ApiClient.postForm).toHaveBeenCalledTimes(1);
});
test('lifecycle actions serialize synchronously',async()=>{
 setPermissions(operationsScopes);configureEnabledApi();let resolve!:(v:any)=>void;const pending=new Promise(r=>resolve=r);(ApiClient.post as jest.Mock).mockReturnValueOnce(pending);render(<CustomerProofOfAddressPanel customerId={customerId}/>);await screen.findByRole('heading',{name:'Utility bill · revision 1'});fireEvent.click(screen.getByRole('button',{name:'Withdraw'}));const dialog=screen.getByRole('dialog');fireEvent.change(within(dialog).getByLabelText('Reason (required)'),{target:{value:'Synthetic reason'}});const form=dialog as HTMLFormElement;fireEvent.submit(form);fireEvent.submit(form);expect(ApiClient.post).toHaveBeenCalledTimes(1);await act(async()=>{resolve(documentRecord({documentStatus:'WITHDRAWN'}));await pending;});
});

test('a lifecycle conflict requires a fresh record and history review', async () => {
  setPermissions(operationsScopes);
  configureEnabledApi();
  (ApiClient.post as jest.Mock).mockRejectedValueOnce(Object.assign(new Error('conflict'), { status: 409 }));
  render(<CustomerProofOfAddressPanel customerId={customerId} />);
  await screen.findByRole('heading', { name: 'Utility bill · revision 1' });
  fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
  const dialog = screen.getByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('Reason (required)'), { target: { value: 'Synthetic reason' } });
  fireEvent.submit(dialog);
  expect(await within(dialog).findByText(/action conflicted/)).toBeTruthy();
  expect((within(dialog).getByRole('button', { name: 'Confirm withdrawal' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect((screen.getByRole('button', { name: 'Withdraw' }) as HTMLButtonElement).disabled).toBe(true);
  expect(ApiClient.post).toHaveBeenCalledTimes(1);
});

test('an unconfirmed upload needs explicit discard and cannot double-submit', async () => {
  setPermissions(operationsScopes);
  configureEnabledApi();
  let reject!: (reason: Error) => void;
  const pending = new Promise((_resolve, fail) => { reject = fail; });
  (ApiClient.postForm as jest.Mock).mockReturnValueOnce(pending);
  render(<CustomerProofOfAddressPanel customerId={customerId} />);
  await screen.findByRole('heading', { name: 'Utility bill · revision 1' });
  fireEvent.change(screen.getByLabelText('Document file (PDF, JPG, JPEG, PNG)'), { target: { files: [new File(['synthetic'], 'synthetic.pdf', { type: 'application/pdf' })] } });
  const form = screen.getByRole('button', { name: 'Upload Proof of Address' }).closest('form')!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(ApiClient.postForm).toHaveBeenCalledTimes(1);
  await act(async () => { reject(new Error('network')); await pending.catch(() => undefined); });
  expect(await screen.findByText(/Upload outcome could not be confirmed/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Abandon pending upload' }));
  expect(screen.getByText(/original may already exist/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Keep pending upload' }));
  expect(screen.getByRole('button', { name: 'Retry same upload' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Abandon pending upload' }));
  fireEvent.click(screen.getByRole('button', { name: 'Discard pending upload' }));
  expect(screen.queryByRole('button', { name: 'Retry same upload' })).toBeNull();
  expect(ApiClient.postForm).toHaveBeenCalledTimes(1);
});

test('upload draft cannot be silently replaced or discarded', async () => {
  setPermissions(operationsScopes); configureEnabledApi();
  render(<CustomerProofOfAddressPanel customerId={customerId} />);
  await screen.findByRole('heading', { name: 'Utility bill · revision 1' });
  fireEvent.change(screen.getByLabelText('Issuer (optional)'), { target: { value: 'Unfinished synthetic issuer' } });
  expect((screen.getByRole('button', { name: 'Replace with a new revision' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: 'Withdraw' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Discard upload draft' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Keep draft' }));
  expect((screen.getByLabelText('Issuer (optional)') as HTMLInputElement).value).toBe('Unfinished synthetic issuer');
  fireEvent.click(screen.getByRole('button', { name: 'Discard upload draft' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Discard draft' }));
  expect((screen.getByLabelText('Issuer (optional)') as HTMLInputElement).value).toBe('');
  expect((screen.getByRole('button', { name: 'Withdraw' }) as HTMLButtonElement).disabled).toBe(false);
  expect(ApiClient.post).not.toHaveBeenCalled(); expect(ApiClient.postForm).not.toHaveBeenCalled();
});

test('address section navigation reflects enabled evidence capability without uploading',async()=>{
 jest.clearAllMocks();setPermissions(['customer.view_proof_of_address_metadata','customer.upload_proof_of_address','customer.view_address']);configureEnabledApi();render(<CustomerProofOfAddressPanel customerId={customerId}/>);
 const nav=await screen.findByRole('navigation',{name:'Address verification sections'});await within(nav).findByRole('link',{name:'Evidence upload'});expect(within(nav).getByRole('link',{name:'Submission history'}).getAttribute('href')).toBe('#cm-poa-history-heading');expect(ApiClient.postForm).not.toHaveBeenCalled();
});

test('evidence filters only loaded records and keeps lifecycle review locks visible',async()=>{
 jest.clearAllMocks();setPermissions(operationsScopes);configureEnabledApi({documents:[documentRecord(),documentRecord({id:'other',submissionGroupId:'other-group',documentStatus:'QUARANTINED',scannerResult:'UNAVAILABLE',originalFileName:'quarantined.pdf'})]});
 (ApiClient.post as jest.Mock).mockResolvedValueOnce(documentRecord({id:'wrong',documentStatus:'WITHDRAWN'}));render(<CustomerProofOfAddressPanel customerId={customerId}/>);await screen.findByText(/utility-bill.pdf/);
 fireEvent.click(screen.getByRole('button',{name:'Available'}));expect(screen.queryByText(/quarantined.pdf/)).toBeNull();expect(screen.getByText('1 of 2 loaded records shown')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Withdraw'}));const dialog=screen.getByRole('dialog');fireEvent.change(within(dialog).getByLabelText('Reason (required)'),{target:{value:'Synthetic reason'}});fireEvent.click(within(dialog).getByRole('button',{name:'Confirm withdrawal'}));await within(dialog).findByText(/outcome could not be confirmed/);fireEvent.click(within(dialog).getByRole('button',{name:'Cancel'}));
 expect(screen.getByText(/quarantined.pdf/)).toBeTruthy();expect((screen.getByRole('button',{name:'Available'}) as HTMLButtonElement).disabled).toBe(true);expect(screen.getByText(/previous document action was not confirmed/)).toBeTruthy();expect(ApiClient.post).toHaveBeenCalledTimes(1);
});

test('metadata-only evidence does not imply a zero-byte upload or upload timestamp',async()=>{
 jest.clearAllMocks();setPermissions(operationsScopes);configureEnabledApi({documents:[documentRecord({documentStatus:'QUARANTINED',scannerResult:'UNAVAILABLE',originalFileName:null,fileSizeBytes:null,uploadedAt:null})]});render(<CustomerProofOfAddressPanel customerId={customerId}/>);
 expect(await screen.findByText(/File name not recorded · Not recorded · recorded/)).toBeTruthy();expect(screen.queryByText(/0 B · uploaded/)).toBeNull();
});
