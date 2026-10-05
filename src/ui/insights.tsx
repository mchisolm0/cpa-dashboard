import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { Health, Problem, Window, aggregate } from "../insights";
import type { AuthState } from "../auth";
import { object, string } from "../model";

export const field = (value: ReactNode) =>
  value === "" || value === null || value === undefined ? (
    <span className="dim">-</span>
  ) : (
    value
  );
export const time = (value: number) =>
  value ? new Date(value).toISOString().replace("T", " ").slice(0, 16) : "";
const absolute = (value: number) =>
  value ? new Date(value).toISOString() : "-";
function relative(value: number, now: number) {
  if (!value) return "";
  const seconds = Math.round(Math.abs(now - value) / 1000);
  const age =
    seconds < 60
      ? `${seconds}s`
      : seconds < 3600
        ? `${Math.floor(seconds / 60)}m`
        : seconds < 86400
          ? `${Math.floor(seconds / 3600)}h`
          : `${Math.floor(seconds / 86400)}d`;
  return value > now ? `in ${age}` : `${age} ago`;
}
const count = new Intl.NumberFormat("en-US");
type Stats = ReturnType<typeof aggregate>;
function errorSummary(stats: Stats) {
  return Object.entries(stats.errorCounts)
    .map(
      ([category, n]) =>
        `${category}: ${n} error records, ${stats.usageErrorCounts[category as keyof typeof stats.usageErrorCounts]} failed usage records`,
    )
    .join("\n");
}
function Metrics({ stats }: { stats: Stats }) {
  const pair = (values: { p50: number | null; p95: number | null }) => (
    <>
      {field(values.p50 === null ? null : count.format(values.p50))}
      <span className="dim"> / </span>
      {field(values.p95 === null ? null : count.format(values.p95))}
    </>
  );
  const percentileTitle = (values: {
    p50: number | null;
    p95: number | null;
  }) => `p50: ${values.p50 ?? "-"} ms; p95: ${values.p95 ?? "-"} ms`;
  return (
    <>
      <td
        className="numeric right"
        title={`${stats.requests} upstream usage records`}
      >
        {count.format(stats.requests)}
      </td>
      <td
        className="numeric right"
        title={`${stats.failures} failed / ${stats.requests} upstream usage records`}
      >
        {field(
          stats.failureRate === null
            ? null
            : `${(stats.failureRate * 100).toFixed(1)}%`,
        )}
      </td>
      <td className="numeric" title={percentileTitle(stats.latency)}>
        {pair(stats.latency)}
      </td>
      <td className="numeric" title={percentileTitle(stats.ttft)}>
        {pair(stats.ttft)}
      </td>
      <td className="numeric right" title={`${stats.tokens} tokens`}>
        {count.format(stats.tokens)}
      </td>
      <td
        className="numeric"
        title={`Websocket: ${stats.websocket}; HTTP: ${stats.http}; unknown: ${stats.unknown}`}
      >
        {stats.websocket} / {stats.http} / {stats.unknown}
      </td>
      <td className="error-counts" title={errorSummary(stats)}>
        {Object.entries(stats.errorCounts).map(([category, n]) => {
          const usage =
            stats.usageErrorCounts[
              category as keyof typeof stats.usageErrorCounts
            ];
          return n || usage ? (
            <span key={category} className={`kind-${category}`}>
              {category} {n}/{usage}{" "}
            </span>
          ) : null;
        })}
        {Object.values(stats.errorCounts).every((n) => !n) &&
          Object.values(stats.usageErrorCounts).every((n) => !n) &&
          field("")}
      </td>
    </>
  );
}
function authKind(state: AuthState) {
  if (state.disabled || state.status === "removed") return "auth";
  const reason =
    `${state.message} ${state.cooldowns?.map((c) => c.reason).join(" ")}`.toLowerCase();
  if (/quota|rate_limit|payment/.test(reason)) return "quota";
  if (/unauthorized|invalid_grant|expired|credential/.test(reason))
    return "auth";
  if (/transport|connection|timeout/.test(reason)) return "transport";
  return state.unavailable || state.status === "error" ? "upstream" : "";
}
function healthRows(data: Health) {
  return data.providers.flatMap((provider) => [
    {
      key: JSON.stringify([provider.provider]),
      provider: provider.provider,
      credential: null,
      stats: provider,
    },
    ...provider.credentials.map((credential) => ({
      key: JSON.stringify([provider.provider, credential.authIndex]),
      provider: provider.provider,
      credential,
      stats: credential,
    })),
  ]);
}
type HealthRow = ReturnType<typeof healthRows>[number];
function HealthTable({
  data,
  rows,
  selected,
  onSelect,
  onOpen,
}: {
  data: Health;
  rows: HealthRow[];
  selected: number;
  onSelect: (index: number) => void;
  onOpen: (key: string) => void;
}) {
  return (
    <div className="table-scroll">
      <table className="health-table">
        <colgroup>
          {[15, 13, 12, 8, 6, 6, 8, 8, 7, 7, 10].map((width, i) => (
            <col key={i} style={{ width: `${width}%` }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th>Provider / credential</th>
            <th title="Auth status and message. Enter opens the full state.">
              Auth
            </th>
            <th title="Quota signals, model quotas and scheduler cooldowns. Enter opens the full state.">
              Quota
            </th>
            <th title="Latest auth observation; observations older than two minutes are stale. Hover for retry, refresh and observed UTC times.">
              Observed
            </th>
            <th title="Requests count upstream usage records, including retries and additional-model usage.">
              Requests
            </th>
            <th title="Failure rate counts failed upstream usage records.">
              Failed
            </th>
            <th title="Latency p50 / p95 in milliseconds, nearest-rank percentiles.">
              Latency ms
            </th>
            <th title="Time to first token p50 / p95 in milliseconds. Zero TTFT is excluded.">
              TTFT ms
            </th>
            <th title="Tokens prefer the v2 canonical total.">Tokens</th>
            <th title="Websocket / HTTP / unknown transport counts.">
              WS / HTTP / ?
            </th>
            <th title="Error records / failed usage records by class. These counts remain separate because they cannot reliably be deduplicated. Hover for every class; Enter opens details.">
              Errors / usage
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const credential = row.credential,
              state = credential?.state;
            const summary =
              "authSummary" in row.stats
                ? Object.entries(row.stats.authSummary)
                    .map(([status, n]) => `${n} ${status}`)
                    .join(" / ")
                : "";
            const status = state
              ? [
                  state.status,
                  state.disabled ? "disabled" : "",
                  state.unavailable ? "unavailable" : "",
                ]
                  .filter(Boolean)
                  .join(" / ")
              : summary;
            const quota = state
              ? Object.entries(object(state.quota.signals))
                  .map(([k, v]) => `${k}=${string(v)}`)
                  .join(" ") || state.cooldowns?.map((c) => c.reason).join(", ")
              : "";
            const retry = state
              ? Math.max(
                  state.nextRetry,
                  ...(state.cooldowns?.map((c) => c.retryAt) || []),
                )
              : 0;
            const name = credential
              ? state?.name || credential.authIndex
              : row.provider;
            return (
              <tr
                key={row.key}
                className={credential ? "" : "provider-row"}
                data-insight-row={i}
                tabIndex={selected === i ? 0 : -1}
                aria-selected={selected === i}
                onFocus={() => onSelect(i)}
                onClick={() => {
                  onSelect(i);
                  onOpen(row.key);
                }}
              >
                <th
                  scope="row"
                  className={credential ? "credential" : ""}
                  title={`${row.provider}${credential ? ` / ${name}\nAuth index: ${credential.authIndex || "-"}` : ""}`}
                >
                  <button onClick={() => onOpen(row.key)}>{field(name)}</button>
                </th>
                <td
                  className={state ? `kind-${authKind(state)}` : ""}
                  title={[status, state?.message].filter(Boolean).join("\n")}
                >
                  {field(status)}
                </td>
                <td
                  title={
                    state
                      ? JSON.stringify(
                          {
                            quota: state.quota,
                            model_quotas: state.modelQuotas,
                            cooldowns: state.cooldowns,
                          },
                          null,
                          2,
                        )
                      : ""
                  }
                >
                  {field(quota)}
                </td>
                <td
                  className={`numeric ${credential?.observed && data.now - credential.observed > 120000 ? "kind-transport" : "dim"}`}
                  title={`Retry UTC: ${absolute(retry)}\nRefresh UTC: ${absolute(state?.lastRefresh || 0)}\nObserved UTC: ${absolute(credential?.observed || 0)}\nObservations older than two minutes are stale.`}
                >
                  {field(relative(credential?.observed || 0, data.now))}
                </td>
                <Metrics stats={row.stats} />
              </tr>
            );
          })}
        </tbody>
      </table>
      {!rows.length && <p className="empty">No auth or usage observations.</p>}
    </div>
  );
}
const outcomeTitle = (r: Problem) =>
  `Retried: ${r.retriedAttempts}\nInferred final: ${r.inferredFinalFailures}\nUnresolved: ${r.unresolvedAttempts}\nUncorrelated error attempts: ${r.attemptErrors}`;
export function ProblemDetails({
  problem,
  onClose,
  onSession,
}: {
  problem: Problem;
  onClose: () => void;
  onSession: (id: number) => void;
}) {
  return (
    <section className="transcript" aria-label="Problem details">
      <header className="detail-header">
        <h2
          className={`kind-${problem.category}`}
          title={`${problem.category} / ${problem.source} / ${problem.code}`}
        >
          {problem.category} / {problem.source} / {field(problem.code)}
        </h2>
        <button onClick={onClose}>Close</button>
      </header>
      <p>{problem.fix}</p>
      <dl className="problem-meta">
        <dt>Provider / model</dt>
        <dd>
          {field(problem.provider)} / {field(problem.model)}
        </dd>
        <dt>Outcomes R/F/U/A</dt>
        <dd title={outcomeTitle(problem)}>
          {problem.retriedAttempts} / {problem.inferredFinalFailures} /{" "}
          {problem.unresolvedAttempts} / {problem.attemptErrors}
        </dd>
        <dt>First / last UTC</dt>
        <dd>
          {absolute(problem.firstSeen)} / {absolute(problem.lastSeen)}
        </dd>
        <dt>Count / sessions</dt>
        <dd>
          {problem.count} / {problem.sessionCount}
          {problem.unindexedSessionCount > 0 &&
            ` + ${problem.unindexedSessionCount} unindexed`}
        </dd>
      </dl>
      <div className="session-links">
        {problem.sessions.map((s) => (
          <a
            key={s.id}
            href={`/?session=${s.id}`}
            onClick={(e) => {
              e.preventDefault();
              onSession(s.id);
            }}
          >
            {field(s.title || s.nativeId)} / {s.host}
          </a>
        ))}
        {problem.sessionCount > problem.sessions.length && (
          <span>+{problem.sessionCount - problem.sessions.length} more</span>
        )}
      </div>
      {problem.examples.map((example, i) => (
        <article className="message" key={i}>
          <header>
            <time title={absolute(example.time)}>
              {time(example.time)}
            </time>
            <span>{example.outcome.replaceAll("_", " ")}</span>
          </header>
          <pre className="raw">
            {JSON.stringify(example.payload, null, 2)}
          </pre>
        </article>
      ))}
    </section>
  );
}
export function Insights({
  view,
  window,
  onSession,
}: {
  view: "health" | "problems";
  window: Window;
  onSession: (id: number) => void;
}) {
  const [data, setData] = useState<Health | null>(null),
    [rows, setRows] = useState<Problem[]>([]);
  const [error, setError] = useState(""),
    [selected, setSelected] = useState(0),
    [opened, setOpened] = useState<string | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    setData(null);
    setRows([]);
    setSelected(0);
    setOpened(null);
    const load = async () => {
      try {
        const response = await fetch(`/api/${view}?window=${window}`, {
          signal: abort.signal,
        });
        if (!response.ok) throw new Error("Observations unavailable");
        const value: unknown = await response.json();
        if (!abort.signal.aborted) {
          if (view === "health") setData(value as Health);
          else setRows((value as { problems: Problem[] }).problems);
          setError("");
        }
      } catch {
        if (!abort.signal.aborted) setError("Observations unavailable");
      }
    };
    void load();
    const timer = setInterval(() => void load(), 60000);
    return () => {
      abort.abort();
      clearInterval(timer);
    };
  }, [view, window]);
  const credentials = data ? healthRows(data) : [];
  const keys =
    view === "health" ? credentials.map((r) => r.key) : rows.map((r) => r.key);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        (event.target instanceof HTMLElement &&
          (event.target.matches("input,textarea,select") ||
            event.target.isContentEditable))
      )
        return;
      if (event.key === "j" || event.key === "k") {
        event.preventDefault();
        const next = Math.max(
          0,
          Math.min(keys.length - 1, selected + (event.key === "j" ? 1 : -1)),
        );
        setSelected(next);
        document
          .querySelector<HTMLElement>(`[data-insight-row="${next}"]`)
          ?.focus({ preventScroll: true });
      }
      if (
        event.key === "Enter" &&
        !(
          event.target instanceof HTMLElement &&
          event.target.closest("button,a")
        )
      ) {
        event.preventDefault();
        setOpened(keys[selected] || null);
      }
      if (event.key === "Escape") {
        setOpened(null);
        document
          .querySelector<HTMLElement>(`[data-insight-row="${selected}"]`)
          ?.focus();
      }
    };
    globalThis.window.addEventListener("keydown", key);
    return () => globalThis.window.removeEventListener("keydown", key);
  }, [keys, selected]);
  useEffect(() => {
    document
      .querySelector(`[data-insight-row="${selected}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  const problem = rows.find((r) => r.key === opened),
    credential = credentials.find((r) => r.key === opened);
  return (
    <>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div
        className={`workspace insights-workspace ${problem || credential ? "has-detail" : ""}`}
      >
        <section
          className="results"
          aria-label={view === "health" ? "Health" : "Problems"}
        >
          {view === "health" ? (
            data && (
              <HealthTable
                data={data}
                rows={credentials}
                selected={selected}
                onSelect={setSelected}
                onOpen={setOpened}
              />
            )
          ) : (
            <div className="table-scroll">
              <table className="problems-table">
                <colgroup>
                  {[3, 10, 18, 9, 25, 5, 14, 6, 10].map((width, i) => (
                    <col key={i} style={{ width: `${width}%` }} />
                  ))}
                </colgroup>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Source</th>
                    <th title="Provider / model">Provider / model</th>
                    <th>Class</th>
                    <th>Issue</th>
                    <th className="right">Count</th>
                    <th title="Retried / inferred final / unresolved / uncorrelated error attempts. Final is inferred after at least 60s and the retry window plus 5s without a later request outcome. Error records are uncorrelated attempts.">
                      Outcomes R/F/U/A
                    </th>
                    <th
                      className="right"
                      title="Indexed sessions plus unmatched raw session IDs; matching archive links appear in details."
                    >
                      Sessions
                    </th>
                    <th title="Relative last occurrence. Hover for first and last absolute UTC timestamps.">
                      Last seen
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const issue =
                      r.source === "friction" || r.source === "sandpaper"
                        ? string(object(r.examples[0]?.payload).expected)
                        : r.code;
                    return (
                      <tr
                        key={r.key}
                        data-insight-row={i}
                        tabIndex={selected === i ? 0 : -1}
                        aria-selected={selected === i}
                        onFocus={() => setSelected(i)}
                        onClick={() => {
                          setSelected(i);
                          setOpened(r.key);
                        }}
                      >
                        <td className="numeric dim">{i + 1}</td>
                        <td title={r.source}>{field(r.source)}</td>
                        <td
                          title={`Provider: ${r.provider || "-"}\nModel: ${r.model || "-"}`}
                        >
                          {field(r.provider)}
                          <span className="dim"> / </span>
                          {field(r.model)}
                        </td>
                        <td className={`kind-${r.category}`} title={r.category}>
                          {r.category}
                        </td>
                        <td title={issue}>
                          <button onClick={() => setOpened(r.key)}>
                            {field(issue)}
                          </button>
                        </td>
                        <td
                          className="numeric right"
                          title={`${r.count} occurrences`}
                        >
                          {r.count}
                        </td>
                        <td className="numeric" title={outcomeTitle(r)}>
                          {r.retriedAttempts} / {r.inferredFinalFailures} /{" "}
                          {r.unresolvedAttempts} / {r.attemptErrors}
                        </td>
                        <td
                          className="numeric right"
                          title={`${r.sessionCount} indexed + ${r.unindexedSessionCount} unindexed sessions`}
                        >
                          {r.affectedSessions}
                        </td>
                        <td
                          className="numeric"
                          title={`First UTC: ${absolute(r.firstSeen)}\nLast UTC: ${absolute(r.lastSeen)}`}
                        >
                          {field(relative(r.lastSeen, Date.now()))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!rows.length && !error && (
                <p className="empty">No problems in this window.</p>
              )}
            </div>
          )}
        </section>
        {problem && (
          <ProblemDetails
            problem={problem}
            onClose={() => setOpened(null)}
            onSession={onSession}
          />
        )}
        {credential && (
          <section className="transcript" aria-label="Health details">
            <header className="detail-header">
              <h2>
                {credential.provider}
                {credential.credential &&
                  ` / ${credential.credential.state?.name || credential.credential.authIndex || "-"}`}
              </h2>
              <button onClick={() => setOpened(null)}>Close</button>
            </header>
            <pre className="health-errors">
              {errorSummary(credential.stats)}
            </pre>
            <pre className="raw">
              {JSON.stringify(credential.stats, null, 2)}
            </pre>
          </section>
        )}
      </div>
    </>
  );
}
