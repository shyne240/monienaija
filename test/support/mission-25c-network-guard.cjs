'use strict';
// Test-only egress guard: only IPv4/IPv6 loopback is reachable. Local Supertest and
// the explicitly addressed disposable PostgreSQL cluster are permitted; real vendor,
// SSO, DNS and other outbound network calls fail immediately.
const net = require('node:net');
const dns = require('node:dns');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loopback = (host) => host === undefined || host === null || host === '' ||
  host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '::ffff:127.0.0.1';
// Unix-socket database connections are local by definition, but the previous allowlist named one
// developer's absolute directory. Accept instead: the directory the isolated-KYC runner exported
// for this run, any run directory carrying the runner's disposable marker, and PostgreSQL's
// conventional /tmp socket. Nothing outside this machine can be named by a filesystem path.
const ISOLATED_MARKER = '.kyc-isolated-disposable-cluster';
const hasMarker = (directory) =>
  fs.existsSync(path.join(directory, ISOLATED_MARKER)) ||
  fs.existsSync(path.join(path.dirname(directory), ISOLATED_MARKER));
const allowedSocketPath = (candidate) => {
  if (typeof candidate !== 'string' || candidate === '') return true;
  const resolved = path.resolve(candidate);
  const exported = process.env.KYC_ISOLATED_TEST_SOCKET;
  if (exported && resolved.startsWith(path.resolve(exported))) return true;
  // The candidate may be the run's socket directory (pg passes the directory as `host`) or the
  // socket file itself (`<dir>/.s.PGSQL.<port>`, passed as `path`). Both are accepted only when
  // the runner's marker is present for that directory or its direct parent.
  if (hasMarker(resolved)) return true;
  const parent = path.dirname(resolved);
  if (hasMarker(parent)) return true;
  // PostgreSQL's conventional default socket location, when that is all we were given.
  return (
    parent === os.tmpdir() && /^\.s\.PGSQL\.\d+$/.test(path.basename(resolved))
  );
};
const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const a = args[0];
  const options = Array.isArray(a) ? a[0] : a;
  const host = options && typeof options === 'object' ? options.host : typeof args[1] === 'string' ? args[1] : undefined;
  const socketPath = options && typeof options === 'object' ? options.path : (typeof options === 'string' ? options : undefined);
  // A unix-socket PostgreSQL connection presents the socket *directory* as `host` (and, for some
  // clients, the socket file as `path`). Both are allowed only when the disposable-cluster
  // evidence above holds; anything else that is not loopback stays blocked.
  const hostIsDisposableSocket = typeof host === 'string' && allowedSocketPath(host);
  if ((!loopback(host) && !hostIsDisposableSocket) || !allowedSocketPath(socketPath)) {
    throw new Error('M25C_TEST_OUTBOUND_NETWORK_BLOCKED');
  }
  return originalConnect.apply(this, args);
};
const originalLookup = dns.lookup;
dns.lookup = function (hostname, ...args) {
  // Numeric wildcard is needed only for local servers binding to 0.0.0.0; it never resolves externally.
  if (loopback(hostname) || hostname === '0.0.0.0' || hostname === '::') return originalLookup.call(this, hostname, ...args);
  const callback = args[args.length - 1];
  if (typeof callback === 'function') return process.nextTick(() => callback(new Error('M25C_TEST_DNS_BLOCKED')));
  throw new Error('M25C_TEST_DNS_BLOCKED');
};
// dns.promises.lookup is a separate native implementation; wrapping callback lookup
// alone does not stop it. Block resolver/reverse APIs too, including Resolver instances.
const dnsPromises = dns.promises;
const originalPromiseLookup = dnsPromises.lookup;
dnsPromises.lookup = function (hostname, ...args) {
  if (loopback(hostname) || hostname === '0.0.0.0' || hostname === '::') {
    return originalPromiseLookup.call(this, hostname, ...args);
  }
  return Promise.reject(new Error('M25C_TEST_DNS_BLOCKED'));
};
const blockedCallbackDns = (...args) => {
  const callback = args[args.length - 1];
  if (typeof callback === 'function') return process.nextTick(() => callback(new Error('M25C_TEST_DNS_BLOCKED')));
  throw new Error('M25C_TEST_DNS_BLOCKED');
};
const blockedPromiseDns = () => Promise.reject(new Error('M25C_TEST_DNS_BLOCKED'));
for (const name of Object.keys(dns)) {
  if (/^(resolve|reverse|lookupService)/.test(name)) dns[name] = blockedCallbackDns;
}
for (const name of Object.keys(dnsPromises)) {
  if (/^(resolve|reverse|lookupService)/.test(name)) dnsPromises[name] = blockedPromiseDns;
}
for (const name of Object.getOwnPropertyNames(dns.Resolver.prototype)) {
  if (/^(resolve|reverse)/.test(name)) dns.Resolver.prototype[name] = blockedCallbackDns;
}
for (const name of Object.getOwnPropertyNames(dnsPromises.Resolver.prototype)) {
  if (/^(resolve|reverse)/.test(name)) dnsPromises.Resolver.prototype[name] = blockedPromiseDns;
}
const nativeFetch = globalThis.fetch;
if (nativeFetch) globalThis.fetch = function (resource, ...args) {
  const u = new URL(typeof resource === 'string' || resource instanceof URL ? resource : resource.url);
  if (!loopback(u.hostname)) throw new Error('M25C_TEST_FETCH_BLOCKED');
  return nativeFetch.call(this, resource, ...args);
};
