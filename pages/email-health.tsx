import MetricCard from "@/components/ui/MetricCard";
import { chartColors } from "@/lib/ui/brand";
import PageHeader, { PageTitle, PageDescription } from "@/components/ui/PageHeader";
import Head from "next/head";
import { useEffect, useState, useCallback } from "react";
import { RiMailLine, RiRefreshLine, RiShieldCheckLine, RiAlertLine } from "react-icons/ri";

interface DayData { day: string; sent: number; limit: number; }
interface AccountRow {
  id: string; name: string; from_email: string;
  daily_email_limit: number; ramp_up_enabled: number; ramp_start_date: string | null;
  effective_limit_today: number; sent_today: number;
  days: DayData[];
}
interface LogEntry { created_at: string; message: string; email_account_id: string; }
interface GuardEntry { created_at: string; message: string; email_account_id: string | null; }

interface Data {
  accounts: AccountRow[];
  days: string[];
  recentLogs: LogEntry[];
  guardTrips: GuardEntry[];
}

const TZ = "Europe/Berlin";

function formatDay(d: string) {
  return new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { month: "short", day: "numeric", timeZone: TZ });
}

function formatTime(ts: string) {
  return new Date(ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: TZ });
}

function formatDateTime(ts: string) {
  const d = new Date(ts);
  return d.toLocaleDateString("en-GB", { month: "short", day: "numeric", timeZone: TZ }) + " " +
    d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
}

