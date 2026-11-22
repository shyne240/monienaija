import React, { useCallback, useEffect, useState } from 'react';
import { ApiClient } from '../../services/api-client';
import { useAuthStore } from '../../store/auth-store';
import './operational-surfaces.css';

interface CustomerClass {
  id: string;
  code: string;
  name: string;
  status: string;
  enabled: boolean;
  configurationStatus: string;
  isDefault: boolean;
  version: number;
}

/** Customer class governance catalogue surface wired into shared Admin Web navigation. */
export const CustomerClassesScreen: React.FC = () => {
  const { principal } = useAuthStore();
  const canView = Boolean(principal?.scopes.includes('customer.view'));
  const canManage = Boolean(
    principal?.scopes.includes('customer.manage_classes') && !principal.readOnlyPrincipal,
  );
  const [classes, setClasses] = useState<CustomerClass[]>([]);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const load = useCallback(async () => {
    const result = await ApiClient.get<CustomerClass[]>('/internal/customer-classes');
    setClasses(result);
    setLoaded(true);
    setError('');
  }, []);
  useEffect(() => {
    let mounted = true;
    if (canView)
      ApiClient.get<CustomerClass[]>('/internal/customer-classes')
        .then((result) => {
          if (mounted) {
            setClasses(result);
            setLoaded(true);
          }
        })
        .catch(() => {
          if (mounted) setError('Customer classes are unavailable.');
        });
    return () => {
      mounted = false;
    };
  }, [canView]);
  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canManage || busy) return;
    setBusy(true);
    setError('');
    try {
      await ApiClient.post('/internal/customer-classes', {
        code: code.trim().toUpperCase(),
        name: name.trim(),
      });
      setCode('');
      setName('');
      await load();
    } catch {
      setLoaded(false);
      setError('Creation could not be confirmed. Reload before retrying.');
    } finally {
      setBusy(false);
    }
  };
  const update = async (item: CustomerClass, changes: Record<string, unknown>) => {
    if (!canManage || busy) return;
    setBusy(true);
    setError('');
    try {
      await ApiClient.patch(`/internal/customer-classes/${encodeURIComponent(item.id)}`, {
        ...changes,
        expectedVersion: item.version,
      });
      await load();
    } catch {
      setLoaded(false);
      setError('Update could not be confirmed. Reload before retrying.');
    } finally {
      setBusy(false);
    }
  };
  if (!canView)
    return (
      <section>
        <h1>Customer classes</h1>
        <p>Customer class information is restricted.</p>
      </section>
    );
  return (
    <section className="cm-card">
      <h1>Customer classes</h1>
      <p>
        Class of service is independent of KYC tier. New custom classes start unconfigured and
        disabled.
      </p>
      {error && (
        <p role="alert">
          {error}{' '}
          <button
            type="button"
            onClick={() => load().catch(() => setError('Customer classes are unavailable.'))}
          >
            Reload
          </button>
        </p>
      )}
      {!loaded ? (
        <p>Class information unavailable or loading.</p>
      ) : (
        <ul>
          {classes.map((item) => (
            <li key={item.id}>
              <strong>
                {item.name} ({item.code})
              </strong>{' '}
              — {item.status}, {item.enabled ? 'enabled' : 'disabled'}, {item.configurationStatus}
              {item.isDefault ? ', default' : ''} (version {item.version})
              {canManage && (
                <span>
                  {' '}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      update(item, {
                        enabled: !item.enabled,
                        configurationStatus: item.enabled ? item.configurationStatus : 'CONFIGURED',
                      })
                    }
                  >
                    {item.enabled ? 'Disable' : 'Configure and enable'}
                  </button>
                  <button
                    type="button"
                    disabled={busy || item.isDefault}
                    onClick={() => update(item, { isDefault: true })}
                  >
                    Make default
                  </button>
                </span>
              )}
              {canManage && (
                <CustomerClassNameEditor
                  item={item}
                  busy={busy}
                  onSave={(name) => update(item, { name })}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {canManage && loaded && (
        <form onSubmit={create}>
          <h2>Create a class</h2>
          <label>
            Code{' '}
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              pattern="[A-Za-z0-9_]{3,80}"
              required
              maxLength={80}
            />
          </label>
          <label>
            Name{' '}
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={160}
            />
          </label>
          <button type="submit" disabled={busy}>
            Create
          </button>
        </form>
      )}
    </section>
  );
};

const CustomerClassNameEditor: React.FC<{
  item: CustomerClass;
  busy: boolean;
  onSave: (name: string) => Promise<void>;
}> = ({ item, busy, onSave }) => {
  const [name, setName] = useState(item.name);
  useEffect(() => setName(item.name), [item.id, item.name]);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void onSave(name.trim());
      }}
    >
      <label>
        Edit name for {item.code}
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={160}
          required
          disabled={busy}
        />
      </label>
      <button type="submit" disabled={busy || !name.trim() || name.trim() === item.name}>
        Save name
      </button>
    </form>
  );
};
