export interface PrivateProofOfAddressStorage {
  /** Store an already application-encrypted object under a server-generated opaque key. */
  put(objectKey: string, encryptedBytes: Buffer): Promise<void>;
  /** Return the encrypted object. Callers must decrypt only after authorization. */
  get(objectKey: string): Promise<Buffer>;
  /** Used only to clean up an unreferenced object when its database transaction fails. */
  remove(objectKey: string): Promise<void>;
}

export function assertOpaqueProofOfAddressObjectKey(objectKey: string): void {
  if (!/^[a-f0-9]{64}$/.test(objectKey)) {
    throw new Error('Invalid internal Proof of Address object key');
  }
}