export default function EmailHealth() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/email-health")
      .then(r => r.json())
      .then(d => { setData(d); setLastRefresh(new Date()); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh every 60s
  useEffect(() => {
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  const today = new Date().toISOString().slice(0, 10);

  const totalToday = data?.accounts.reduce((s, a) => s + a.sent_today, 0) ?? 0;
  const totalLimit = data?.accounts.reduce((s, a) => s + a.effective_limit_today, 0) ?? 0;
  const overLimit = data?.accounts.filter(a => a.sent_today > a.effective_limit_today) ?? [];

  return (
    <>
      <Head><title>Email Health — MoonSys LinkedIn</title></Head>
      <div className="p-8 max-w-7xl">

        {/* Header */}
        <PageHeader className="flex items-center justify-between mb-8">
          <div>
            <PageTitle className="text-xl font-semibold text-base-content">Email Health</PageTitle>
            <PageDescription className="text-sm text-muted mt-0.5">Daily send volume per account vs ramp limits</PageDescription>
          </div>
          <div className="flex items-center gap-3">
            {lastRefresh && (
              <span className="text-xs text-muted">
                Updated {formatTime(lastRefresh.toISOString())}
              </span>
            )}
            <button
              onClick={load}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-base-300 text-base-content/70 hover:text-base-content border border-base-300/50 hover:bg-base-300/80 transition-colors"
            >
              <RiRefreshLine size={13} className={loading ? "animate-spin" : ""} />
              Refresh
            </button>
          </div>
        </PageHeader>

        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-8">
          <MetricCard label="Sent today" value={totalToday} color={chartColors.emails} />
          <MetricCard label="Total limit today" value={totalLimit} color={chartColors.neutral} />
          <MetricCard label="Accounts active" value={data?.accounts.filter(account => account.sent_today > 0).length ?? 0} color={chartColors.visits} />
          <MetricCard label={overLimit.length > 0 ? "Over limit today" : "Accounts over limit"} value={overLimit.length}
            description={overLimit.length > 0 ? "Review account limits below" : "All accounts within limits"}
            color={overLimit.length > 0 ? "var(--color-error)" : chartColors.connections}
            icon={overLimit.length > 0 ? <RiAlertLine size={16} /> : <RiShieldCheckLine size={16} />} />
        </div>

        {/* Per-account table */}
        <div className="bg-base-200 rounded-xl border border-base-300/50 mb-8 overflow-hidden">
          <div className="px-5 py-3 border-b border-base-300/40 flex items-center gap-2">
            <RiMailLine size={14} className="text-muted" />
            <span className="text-sm font-medium text-base-content">Accounts — last 7 days</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-base-300/30">
                  <th className="text-left px-5 py-2.5 text-xs font-medium text-muted whitespace-nowrap">Account</th>
                  <th className="text-right px-4 py-2.5 text-xs font-medium text-muted whitespace-nowrap">
                    Today<br/>
                    <span className="text-muted font-normal">{formatDay(today)}</span>
                  </th>
                  {data?.days.slice(0, -1).reverse().map(d => (
                    <th key={d} className="text-right px-4 py-2.5 text-xs font-medium text-muted whitespace-nowrap">
                      {formatDay(d)}
                    </th>
                  ))}
                  <th className="text-right px-5 py-2.5 text-xs font-medium text-muted whitespace-nowrap">Limit today</th>
                </tr>
              </thead>
              <tbody>
                {data?.accounts.map(a => {
                  const over = a.sent_today > a.effective_limit_today;
                  return (
                    <tr key={a.id} className="border-b border-base-300/20 hover:bg-base-300/20 transition-colors">
                      <td className="px-5 py-3">
                        <div className="font-medium text-base-content/90 text-xs">{a.name}</div>
                        <div className="text-muted text-xs mt-0.5">{a.from_email}</div>
                        {a.ramp_start_date && (
                          <div className="text-muted text-[11px] mt-0.5">
                            Ramp from {a.ramp_start_date}
                          </div>
                        )}
                      </td>
                      {/* Today */}
                      <td className="px-4 py-3 text-right">
                        <span className={`text-sm font-semibold ${over ? "text-error" : a.sent_today > 0 ? "text-base-content" : "text-muted"}`}>
                          {a.sent_today}
                        </span>
                        {over && <span className="ml-1 text-error text-xs">↑</span>}
                        {/* Mini bar */}
                        <div className="mt-1 h-1 w-16 rounded-full bg-base-300 ml-auto">
                          <div
                            className={`h-1 rounded-full ${over ? "bg-error" : "bg-info"}`}
                            style={{ width: `${Math.min(100, (a.sent_today / Math.max(a.effective_limit_today, 1)) * 100)}%` }}
                          />
                        </div>
                      </td>
                      {/* Past 6 days — newest first */}
                      {a.days.slice(0, -1).reverse().map(d => (
                        <td key={d.day} className="px-4 py-3 text-right">
                          <span className={`text-xs ${d.sent > d.limit ? "text-error" : d.sent > 0 ? "text-muted" : "text-muted"}`}>
                            {d.sent > 0 ? d.sent : "—"}
                          </span>
                        </td>
                      ))}
                      <td className="px-5 py-3 text-right text-xs text-muted">
                        {a.effective_limit_today}
                        {a.ramp_up_enabled && a.ramp_start_date && a.effective_limit_today < a.daily_email_limit && (
                          <span className="ml-1 text-muted">(ramp)</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-base-300/40 bg-base-300/20">
                  <td className="px-5 py-2.5 text-xs font-medium text-muted">Total</td>
                  <td className="px-4 py-2.5 text-right text-sm font-semibold text-base-content">{totalToday}</td>
                  {data?.days.slice(0, -1).reverse().map(d => {
                    const sum = data.accounts.reduce((s, a) => s + (a.days.find(x => x.day === d)?.sent ?? 0), 0);
                    return (
                      <td key={d} className="px-4 py-2.5 text-right text-xs text-muted">
                        {sum > 0 ? sum : "—"}
                      </td>
                    );
                  })}
                  <td className="px-5 py-2.5 text-right text-xs font-medium text-muted">{totalLimit}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {/* Recent send log */}
          <div className="bg-base-200 rounded-xl border border-base-300/50 overflow-hidden">
            <div className="px-5 py-3 border-b border-base-300/40">
              <span className="text-sm font-medium text-base-content">Recent sends</span>
              <span className="ml-2 text-xs text-muted">last 50</span>
            </div>
            <div className="divide-y divide-base-300/20 max-h-96 overflow-y-auto">
              {data?.recentLogs.map((l, i) => {
                const acc = data.accounts.find(a => a.id === l.email_account_id);
                return (
                  <div key={i} className="px-5 py-2.5 flex items-start justify-between gap-4">
                    <div>
                      <div className="text-xs text-base-content/80">{l.message.replace("Email sent to ", "")}</div>
                      <div className="text-[11px] text-muted mt-0.5">{acc?.name ?? l.email_account_id.slice(0, 8)}</div>
                    </div>
                    <div className="text-[11px] text-muted whitespace-nowrap shrink-0">{formatDateTime(l.created_at)}</div>
                  </div>
                );
              })}
              {data?.recentLogs.length === 0 && (
                <div className="px-5 py-6 text-xs text-muted text-center">No sends recorded</div>
              )}
            </div>
          </div>

          {/* Guard trips */}
          <div className="bg-base-200 rounded-xl border border-base-300/50 overflow-hidden">
            <div className="px-5 py-3 border-b border-base-300/40">
              <span className="text-sm font-medium text-base-content">Limit guard trips</span>
              <span className="ml-2 text-xs text-muted">today</span>
            </div>
            <div className="divide-y divide-base-300/20 max-h-96 overflow-y-auto">
              {data?.guardTrips.map((g, i) => {
                const acc = g.email_account_id ? data.accounts.find(a => a.id === g.email_account_id) : null;
                return (
                  <div key={i} className="px-5 py-2.5 flex items-start justify-between gap-4">
                    <div>
                      <div className="text-xs text-warning">{g.message.replace("Daily limit reached — ", "→ ")}</div>
                      {acc && <div className="text-[11px] text-muted mt-0.5">{acc.name}</div>}
                    </div>
                    <div className="text-[11px] text-muted whitespace-nowrap shrink-0">{formatDateTime(g.created_at)}</div>
                  </div>
                );
              })}
              {data?.guardTrips.length === 0 && (
                <div className="px-5 py-6 text-xs text-success text-center">No guard trips today</div>
              )}
            </div>
          </div>
        </div>

      </div>
    </>
  );
}
