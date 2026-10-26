import React, { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';

import {
  CANDIDATE_PROOF_OF_ADDRESS_FILE_EXTENSIONS,
  CANDIDATE_PROOF_OF_ADDRESS_MIME_TYPES,
  CANDIDATE_PROOF_OF_ADDRESS_TYPES,
  candidateProofTypesForCategory,
  isCandidateProofType,
} from '../../../../../src/customer-proof-of-address/customer-proof-of-address.constants';
import { ApiClient } from '../../services/api-client';
import { useAuthStore } from '../../store/auth-store';

const CANDIDATE_CATEGORIES = Array.from(
  new Set(CANDIDATE_PROOF_OF_ADDRESS_TYPES.map((candidate) => candidate.category)),
);
const FILE_ACCEPT = [
  ...CANDIDATE_PROOF_OF_ADDRESS_FILE_EXTENSIONS,
  ...CANDIDATE_PROOF_OF_ADDRESS_MIME_TYPES,
].join(',');
const PAGE_SIZE = 20;

interface ProofOfAddressCapabilities {
  enabled: boolean;
  maxUploadBytes: number;
  allowedMimeTypes: string[];
  previewAvailable: boolean;
  documentaryReviewEnabled: boolean;
  physicalVerificationEnabled: boolean;
  tier3OrWalletChangesEnabled: boolean;
}

interface AddressRecord {
  id: string;
  type: 'RESIDENTIAL' | 'BUSINESS' | 'MAILING';
  lineOne: string;
  lineTwo: string | null;
  city: string;
  state: string;
  country: string;
  postalCode: string | null;
  isPrimary: boolean;
  deletedAt?: string | null;
}

interface ProofOfAddressDocument {
  id: string;
  submissionGroupId: string;
  revisionNumber: number;
  supersedesSubmissionId: string | null;
  customerId: string;
  residentialAddressId: string;
  category: string;
  documentType: string;
  issuerName: string | null;
  documentDate: string | null;
  reviewStatus: string;
  documentStatus: string;
  scannerResult: string | null;
  originalFileName: string | null;
  detectedMimeType: string | null;
  fileSizeBytes: string | null;
  uploadedAt: string | null;
  withdrawnAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Page<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
}

interface ProofOfAddressHistoryEvent {
  id: string;
  submissionId: string;
  action: string;
  previousDocumentStatus: string | null;
  newDocumentStatus: string | null;
  actorRoleKey: string;
  reason: string | null;
  createdAt: string;
}

interface HistoryState {
  items: ProofOfAddressHistoryEvent[];
  page: number;
  limit: number;
  total: number;
  visible: boolean;
  loading: boolean;
  error: string | null;
}

interface PreviewState {
  document: ProofOfAddressDocument;
  objectUrl: string;
  mimeType: string;
}

type LifecycleAction = 'withdraw' | 'archive';

function apiPath(customerId: string): string {
  return `/customers/${encodeURIComponent(customerId)}/proof-of-address`;
}

function statusOf(error: unknown): number | undefined {
  if (!error || typeof error !== 'object' || !('status' in error)) return undefined;
  const status = Number((error as { status?: unknown }).status);
  return Number.isFinite(status) ? status : undefined;
}

function errorMessage(error: unknown, action: string): string {
  if (error instanceof Error && error.name === 'NetworkError') {
    return 'The Proof of Address API could not be reached. Check connectivity and retry.';
  }
  const status = statusOf(error);
  if (status === 401) return 'Your workforce session has expired. Sign in again.';
  if (status === 403) return 'Your current workforce permissions do not allow this action.';
  if (status === 404) return 'This record is not available for the selected customer.';
  if (status === 409) {
    const message = error instanceof Error ? error.message : '';
    if (/disabled/i.test(message))
      return 'Proof of Address uploads are disabled by server configuration.';
    if (/duplicate|idempotency/i.test(message)) {
      return 'This file or request conflicts with an existing submission. Refresh the record list before retrying.';
    }
    return 'The document changed or conflicts with another action. Refresh the records and try again.';
  }
  if (status === 413) return 'This file exceeds the configured upload-size limit.';
  if (status === 503) {
    return `${action} is temporarily unavailable. Private storage, encryption, or scanning is not ready; the document remains unavailable.`;
  }
  if (status === 400) {
    return 'The request was rejected. Check the selected address, metadata, and that the file is a valid PDF, JPEG, or PNG.';
  }
  if (status === 0)
    return 'The Proof of Address API could not be reached. Check connectivity and retry.';
  return `${action} could not be completed. Retry after refreshing the customer records.`;
}

function formatBytes(value: number | string | null | undefined): string {
  const bytes = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return 'Not recorded';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? 'Not recorded'
    : date.toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' });
}

function formatDocumentDate(value: string | null | undefined): string {
  if (!value) return 'Not recorded';
  const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(date.valueOf())
    ? 'Not recorded'
    : date.toLocaleDateString('en-NG', { dateStyle: 'medium', timeZone: 'UTC' });
}

function addressLabel(address: AddressRecord): string {
  return [
    address.lineOne,
    address.lineTwo,
    address.city,
    address.state,
    address.postalCode,
    address.country,
    address.isPrimary ? 'Primary' : null,
  ]
    .filter(Boolean)
    .join(', ');
}

function documentTypeLabel(document: ProofOfAddressDocument): string {
  return (
    CANDIDATE_PROOF_OF_ADDRESS_TYPES.find(
      (candidate) =>
        candidate.category === document.category && candidate.type === document.documentType,
    )?.label ?? document.documentType.replace(/_/g, ' ')
  );
}

function secureRequestKey(): string {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error('Secure random generation is not available in this browser');
  }
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function latestRevisionIds(documents: ProofOfAddressDocument[]): Set<string> {
  const supersededIds = new Set(
    documents
      .map((document) => document.supersedesSubmissionId)
      .filter((id): id is string => Boolean(id)),
  );
  return new Set(
    documents.filter((document) => !supersededIds.has(document.id)).map(({ id }) => id),
  );
}

async function settled<T>(promise: Promise<T>): Promise<{ value: T } | { error: unknown }> {
  try {
    return { value: await promise };
  } catch (error) {
    return { error };
  }
}

interface CustomerProofOfAddressPanelProps {
  customerId: string;
}

export const CustomerProofOfAddressPanel: React.FC<CustomerProofOfAddressPanelProps> = ({
  customerId,
}) => {
  const { principal } = useAuthStore();
  const scopes = principal?.scopes ?? [];
  const scopesKey = scopes.join('|');
  const canViewMetadata = scopes.includes('customer.view_proof_of_address_metadata');
  const canViewAddress = scopes.includes('customer.view_address');
  const canUpload = scopes.includes('customer.upload_proof_of_address');
  const canDownload = scopes.includes('customer.download_proof_of_address');
  const canWithdraw = scopes.includes('customer.withdraw_proof_of_address');
  const canArchive = scopes.includes('customer.archive_proof_of_address');

  const [capabilities, setCapabilities] = useState<ProofOfAddressCapabilities | null>(null);
  const [capabilitiesError, setCapabilitiesError] = useState<string | null>(null);
  const [addresses, setAddresses] = useState<AddressRecord[]>([]);
  const [addressError, setAddressError] = useState<string | null>(null);
  const [documents, setDocuments] = useState<ProofOfAddressDocument[]>([]);
  const [documentPage, setDocumentPage] = useState(1);
  const [documentTotal, setDocumentTotal] = useState(0);
  const [listLoaded, setListLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [documentError, setDocumentError] = useState<string | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [category, setCategory] = useState<string>(CANDIDATE_CATEGORIES[0] ?? '');
  const candidateTypes = useMemo(() => candidateProofTypesForCategory(category), [category]);
  const [documentType, setDocumentType] = useState<string>(candidateTypes[0]?.type ?? '');
  const [addressId, setAddressId] = useState('');
  const [issuerName, setIssuerName] = useState('');
  const [documentDate, setDocumentDate] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [replacementTarget, setReplacementTarget] = useState<ProofOfAddressDocument | null>(null);

  const [historyByDocument, setHistoryByDocument] = useState<Record<string, HistoryState>>({});
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [previewLoadingId, setPreviewLoadingId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [pendingLifecycle, setPendingLifecycle] = useState<{
    document: ProofOfAddressDocument;
    action: LifecycleAction;
  } | null>(null);
  const [lifecycleReason, setLifecycleReason] = useState('');
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);
  const [lifecycleBusy, setLifecycleBusy] = useState(false);

  const currentCustomerId = useRef(customerId);
  const loadedIdentityRef = useRef<string | null>(null);
  const previewRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    currentCustomerId.current = customerId;
    previewRequest.current?.abort();
    previewRequest.current = null;
    setPreview(null);
    setPreviewLoadingId(null);
    setPendingLifecycle(null);
    setHistoryByDocument({});
    setDocuments([]);
    setAddresses([]);
    setAddressId('');
    setCategory(CANDIDATE_CATEGORIES[0] ?? '');
    setDocumentType(candidateProofTypesForCategory(CANDIDATE_CATEGORIES[0] ?? '')[0]?.type ?? '');
    setIssuerName('');
    setDocumentDate('');
    setSelectedFile(null);
    setFileInputKey((key) => key + 1);
    setIdempotencyKey(null);
    setUploadBusy(false);
    setReplacementTarget(null);
    setBusyAction(null);
    setNotice(null);
    setActionError(null);
    setLifecycleReason('');
    setLifecycleBusy(false);
    setLifecycleError(null);
  }, [customerId]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const identityKey = `${customerId}::${scopesKey}`;
    const isHardReset = loadedIdentityRef.current !== identityKey;
    loadedIdentityRef.current = identityKey;

    setLoadingMore(false);
    setCapabilitiesError(null);
    setAddressError(null);
    setDocumentError(null);
    setHistoryByDocument({});

    if (isHardReset) {
      setLoading(canViewMetadata);
      setCapabilities(null);
      setAddresses([]);
      setDocuments([]);
      setDocumentPage(1);
      setDocumentTotal(0);
      setListLoaded(false);
    }

    if (!canViewMetadata) {
      setLoading(false);
      return () => {
        active = false;
        controller.abort();
      };
    }

    const path = apiPath(customerId);
    const load = async () => {
      try {
        const nextCapabilities = await ApiClient.get<ProofOfAddressCapabilities>(
          `${path}/capabilities`,
          { signal: controller.signal },
        );
        if (!active) return;
        setCapabilities(nextCapabilities);
        if (!nextCapabilities.enabled) return;

        const addressRequest = canViewAddress
          ? settled(
              ApiClient.get<AddressRecord[]>(
                `/customers/${encodeURIComponent(customerId)}/addresses`,
                { signal: controller.signal },
              ),
            )
          : Promise.resolve(null);
        const [documentResult, addressResult] = await Promise.all([
          settled(
            ApiClient.get<Page<ProofOfAddressDocument>>(`${path}?page=1&limit=${PAGE_SIZE}`, {
              signal: controller.signal,
            }),
          ),
          addressRequest,
        ]);
        if (!active) return;

        if ('value' in documentResult) {
          setDocuments(documentResult.value.items);
          setDocumentPage(documentResult.value.page);
          setDocumentTotal(documentResult.value.total);
          setListLoaded(true);
        } else {
          setDocumentError(errorMessage(documentResult.error, 'Loading document records'));
        }

        if (addressResult) {
          if ('value' in addressResult) {
            const residential = addressResult.value.filter(
              (address) => address.type === 'RESIDENTIAL' && !address.deletedAt,
            );
            setAddresses(residential);
            setAddressId((current) =>
              residential.some((address) => address.id === current)
                ? current
                : (residential.find((address) => address.isPrimary)?.id ??
                  residential[0]?.id ??
                  ''),
            );
            if (residential.length === 0) {
              setAddressError('No active residential address is available for this customer.');
            }
          } else {
            setAddressError(errorMessage(addressResult.error, 'Loading residential addresses'));
          }
        }
      } catch (error) {
        if (!active) return;
        setCapabilitiesError(errorMessage(error, 'Checking Proof of Address availability'));
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();
    return () => {
      active = false;
      controller.abort();
    };
  }, [customerId, scopesKey, canViewMetadata, canViewAddress, canUpload, reloadVersion]);

  useEffect(() => {
    if (!candidateTypes.some((candidate) => candidate.type === documentType)) {
      setDocumentType(candidateTypes[0]?.type ?? '');
    }
  }, [candidateTypes, documentType]);

  useEffect(() => {
    const objectUrl = preview?.objectUrl;
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [preview?.objectUrl]);

  const refresh = () => setReloadVersion((version) => version + 1);
  const hasMoreDocuments = documentPage * PAGE_SIZE < documentTotal;
  const latestIds = latestRevisionIds(documents);
  const canShowUploadForm = canUpload && capabilities?.enabled === true;
  const maxUploadBytes = capabilities?.maxUploadBytes ?? 0;
  const fileTooLarge = Boolean(
    selectedFile && maxUploadBytes > 0 && selectedFile.size > maxUploadBytes,
  );
  const uploadUnavailableReason = !canViewAddress
    ? 'Your role must also be authorized to view a customer residential address before you can link an upload.'
    : addressError
      ? addressError
      : addresses.length === 0
        ? 'Add or restore an active residential address before uploading evidence.'
        : documentError
          ? 'Document history could not be loaded; upload remains disabled until records can be refreshed.'
          : null;
  const canSubmitUpload = Boolean(
    capabilities?.enabled &&
      canUpload &&
      canViewAddress &&
      listLoaded &&
      addresses.some((address) => address.id === addressId) &&
      selectedFile &&
      !fileTooLarge &&
      idempotencyKey &&
      !uploadBusy,
  );

  const loadMoreDocuments = async () => {
    if (loadingMore || !hasMoreDocuments) return;
    setLoadingMore(true);
    setDocumentError(null);
    const page = documentPage + 1;
    try {
      const result = await ApiClient.get<Page<ProofOfAddressDocument>>(
        `${apiPath(customerId)}?page=${page}&limit=${PAGE_SIZE}`,
      );
      if (currentCustomerId.current !== customerId) return;
      setDocuments((current) => {
        const existing = new Set(current.map(({ id }) => id));
        return [...current, ...result.items.filter((document) => !existing.has(document.id))];
      });
      setDocumentPage(result.page);
      setDocumentTotal(result.total);
    } catch (error) {
      if (currentCustomerId.current === customerId) {
        setDocumentError(errorMessage(error, 'Loading more document records'));
      }
    } finally {
      if (currentCustomerId.current === customerId) setLoadingMore(false);
    }
  };

  const uploadDocument = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmitUpload || !selectedFile || !idempotencyKey || !addressId || uploadBusy) return;
    setUploadBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      const body = new window.FormData();
      body.append('file', selectedFile, selectedFile.name);
      body.append('residentialAddressId', addressId);
      body.append('category', category);
      body.append('documentType', documentType);
      if (issuerName.trim()) body.append('issuerName', issuerName.trim());
      if (documentDate) body.append('documentDate', documentDate);
      if (replacementTarget) body.append('supersedesSubmissionId', replacementTarget.id);

      const result = await ApiClient.postForm<ProofOfAddressDocument>(apiPath(customerId), body, {
        idempotencyKey,
      });
      if (currentCustomerId.current !== customerId) return;
      setNotice(
        result.documentStatus === 'QUARANTINED'
          ? 'The upload was retained in quarantine because scanning did not return a clean result. Preview and download remain unavailable; this is not a verification or approval decision.'
          : 'The file passed the malware scan and is stored as a new submission. A clean scan does not verify or approve the evidence.',
      );
      setSelectedFile(null);
      setIdempotencyKey(null);
      setFileInputKey((key) => key + 1);
      setIssuerName('');
      setDocumentDate('');
      setReplacementTarget(null);
      refresh();
    } catch (error) {
      if (currentCustomerId.current === customerId) {
        setActionError(errorMessage(error, 'Upload'));
      }
    } finally {
      if (currentCustomerId.current === customerId) setUploadBusy(false);
    }
  };

  const chooseFile = (file: File | null) => {
    setSelectedFile(file);
    setActionError(null);
    setIdempotencyKey(null);
    if (!file) return;
    try {
      setIdempotencyKey(secureRequestKey());
    } catch (error) {
      setActionError(errorMessage(error, 'Secure upload setup'));
    }
  };

  const beginReplacement = (document: ProofOfAddressDocument) => {
    setReplacementTarget(document);
    setCategory(document.category);
    setDocumentType(document.documentType);
    setAddressId(document.residentialAddressId);
    setSelectedFile(null);
    setIdempotencyKey(null);
    setIssuerName(document.issuerName ?? '');
    setDocumentDate(document.documentDate?.slice(0, 10) ?? '');
    setFileInputKey((key) => key + 1);
    setNotice(null);
    setActionError(null);
  };

  const cancelReplacement = () => {
    setReplacementTarget(null);
    setCategory(CANDIDATE_CATEGORIES[0] ?? '');
    setIssuerName('');
    setDocumentDate('');
    setSelectedFile(null);
    setIdempotencyKey(null);
    setFileInputKey((key) => key + 1);
  };

  const loadHistory = async (documentId: string, page: number, append: boolean) => {
    setHistoryByDocument((current) => ({
      ...current,
      [documentId]: {
        items: current[documentId]?.items ?? [],
        page: current[documentId]?.page ?? 1,
        limit: current[documentId]?.limit ?? PAGE_SIZE,
        total: current[documentId]?.total ?? 0,
        visible: true,
        loading: true,
        error: null,
      },
    }));
    try {
      const result = await ApiClient.get<Page<ProofOfAddressHistoryEvent>>(
        `${apiPath(customerId)}/${encodeURIComponent(documentId)}/history?page=${page}&limit=${PAGE_SIZE}`,
      );
      if (currentCustomerId.current !== customerId) return;
      setHistoryByDocument((current) => {
        const previous = current[documentId];
        const items = append ? [...(previous?.items ?? []), ...result.items] : result.items;
        const uniqueItems = Array.from(new Map(items.map((item) => [item.id, item])).values());
        return {
          ...current,
          [documentId]: {
            items: uniqueItems,
            page: result.page,
            limit: result.limit,
            total: result.total,
            visible: true,
            loading: false,
            error: null,
          },
        };
      });
    } catch (error) {
      if (currentCustomerId.current !== customerId) return;
      setHistoryByDocument((current) => ({
        ...current,
        [documentId]: {
          items: current[documentId]?.items ?? [],
          page: current[documentId]?.page ?? 1,
          limit: current[documentId]?.limit ?? PAGE_SIZE,
          total: current[documentId]?.total ?? 0,
          visible: true,
          loading: false,
          error: errorMessage(error, 'Loading document history'),
        },
      }));
    }
  };

  const toggleHistory = (documentId: string) => {
    const existing = historyByDocument[documentId];
    if (existing?.visible) {
      setHistoryByDocument((current) => ({
        ...current,
        [documentId]: { ...existing, visible: false },
      }));
    } else if (existing?.items.length) {
      setHistoryByDocument((current) => ({
        ...current,
        [documentId]: { ...existing, visible: true },
      }));
    } else {
      void loadHistory(documentId, 1, false);
    }
  };

  const openPreview = async (document: ProofOfAddressDocument) => {
    previewRequest.current?.abort();
    const controller = new AbortController();
    previewRequest.current = controller;
    setPreviewLoadingId(document.id);
    setActionError(null);
    try {
      const blob = await ApiClient.getBlob(
        `${apiPath(customerId)}/${encodeURIComponent(document.id)}/content?disposition=inline`,
        { signal: controller.signal },
      );
      if (currentCustomerId.current !== customerId || controller.signal.aborted) return;
      const mimeType = document.detectedMimeType ?? blob.type;
      setPreview({ document, objectUrl: URL.createObjectURL(blob), mimeType });
    } catch (error) {
      if (!controller.signal.aborted && currentCustomerId.current === customerId) {
        setActionError(errorMessage(error, 'Preview'));
      }
    } finally {
      if (currentCustomerId.current === customerId) setPreviewLoadingId(null);
    }
  };

  const downloadDocument = async (document: ProofOfAddressDocument) => {
    const actionKey = `${document.id}:download`;
    setBusyAction(actionKey);
    setActionError(null);
    try {
      const blob = await ApiClient.getBlob(
        `${apiPath(customerId)}/${encodeURIComponent(document.id)}/content?disposition=attachment`,
      );
      if (currentCustomerId.current !== customerId) return;
      const objectUrl = URL.createObjectURL(blob);
      const anchor = window.document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = document.originalFileName || `proof-of-address-${document.id}`;
      anchor.rel = 'noopener noreferrer';
      anchor.style.display = 'none';
      window.document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    } catch (error) {
      if (currentCustomerId.current === customerId) {
        setActionError(errorMessage(error, 'Download'));
      }
    } finally {
      if (currentCustomerId.current === customerId) setBusyAction(null);
    }
  };

  const confirmLifecycleAction = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!pendingLifecycle || !lifecycleReason.trim() || lifecycleBusy) return;
    const { document, action } = pendingLifecycle;
    setLifecycleBusy(true);
    setLifecycleError(null);
    const path = `${apiPath(customerId)}/${encodeURIComponent(document.id)}/${action}`;
    try {
      await ApiClient.post(path, { reason: lifecycleReason.trim() });
      if (currentCustomerId.current !== customerId) return;
      setPendingLifecycle(null);
      setLifecycleReason('');
      setNotice(
        action === 'withdraw'
          ? 'The document was withdrawn. Content access is disabled and the reason is recorded in history.'
          : 'The withdrawn document was archived. Archival retains the audit record and does not delete the customer record.',
      );
      refresh();
    } catch (error) {
      if (currentCustomerId.current === customerId) {
        setLifecycleError(errorMessage(error, action === 'withdraw' ? 'Withdrawal' : 'Archive'));
      }
    } finally {
      if (currentCustomerId.current === customerId) setLifecycleBusy(false);
    }
  };

  const startLifecycleAction = (document: ProofOfAddressDocument, action: LifecycleAction) => {
    setPendingLifecycle({ document, action });
    setLifecycleReason('');
    setLifecycleError(null);
  };

  return (
    <div className="cm-proof-address-stack">
      <section className="cm-card cm-card-wide" aria-labelledby="cm-poa-title">
        <div className="cm-card-heading">
          <div>
            <p className="cm-eyebrow">DOCUMENTARY EVIDENCE</p>
            <h2 id="cm-poa-title">Proof of Address</h2>
          </div>
          <span
            className={`cm-status ${capabilities?.enabled ? 'cm-status-active' : 'cm-status-draft'}`}
          >
            {capabilities?.enabled
              ? 'Secure upload enabled'
              : !canViewMetadata
                ? 'Access restricted'
                : loading
                  ? 'Checking server status'
                  : capabilitiesError
                    ? 'Status unavailable'
                    : 'Not enabled'}
          </span>
        </div>
        <p className="cm-supporting-text">
          Proof of Address is a separate evidence record linked to a residential address. It is not
          the residential address itself and is not an identity-verification result.
        </p>

        <div className="cm-policy-notice" role="note">
          <strong>Policy-neutral candidates only.</strong> The categories and document types are
          configurable candidates, not an approved acceptance list. No freshness period, automatic
          verification, or Tier 3 eligibility rule is applied. A clean malware scan only makes the
          file available to authorized reviewers; it does not verify or approve the evidence.
        </div>

        {!canViewMetadata && (
          <p className="cm-empty-state" role="status">
            Your current role is not authorized to view Proof of Address metadata. No customer
            document records have been requested or displayed.
          </p>
        )}
        {capabilitiesError && (
          <div className="cm-error" role="alert">
            {capabilitiesError}
          </div>
        )}
        {loading && canViewMetadata && (
          <p className="cm-empty-state">Checking secure document access…</p>
        )}
        {capabilities && !capabilities.enabled && (
          <div className="cm-policy-notice cm-policy-notice-warning" role="status">
            Upload, preview, download, replacement, withdrawal, and archive actions are disabled
            because <code>POA_UPLOADS_ENABLED</code> is false on the server. No files are sent from
            this screen.
          </div>
        )}
        {capabilities?.enabled && !loading && (
          <>
            {notice && (
              <div className="cm-notice" role="status">
                {notice}
              </div>
            )}
            {actionError && (
              <div className="cm-error" role="alert">
                {actionError}
              </div>
            )}

            {canShowUploadForm && (
              <section className="cm-poa-upload-section" aria-labelledby="cm-poa-upload-heading">
                <div className="cm-table-meta">
                  <span id="cm-poa-upload-heading">
                    {replacementTarget
                      ? `Upload replacement for revision ${replacementTarget.revisionNumber}`
                      : 'Add Proof of Address evidence'}
                  </span>
                  <span>Maximum file size: {formatBytes(maxUploadBytes)}</span>
                </div>
                {replacementTarget && (
                  <div className="cm-policy-notice" role="note">
                    The replacement keeps the original residential address and candidate
                    classification. A new revision is created; previous records remain in history.
                    {canUpload && (
                      <button className="cm-text-button" type="button" onClick={cancelReplacement}>
                        Cancel replacement
                      </button>
                    )}
                  </div>
                )}
                {uploadUnavailableReason && (
                  <div className="cm-policy-notice cm-policy-notice-warning" role="status">
                    {uploadUnavailableReason}
                  </div>
                )}
                <form className="cm-poa-upload-form" onSubmit={uploadDocument}>
                  <fieldset disabled={!canUpload || Boolean(uploadUnavailableReason) || uploadBusy}>
                    <div className="cm-wizard-field-grid cm-poa-metadata-preview">
                      <label htmlFor="cm-poa-category">
                        Candidate category
                        <select
                          id="cm-poa-category"
                          value={category}
                          disabled={Boolean(replacementTarget)}
                          onChange={(event) => setCategory(event.target.value)}
                        >
                          {CANDIDATE_CATEGORIES.map((option) => (
                            <option key={option} value={option}>
                              {option.replace(/_/g, ' ')}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label htmlFor="cm-poa-document-type">
                        Candidate document type
                        <select
                          id="cm-poa-document-type"
                          value={documentType}
                          disabled={Boolean(replacementTarget)}
                          onChange={(event) => setDocumentType(event.target.value)}
                        >
                          {candidateTypes.map((candidate) => (
                            <option key={candidate.type} value={candidate.type}>
                              {candidate.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label htmlFor="cm-poa-associated-address">
                        Associated residential address
                        <select
                          id="cm-poa-associated-address"
                          value={addressId}
                          disabled={Boolean(replacementTarget)}
                          onChange={(event) => setAddressId(event.target.value)}
                          required
                        >
                          {addresses.length === 0 && (
                            <option value="">No residential address available</option>
                          )}
                          {addresses.map((address) => (
                            <option key={address.id} value={address.id}>
                              {addressLabel(address)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label htmlFor="cm-poa-document-date">
                        Document date (metadata only)
                        <input
                          id="cm-poa-document-date"
                          type="date"
                          value={documentDate}
                          onChange={(event) => setDocumentDate(event.target.value)}
                        />
                      </label>
                      <label htmlFor="cm-poa-issuer">
                        Issuer (optional)
                        <input
                          id="cm-poa-issuer"
                          type="text"
                          maxLength={200}
                          autoComplete="off"
                          value={issuerName}
                          onChange={(event) => setIssuerName(event.target.value)}
                        />
                      </label>
                      <label htmlFor="cm-poa-file">
                        Document file (PDF, JPG, JPEG, PNG)
                        <input
                          key={fileInputKey}
                          id="cm-poa-file"
                          type="file"
                          accept={FILE_ACCEPT}
                          onChange={(event) => chooseFile(event.currentTarget.files?.[0] ?? null)}
                          required
                        />
                      </label>
                    </div>
                    {fileTooLarge && (
                      <p className="cm-field-error" role="alert">
                        This file is {formatBytes(selectedFile?.size)}; the configured limit is{' '}
                        {formatBytes(maxUploadBytes)}.
                      </p>
                    )}
                    <p className="cm-muted">
                      The browser file-type filter is only a convenience. The server validates file
                      signatures, enforces the size limit, encrypts private storage, and fails
                      closed if ClamAV cannot return a clean scan.
                    </p>
                    <div className="cm-actions-row">
                      <button
                        className="cm-button cm-button-primary"
                        type="submit"
                        disabled={!canSubmitUpload || Boolean(uploadUnavailableReason)}
                      >
                        {uploadBusy
                          ? 'Uploading and scanning…'
                          : replacementTarget
                            ? 'Upload replacement'
                            : 'Upload Proof of Address'}
                      </button>
                      <span className="cm-muted">
                        Upload does not verify or approve evidence and cannot change physical
                        verification, Tier 3, or wallet status.
                      </span>
                    </div>
                  </fieldset>
                </form>
              </section>
            )}

            <div className="cm-table-meta cm-poa-history-heading">
              <span>Submission history</span>
              <span>
                {listLoaded
                  ? `${documents.length} of ${documentTotal} records`
                  : 'Records not loaded'}
              </span>
              <button
                className="cm-text-button"
                type="button"
                onClick={refresh}
                disabled={loading}
                aria-label="Refresh Proof of Address records"
              >
                Refresh
              </button>
            </div>
            {documentError && (
              <div className="cm-error" role="alert">
                {documentError}
              </div>
            )}
            {!listLoaded && !documentError && (
              <p className="cm-empty-state">Loading document records…</p>
            )}
            {listLoaded && documents.length === 0 && (
              <p className="cm-empty-state">
                No Proof of Address records are stored for this customer. This is a records query,
                not a verification or eligibility result.
              </p>
            )}
            <div className="cm-poa-document-list">
              {documents.map((document) => {
                const history = historyByDocument[document.id];
                const contentAvailable =
                  capabilities.previewAvailable &&
                  document.documentStatus === 'AVAILABLE' &&
                  document.scannerResult === 'CLEAN';
                const canReplace =
                  canUpload &&
                  isCandidateProofType(document.category, document.documentType) &&
                  latestIds.has(document.id) &&
                  !['WITHDRAWN', 'ARCHIVED', 'SUPERSEDED'].includes(document.documentStatus);
                const canWithdrawDocument =
                  canWithdraw && !['WITHDRAWN', 'ARCHIVED'].includes(document.documentStatus);
                const canArchiveDocument = canArchive && document.documentStatus === 'WITHDRAWN';

                return (
                  <article className="cm-poa-document" key={document.id}>
                    <div className="cm-poa-document-heading">
                      <div>
                        <p className="cm-eyebrow">{document.category.replace(/_/g, ' ')}</p>
                        <h3>
                          {documentTypeLabel(document)} · revision {document.revisionNumber}
                        </h3>
                        <p className="cm-secondary-line">
                          {document.originalFileName || 'File name not recorded'} ·{' '}
                          {formatBytes(document.fileSizeBytes)} · uploaded{' '}
                          {formatDate(document.uploadedAt ?? document.createdAt)}
                        </p>
                      </div>
                      <span
                        className={`cm-status ${document.documentStatus === 'AVAILABLE' ? 'cm-status-active' : ''}`}
                      >
                        {document.documentStatus.replace(/_/g, ' ')}
                      </span>
                    </div>

                    <dl className="cm-poa-document-metadata">
                      <div>
                        <dt>Residential address</dt>
                        <dd>
                          {addresses.find((address) => address.id === document.residentialAddressId)
                            ? addressLabel(
                                addresses.find(
                                  (address) => address.id === document.residentialAddressId,
                                )!,
                              )
                            : 'Address record not available to this role'}
                        </dd>
                      </div>
                      <div>
                        <dt>Document date</dt>
                        <dd>{formatDocumentDate(document.documentDate)}</dd>
                      </div>
                      <div>
                        <dt>Issuer</dt>
                        <dd>{document.issuerName || 'Not recorded'}</dd>
                      </div>
                      <div>
                        <dt>Malware scan</dt>
                        <dd>{document.scannerResult || 'Not recorded'}</dd>
                      </div>
                      <div>
                        <dt>Review metadata</dt>
                        <dd>{document.reviewStatus.replace(/_/g, ' ')}</dd>
                      </div>
                      <div>
                        <dt>Detected format</dt>
                        <dd>{document.detectedMimeType || 'Not recorded'}</dd>
                      </div>
                    </dl>

                    {document.documentStatus === 'QUARANTINED' && (
                      <p className="cm-policy-notice cm-policy-notice-warning" role="status">
                        This document is quarantined. Preview and download are unavailable until a
                        clean scan is recorded. Quarantine is not a rejection or approval decision.
                      </p>
                    )}
                    <div className="cm-actions-row cm-poa-document-actions">
                      {canDownload && contentAvailable && (
                        <>
                          <button
                            className="cm-button cm-button-secondary"
                            type="button"
                            onClick={() => void openPreview(document)}
                            disabled={previewLoadingId === document.id}
                          >
                            {previewLoadingId === document.id ? 'Opening preview…' : 'Preview'}
                          </button>
                          <button
                            className="cm-button cm-button-secondary"
                            type="button"
                            onClick={() => void downloadDocument(document)}
                            disabled={busyAction === `${document.id}:download`}
                          >
                            {busyAction === `${document.id}:download` ? 'Preparing…' : 'Download'}
                          </button>
                        </>
                      )}
                      {canReplace && (
                        <button
                          className="cm-button cm-button-secondary"
                          type="button"
                          onClick={() => beginReplacement(document)}
                          disabled={uploadBusy}
                        >
                          Replace with a new revision
                        </button>
                      )}
                      {canWithdrawDocument && (
                        <button
                          className="cm-button cm-button-danger"
                          type="button"
                          onClick={() => startLifecycleAction(document, 'withdraw')}
                        >
                          Withdraw
                        </button>
                      )}
                      {canArchiveDocument && (
                        <button
                          className="cm-button cm-button-secondary"
                          type="button"
                          onClick={() => startLifecycleAction(document, 'archive')}
                        >
                          Archive withdrawn record
                        </button>
                      )}
                      {canViewMetadata && (
                        <button
                          className="cm-text-button"
                          type="button"
                          onClick={() => toggleHistory(document.id)}
                        >
                          {history?.visible ? 'Hide history' : 'View history'}
                        </button>
                      )}
                    </div>
                    {!canDownload && contentAvailable && (
                      <p className="cm-muted">
                        Preview and download are hidden because this role has no document-content
                        permission.
                      </p>
                    )}
                    {canDownload &&
                      !contentAvailable &&
                      !['QUARANTINED', 'WITHDRAWN', 'ARCHIVED', 'SUPERSEDED'].includes(
                        document.documentStatus,
                      ) && (
                        <p className="cm-muted">
                          Content is not available for this document state.
                        </p>
                      )}

                    {history?.visible && (
                      <section
                        className="cm-poa-history-panel"
                        aria-label={`History for revision ${document.revisionNumber}`}
                      >
                        <h4>Recorded document history</h4>
                        {history.error && (
                          <p className="cm-error" role="alert">
                            {history.error}
                          </p>
                        )}
                        {history.loading && <p className="cm-muted">Loading history…</p>}
                        {!history.loading && history.items.length === 0 && !history.error && (
                          <p className="cm-muted">No history events were returned.</p>
                        )}
                        {history.items.length > 0 && (
                          <ol className="cm-poa-history-list">
                            {history.items.map((event) => (
                              <li key={event.id}>
                                <strong>{event.action.replace(/_/g, ' ')}</strong>
                                <span>
                                  {formatDate(event.createdAt)} · {event.actorRoleKey}
                                </span>
                                <span>
                                  {event.previousDocumentStatus
                                    ? `${event.previousDocumentStatus.replace(/_/g, ' ')} → `
                                    : ''}
                                  {event.newDocumentStatus?.replace(/_/g, ' ') ??
                                    'No status change'}
                                </span>
                                {event.reason && <p>{event.reason}</p>}
                              </li>
                            ))}
                          </ol>
                        )}
                        {history.page * history.limit < history.total && (
                          <button
                            className="cm-button cm-button-secondary"
                            type="button"
                            disabled={history.loading}
                            onClick={() => void loadHistory(document.id, history.page + 1, true)}
                          >
                            Load older history
                          </button>
                        )}
                      </section>
                    )}
                  </article>
                );
              })}
            </div>
            {hasMoreDocuments && (
              <div className="cm-pagination">
                <button
                  className="cm-button cm-button-secondary"
                  type="button"
                  onClick={() => void loadMoreDocuments()}
                  disabled={loadingMore}
                >
                  {loadingMore ? 'Loading…' : 'Load more records'}
                </button>
              </div>
            )}
          </>
        )}
      </section>

      <section className="cm-card cm-card-wide" aria-labelledby="cm-physical-address-title">
        <div className="cm-card-heading">
          <div>
            <p className="cm-eyebrow">IN-PERSON / PROVIDER WORKFLOW</p>
            <h2 id="cm-physical-address-title">Physical address verification</h2>
          </div>
          <span className="cm-status">Not configured</span>
        </div>
        <p className="cm-supporting-text">
          Physical verification is independent from documentary Proof of Address review. Assignment,
          visit method/date, findings, report reference, outcome, independent reviewer, and history
          will be recorded separately when the role matrix is approved.
        </p>
        <dl className="cm-detail-grid cm-physical-address-preview">
          <div>
            <dt>Officer / provider assignment</dt>
            <dd>Not configured</dd>
          </div>
          <div>
            <dt>Method and visit date</dt>
            <dd>Not recorded</dd>
          </div>
          <div>
            <dt>Findings / report reference</dt>
            <dd>Not loaded</dd>
          </div>
          <div>
            <dt>Outcome / independent approver</dt>
            <dd>Not enabled</dd>
          </div>
        </dl>
        <div className="cm-policy-notice" role="note">
          No visit assignment, findings submission, verification, rejection, or approval action is
          enabled. The proposed workflow requires an authenticated officer and a separate reviewer.
        </div>
      </section>

      {preview && (
        <div
          className="cm-modal-backdrop"
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget) setPreview(null);
          }}
        >
          <section
            className="cm-confirm-dialog cm-poa-preview-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cm-poa-preview-title"
          >
            <div className="cm-card-heading">
              <div>
                <p className="cm-eyebrow">AUTHORIZED DOCUMENT PREVIEW</p>
                <h2 id="cm-poa-preview-title">
                  {preview.document.originalFileName || 'Proof of Address document'}
                </h2>
              </div>
              <button
                className="cm-button cm-button-secondary"
                type="button"
                onClick={() => setPreview(null)}
              >
                Close preview
              </button>
            </div>
            <p className="cm-muted">
              {preview.mimeType} · preview is provided only for an available, malware-clean record.
              This does not constitute documentary approval.
            </p>
            {preview.mimeType === 'application/pdf' ? (
              <iframe
                className="cm-poa-pdf-preview"
                title={`Preview of ${preview.document.originalFileName || 'Proof of Address document'}`}
                src={preview.objectUrl}
                sandbox=""
                referrerPolicy="no-referrer"
              />
            ) : preview.mimeType === 'image/jpeg' || preview.mimeType === 'image/png' ? (
              <div className="cm-poa-image-preview-wrap">
                <img
                  className="cm-poa-image-preview"
                  src={preview.objectUrl}
                  alt={`Preview of ${preview.document.originalFileName || 'Proof of Address document'}`}
                />
              </div>
            ) : (
              <p className="cm-empty-state">
                This file format cannot be previewed in the browser. Use the authorized download
                action.
              </p>
            )}
          </section>
        </div>
      )}

      {pendingLifecycle && (
        <div className="cm-modal-backdrop" role="presentation">
          <form
            className="cm-confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cm-poa-lifecycle-title"
            onSubmit={confirmLifecycleAction}
          >
            <p className="cm-eyebrow">CONTROLLED DOCUMENT LIFECYCLE</p>
            <h2 id="cm-poa-lifecycle-title">
              {pendingLifecycle.action === 'withdraw'
                ? 'Withdraw Proof of Address'
                : 'Archive withdrawn record'}
            </h2>
            <p>
              {pendingLifecycle.action === 'withdraw'
                ? 'Withdrawal disables preview and download and records your reason. It does not change documentary approval, physical verification, Tier 3, or wallet status.'
                : 'Archival is available only after withdrawal. It preserves the audit record and does not delete the customer or document history.'}
            </p>
            <label className="cm-poa-reason-label" htmlFor="cm-poa-lifecycle-reason">
              Reason (required)
              <textarea
                id="cm-poa-lifecycle-reason"
                value={lifecycleReason}
                maxLength={1000}
                rows={4}
                onChange={(event) => setLifecycleReason(event.target.value)}
                required
              />
            </label>
            {lifecycleError && (
              <div className="cm-error" role="alert">
                {lifecycleError}
              </div>
            )}
            <div className="cm-actions-row">
              <button
                className="cm-button cm-button-secondary"
                type="button"
                disabled={lifecycleBusy}
                onClick={() => setPendingLifecycle(null)}
              >
                Cancel
              </button>
              <button
                className={
                  pendingLifecycle.action === 'withdraw'
                    ? 'cm-button cm-button-danger'
                    : 'cm-button cm-button-primary'
                }
                type="submit"
                disabled={lifecycleBusy || !lifecycleReason.trim()}
              >
                {lifecycleBusy
                  ? 'Saving…'
                  : pendingLifecycle.action === 'withdraw'
                    ? 'Confirm withdrawal'
                    : 'Confirm archive'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
