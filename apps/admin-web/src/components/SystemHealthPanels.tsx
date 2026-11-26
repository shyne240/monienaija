import React from 'react';
import type {
  AttentionItem,
  HealthComponent,
  UnavailableSource,
} from './system-health-types';
import { stamp } from './system-health-types';

/**
 * The "components checked" table ARENA 6 added to System Health.
 *
 * A health panel that only prints `status: degraded` answers nothing. An operator needs three things
 * for every signal, and this table is built around exactly those three: **what** was checked, **what
 * the state means**, and **when** it was checked. The fourth column — read availability — exists
 * because the first three are meaningless when nothing was measured: a component whose probe could
 * not run is reported as `UNAVAILABLE` with the reason, and is rendered nowhere near "ok".
 *
 * The rows come from the diagnostics service, which is the only authority for them; nothing here
 * computes, infers or back-fills a state.
 */
export const HealthComponentsTable: React.FC<{
  components: HealthComponent[];
  /** The report-level timestamp, shown so the assembled payload is not mistaken for a single probe time. */
  reportTimestamp?: string;
}> = ({ components, reportTimestamp }) => (
  <table className="health-redesign__table" data-testid="health-components-table">
    <caption className="health-redesign__sub">
      {components.length} component check(s) in this response
      {reportTimestamp ? ` · report assembled ${stamp(reportTimestamp)}` : ''}. Each row carries the
      time its own probe ran.
    </caption>
    <thead>
      <tr>
        <th scope="col">Component</th>
        <th scope="col">State</th>
        <th scope="col">Read availability</th>
        <th scope="col">What this state means</th>
        <th scope="col">Reported</th>
        <th scope="col">Checked at</th>
      </tr>
    </thead>
    <tbody>
      {components.map((component) => (
        <tr key={component.key} data-testid={`health-component-${component.key}`}>
          <th scope="row">{component.label}</th>
          <td>
            <span className={`health-redesign__chip health-redesign__chip--${component.state}`}>
              {component.state}
            </span>
          </td>
          <td>
            <span
              className={`health-redesign__chip health-redesign__chip--${
                component.availability === 'CHECKED' ? 'ok' : 'unknown'
              }`}
              data-testid={`health-component-${component.key}-availability`}
            >
              {component.availability}
            </span>
            {component.reason ? (
              <span className="health-redesign__sub">{component.reason}</span>
            ) : null}
          </td>
          <td>{component.meaning}</td>
          <td>
            {Object.keys(component.detail ?? {}).length === 0 ? (
              <span className="health-redesign__sub">no values reported</span>
            ) : (
              Object.entries(component.detail ?? {}).map(([name, value]) => (
                <span key={name} className="health-redesign__detail-pair">
                  {name}=<code>{String(value)}</code>
                </span>
              ))
            )}
          </td>
          <td>
            <span className="health-redesign__sub" data-testid={`health-component-${component.key}-checked-at`}>
              {stamp(component.checkedAt)}
            </span>
            <span className="health-redesign__sub">via {component.source}</span>
          </td>
        </tr>
      ))}
    </tbody>
  </table>
);

/**
 * Source availability and attention items, composed from the operations centre and the operational
 * metrics snapshot.
 *
 * Both sources already state their own `unavailable` lists; this component merges them for reading
 * only, labels which read produced each entry, and — the part that matters — refuses to let an
 * unreadable source disappear. A panel that lists no problems because no probe ran looks identical
 * to a healthy system unless the difference is written out, so it is written out here.
 */
