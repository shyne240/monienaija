export const CANDIDATE_PROOF_OF_ADDRESS_TYPES = [
  {
    category: 'UTILITY',
    type: 'UTILITY_BILL',
    label: 'Utility bill',
    policyApproved: false,
  },
  {
    category: 'TAX',
    type: 'TAX_ASSESSMENT',
    label: 'Tax assessment',
    policyApproved: false,
  },
  {
    category: 'BANK',
    type: 'BANK_STATEMENT',
    label: 'Bank statement',
    policyApproved: false,
  },
  {
    category: 'PUBLIC_AUTHORITY',
    type: 'PUBLIC_AUTHORITY_LETTER',
    label: 'Public-authority letter',
    policyApproved: false,
  },
] as const;

export type CandidateProofOfAddressCategory =
  (typeof CANDIDATE_PROOF_OF_ADDRESS_TYPES)[number]['category'];
export type CandidateProofOfAddressType = (typeof CANDIDATE_PROOF_OF_ADDRESS_TYPES)[number]['type'];

/**
 * Candidate upload formats only. This list does not enable uploads; storage, content
 * validation, malware scanning, size limits, and access controls require security approval.
 */
export const CANDIDATE_PROOF_OF_ADDRESS_FILE_EXTENSIONS = [
  '.pdf',
  '.jpg',
  '.jpeg',
  '.png',
] as const;

export const CANDIDATE_PROOF_OF_ADDRESS_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
] as const;

export function candidateProofTypesForCategory(category: string) {
  return CANDIDATE_PROOF_OF_ADDRESS_TYPES.filter((candidate) => candidate.category === category);
}
