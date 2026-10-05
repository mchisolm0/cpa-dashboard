import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Window } from "../insights";
import type { SessionRow, ItemRow } from "../db";
import { clients } from "../model";
import { Insights, field, time } from "./insights";
import "./style.css";

type SearchResult = { sessions: SessionRow[]; total: number };
type DisplayItem = Omit<ItemRow, "pointer">;
type Detail = { session: SessionRow; items: DisplayItem[] };
async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { signal });
  const data: unknown = await response.json();
  if (!response.ok) {
    const error =
      typeof data === "object" && data !== null && "error" in data
        ? String(data.error)
        : "Request failed";
    throw new Error(error);
  }
  // Responses come from this service. Native records are guarded before indexing.
  return data as T;
}
const count = new Intl.NumberFormat("en-US");
function Record({ item }: { item: DisplayItem }) {
  const [raw, setRaw] = useState<string | null>(null),
    [error, setError] = useState("");
  async function toggle() {
    if (raw !== null) {
      setRaw(null);
      return;
    }
    try {
      const result = await get<{ record: unknown }>(
        `/api/items/${item.id}/raw`,
      );
      setRaw(JSON.stringify(result.record, null, 2));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Raw record unavailable");
    }
  }
  return (
    <div className="record">
      <pre>{item.body}</pre>
      <button className="raw-button" onClick={toggle}>
        {raw !== null
          ? "Hide raw"
          : item.bodyLength > item.body.length
            ? "Full raw record"
            : "Raw record"}
      </button>
      {error && <p role="alert">{error}</p>}
      {raw !== null && <pre className="raw">{raw}</pre>}
    </div>
  );
}
function Transcript({
  detail,
  onClose,
}: {
  detail: Detail;
  onClose: () => void;
}) {
  const results = new Map<string, DisplayItem[]>();
  const calls = new Set(
    detail.items
      .filter((i) => i.role === "tool_call")
      .map((i) => i.callId)
      .filter(Boolean),
  );
  for (const i of detail.items)
    if (i.role === "tool_result" && i.callId)
      results.set(i.callId, [...(results.get(i.callId) || []), i]);
  const s = detail.session;
  return (
    <section className="transcript" aria-label="Session transcript">
      <header className="detail-header">
        <button onClick={onClose}>Close</button>
        <h2>{field(s.title)}</h2>
      </header>
      <dl className="session-meta">
        <dt>Source</dt>
        <dd>
          {s.client} / {s.host} / {s.kind}
        </dd>
        <dt>Repo</dt>
        <dd>
          {field(s.repo || s.cwd)} {s.branch && ` / ${s.branch}`}
        </dd>
        <dt>Model</dt>
        <dd>
          {field(s.model)} / {count.format(s.tokens)} tokens
        </dd>
        <dt>Archive</dt>
        <dd>{field(s.snapshot)}</dd>
        {s.parentId && (
          <>
            <dt>Parent</dt>
            <dd>{s.parentId}</dd>
          </>
        )}
      </dl>
      <div className="messages">
        {detail.items.map((i) => {
          if (i.role === "tool_result" && calls.has(i.callId)) return null;
          if (i.role === "tool_call" || i.role === "tool_result")
            return (
              <details key={i.id} className="tool">
                <summary>
                  <time>{field(time(i.time).slice(11))}</time>
                  <span>{i.tool || "Tool result"}</span>
                  <code>{i.body.replaceAll("\n", " ").slice(0, 130)}</code>
                </summary>
                <Record item={i} />
                {i.role === "tool_call" &&
                  (results.get(i.callId) || []).map((r) => (
                    <Record key={r.id} item={r} />
                  ))}
              </details>
            );
          return (
            <article className={`message ${i.role}`} key={i.id}>
              <header>
                <strong>{i.role}</strong>
                <time>{field(time(i.time))}</time>
              </header>
              <Record item={i} />
            </article>
          );
        })}
      </div>
    </section>
  );
}
function App() {
  const [view, setView] = useState<"sessions" | "health" | "problems">(
    "sessions",
  );
  const [observationWindow, setObservationWindow] = useState<Window>("24h");
  const [filters, setFilters] = useState({
    q: "",
    client: "",
    host: "",
    model: "",
    cwd: "",
    from: "",
    to: "",
  });
  const [options, setOptions] = useState<{ hosts: string[]; models: string[] }>(
    { hosts: [], models: [] },
  );
  const [result, setResult] = useState<SearchResult>({
    sessions: [],
    total: 0,
  });
  const [selected, setSelected] = useState(0),
    [offset, setOffset] = useState(0);
  const [opened, setOpened] = useState<number | null>(() => {
      const id = Number(new URLSearchParams(location.search).get("session"));
      return Number.isSafeInteger(id) && id > 0 ? id : null;
    }),
    [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState(""),
    [detailError, setDetailError] = useState(""),
    [loading, setLoading] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const table = useRef<HTMLTableElement>(null);
  useEffect(() => {
    const abort = new AbortController();
    get<typeof options>("/api/filters", abort.signal)
      .then(setOptions)
      .catch((e) => {
        if (!abort.signal.aborted) setError(String(e));
      });
    return () => abort.abort();
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError("");
    const timer = setTimeout(() => {
      const params = new URLSearchParams({
        ...filters,
        offset: String(offset),
      });
      get<SearchResult>(`/api/search?${params}`, abort.signal)
        .then((data) => {
          setResult(data);
          setSelected(0);
        })
        .catch((e) => {
          if (!abort.signal.aborted) {
            setError(String(e));
            setResult({ sessions: [], total: 0 });
          }
        })
        .finally(() => {
          if (!abort.signal.aborted) setLoading(false);
        });
    }, 150);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [filters, offset]);
  useEffect(() => {
    if (opened === null) {
      setDetail(null);
      return;
    }
    const abort = new AbortController();
    setDetail(null);
    setDetailError("");
    get<Detail>(`/api/sessions/${opened}`, abort.signal)
      .then(setDetail)
      .catch((e) => {
        if (!abort.signal.aborted) setDetailError(String(e));
      });
    return () => abort.abort();
  }, [opened]);
  useEffect(() => {
    function key(event: KeyboardEvent) {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.matches("input,select,textarea") || target.isContentEditable)
      )
        return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const next = (
        { "1": "sessions", "2": "health", "3": "problems" } as const
      )[event.key as "1" | "2" | "3"];
      if (next) {
        event.preventDefault();
        setView(next);
      }
      if (view !== "sessions") return;
      if (event.key === "/") {
        event.preventDefault();
        searchInput.current?.focus();
      }
      if (event.key === "j" || event.key === "k") {
        event.preventDefault();
        setSelected((i) =>
          Math.max(
            0,
            Math.min(
              result.sessions.length - 1,
              i + (event.key === "j" ? 1 : -1),
            ),
          ),
        );
      }
      if (
        event.key === "Enter" &&
        !(target instanceof HTMLElement && target.closest("button,summary,a"))
      ) {
        const row = result.sessions[selected];
        if (row) {
          event.preventDefault();
          setOpened(row.id);
        }
      }
      if (event.key === "Escape") {
        setOpened(null);
        table.current
          ?.querySelector<HTMLElement>(`[data-row="${selected}"]`)
          ?.focus();
      }
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [result.sessions, selected, view]);
  useEffect(() => {
    table.current
      ?.querySelector(`[data-row="${selected}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  const update = (key: keyof typeof filters, value: string) => {
    setOffset(0);
    setFilters((f) => ({ ...f, [key]: value }));
  };
  return (
    <main>
      <header className="masthead">
        <h1>cpa-dashboard</h1>
        <nav aria-label="Views">
          {(["sessions", "health", "problems"] as const).map((v) => (
            <button
              key={v}
              aria-current={view === v ? "page" : undefined}
              onClick={() => setView(v)}
            >
              {v[0]!.toUpperCase() + v.slice(1)}
            </button>
          ))}
        </nav>
        {view !== "sessions" && (
          <select
            aria-label="Observation window"
            value={observationWindow}
            onChange={(e) => setObservationWindow(e.target.value as Window)}
          >
            {["1h", "24h", "7d"].map((w) => (
              <option key={w}>{w}</option>
            ))}
          </select>
        )}
      </header>
      {view === "sessions" ? (
        <>
          <form
            className="filters"
            onSubmit={(e) => {
              e.preventDefault();
              searchInput.current?.blur();
            }}
          >
            <input
              className="search"
              ref={searchInput}
              aria-label="Search words or quoted phrases"
              placeholder={'Search words or "a phrase"'}
              value={filters.q}
              onChange={(e) => update("q", e.target.value)}
            />
            <select
              aria-label="Client"
              value={filters.client}
              onChange={(e) => update("client", e.target.value)}
            >
              <option value="">All clients</option>
              {clients.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <select
              aria-label="Host"
              value={filters.host}
              onChange={(e) => update("host", e.target.value)}
            >
              <option value="">All hosts</option>
              {options.hosts.map((h) => (
                <option key={h}>{h}</option>
              ))}
            </select>
            <select
              aria-label="Model"
              value={filters.model}
              onChange={(e) => update("model", e.target.value)}
            >
              <option value="">All models</option>
              {options.models.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
            <input
              aria-label="Repo or working directory"
              placeholder="Repo / cwd"
              value={filters.cwd}
              onChange={(e) => update("cwd", e.target.value)}
            />
            <label>
              From{" "}
              <input
                type="date"
                value={filters.from}
                onChange={(e) => update("from", e.target.value)}
              />
            </label>
            <label>
              To{" "}
              <input
                type="date"
                value={filters.to}
                onChange={(e) => update("to", e.target.value)}
              />
            </label>
          </form>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className={`workspace ${opened !== null ? "has-detail" : ""}`}>
            <section
              className="results"
              aria-label="Search results"
              aria-busy={loading}
            >
              <div className="table-scroll">
                <table ref={table} className="sessions-table">
                  <colgroup>
                    {[14, 9, 6, 30, 18, 16, 7].map((width, i) => (
                      <col key={i} style={{ width: `${width}%` }} />
                    ))}
                  </colgroup>
                  <thead>
                    <tr>
                      {[
                        "Time",
                        "Client",
                        "Host",
                        "Title",
                        "Repo / branch",
                        "Model",
                        "Tokens",
                      ].map((h) => (
                        <th key={h} title={h}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.sessions.map((s, i) => (
                      <tr
                        key={s.id}
                        data-row={i}
                        tabIndex={selected === i ? 0 : -1}
                        aria-selected={selected === i}
                        onFocus={() => setSelected(i)}
                        onClick={() => {
                          setSelected(i);
                          setOpened(s.id);
                        }}
                      >
                        <td className="numeric" title={time(s.updated)}>
                          {field(time(s.updated))}
                        </td>
                        <td title={s.client}>{field(s.client)}</td>
                        <td title={s.host}>{field(s.host)}</td>
                        <td className="title" title={s.title}>
                          <button onClick={() => setOpened(s.id)}>
                            {field(s.title)}
                          </button>
                        </td>
                        <td
                          title={`${s.repo || s.cwd}${s.branch ? ` / ${s.branch}` : ""}`}
                        >
                          {s.cwd.split("/").filter(Boolean).at(-1) ||
                            s.repo ||
                            field("")}
                          {s.branch && (
                            <span className="branch"> / {s.branch}</span>
                          )}
                        </td>
                        <td title={s.model}>{field(s.model)}</td>
                        <td
                          className="numeric right"
                          title={`${s.tokens} tokens`}
                        >
                          {count.format(s.tokens)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!loading && result.sessions.length === 0 && !error && (
                <p className="empty">
                  No sessions match. Clear a filter or try another search.
                </p>
              )}
              <footer>
                <span aria-live="polite">
                  {loading
                    ? "Searching…"
                    : `${count.format(result.total)} sessions`}{" "}
                  / UTC
                </span>
                <div>
                  <button
                    disabled={offset === 0 || loading}
                    onClick={() => setOffset((i) => Math.max(0, i - 100))}
                  >
                    Previous
                  </button>
                  <span>
                    {result.total
                      ? `${offset + 1}-${offset + result.sessions.length}`
                      : "0"}
                  </span>
                  <button
                    disabled={offset + 100 >= result.total || loading}
                    onClick={() => setOffset((i) => i + 100)}
                  >
                    Next
                  </button>
                </div>
              </footer>
            </section>
            {opened !== null &&
              (detail ? (
                <Transcript
                  key={detail.session.id}
                  detail={detail}
                  onClose={() => setOpened(null)}
                />
              ) : (
                <section className="transcript">
                  <button onClick={() => setOpened(null)}>Close</button>
                  <p role={detailError ? "alert" : "status"}>
                    {detailError || "Loading session…"}
                  </p>
                </section>
              ))}
          </div>
        </>
      ) : (
        <Insights
          view={view}
          window={observationWindow}
          onSession={(id) => {
            setOpened(id);
            setView("sessions");
          }}
        />
      )}
      <footer className="shortcuts">
        1 Sessions · 2 Health · 3 Problems · / search · j k select · Enter open
        · Esc close
      </footer>
    </main>
  );
}
const root = document.getElementById("root");
if (!root) throw new Error("Missing app root");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