export const HealthSourceAvailability: React.FC<{
  clear: boolean;
  partial: boolean;
  generatedAt: string;
  scope?: string;
  items: AttentionItem[];
  unavailable: UnavailableSource[];
  metricsUnavailable: Array<{ signal: string; reason: string }>;
  metricsGeneratedAt: string | null;
  metricsUnreadable: boolean;
  centreUnreadable: boolean;
  onOpenNotificationOperations?: () => void;
}> = ({
  clear,
  partial,
  generatedAt,
  scope,
  items,
  unavailable,
  metricsUnavailable,
  metricsGeneratedAt,
  metricsUnreadable,
  centreUnreadable,
  onOpenNotificationOperations,
}) => {
  const mergedCount = unavailable.length + metricsUnavailable.length;
  const notificationsMentioned =
    items.some((item) => item.area === 'NOTIFICATIONS') ||
    unavailable.some((entry) => entry.area === 'NOTIFICATIONS');
  return (
    <>
      <p
        className="health-redesign__verdict"
        data-testid="health-centre-verdict"
        data-clear={clear ? 'true' : 'false'}
        data-partial={partial ? 'true' : 'false'}
      >
        <strong>
          {centreUnreadable
            ? 'UNKNOWN — the operations centre view could not be read'
            : partial
              ? 'PARTIAL — at least one source could not be read'
              : clear
                ? 'CLEAR — every source consulted was read, and nothing needs attention'
                : 'ATTENTION — findings were raised by the sources consulted'}
        </strong>
        <span className="health-redesign__sub">
          {centreUnreadable
            ? 'No ranking or availability statement is available from this read. Absence of findings here is not a clean bill of health.'
            : `Computed ${stamp(generatedAt)}${scope ? ` · ${scope}` : ''}`}
        </span>
      </p>

      <h3>Sources that could not be read</h3>
      {mergedCount === 0 ? (
        <p className="health-redesign__state" data-testid="health-no-unavailable-sources">
          {metricsUnreadable
            ? 'The operations centre reported no unreadable source, but the metrics snapshot could not be read, so availability is only partly known.'
            : 'Every source consulted by these reads answered. This describes this refresh, not a permanent condition.'}
        </p>
      ) : (
        <ul className="health-redesign__unavailable" data-testid="health-unavailable-sources">
          {unavailable.map((entry) => (
            <li key={`centre:${entry.area}:${entry.reason}`}>
              <strong>{entry.area}</strong>
              <span>{entry.reason}</span>
              <span className="health-redesign__sub">
                named by {entry.source} · checked {stamp(entry.checkedAt)}
              </span>
            </li>
          ))}
          {metricsUnavailable.map((entry) => (
            <li key={`metrics:${entry.signal}:${entry.reason}`}>
              <strong>{entry.signal}</strong>
              <span>{entry.reason}</span>
              <span className="health-redesign__sub">
                named by the metrics snapshot (/internal/operational-metrics) · checked{' '}
                {stamp(metricsGeneratedAt)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <h3>Items needing attention</h3>
      {items.length === 0 ? (
        <p className="health-redesign__state" data-testid="health-no-attention-items">
          {centreUnreadable || partial
            ? 'No findings are listed and at least one source was unreadable — this is not a measured all-clear.'
            : 'Measured and clear: no attention item was raised by the sources consulted.'}
        </p>
      ) : (
        <table className="health-redesign__table" data-testid="health-attention-items">
          <thead>
            <tr>
              <th scope="col">Area</th>
              <th scope="col">Urgency</th>
              <th scope="col">Severity</th>
              <th scope="col">Finding</th>
              <th scope="col">Context</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} data-testid={`health-attention-${item.area}`}>
                <td>{item.area}</td>
                <td>{item.urgency}</td>
                <td>{item.severity}</td>
                <td>{item.summary}</td>
                <td>
                  {item.context
                    ? Object.entries(item.context).map(([name, value]) => (
                        <span key={name} className="health-redesign__detail-pair">
                          {name}=<code>{String(value)}</code>
                        </span>
                      ))
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {notificationsMentioned && onOpenNotificationOperations ? (
        <button
          type="button"
          className="health-redesign__link"
          data-testid="health-open-notification-operations"
          onClick={onOpenNotificationOperations}
        >
          Investigate notification deliveries →
        </button>
      ) : null}
    </>
  );
};
