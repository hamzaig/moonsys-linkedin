import PageHeader, { PageTitle, PageDescription } from "@/components/ui/PageHeader";
import Head from "next/head";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { RiAddLine, RiDeleteBinLine, RiEyeLine, RiEditLine } from "react-icons/ri";
import ScriptView, { SCRIPT_VARS, fillScript } from "@/components/dialer/ScriptView";

interface Script { id: string; name: string; body: string; updated_at: string }

const SAMPLE = { salutation: "Herr", first_name: "Alex", last_name: "Morgan", full_name: "Alex Morgan", company: "Acme GmbH", title: "Head of Sales", phone: "+49 30 1234567" };

const STARTER = `# Cold call opener

### Opening (10 sec)
Guten Tag {{salutation}} {{last_name}}, this is [your name] from [your company] — did I catch you at a bad time?

### Reason for the call
I'm calling because we help teams like **{{company}}** with [one-line value]. Others in a role like yours ({{title}}) tell us [pain point].

### Discovery questions
- How are you handling [problem] today?
- What would change if that were solved?
- Who else would be involved in a decision like this?

### Handling objections
> "Not interested" → Totally fair. Mind if I ask what you're using today, so I don't waste your time?
> "Send me an email" → Happy to. What would make it worth your time to read?

### Close
Would **Thursday at 10:00** or **Friday at 14:00** work for a 15-minute chat?
`;

export default function ScriptsPage() {
  const [scripts, setScripts] = useState<Script[] | null>(null);
  const [selId, setSelId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const sel = scripts?.find((s) => s.id === selId) ?? null;
  const dirty = !!sel && (sel.name !== name || sel.body !== body);

  function open(s: Script | null) {
    setSelId(s?.id ?? null);
    setName(s?.name ?? "");
    setBody(s?.body ?? "");
    setPreview(false);
  }

  useEffect(() => {
    fetch("/api/dialer/scripts").then((r) => r.json()).then((list: Script[]) => {
      setScripts(list);
      if (list[0]) open(list[0]);
    }).catch(() => { setScripts([]); toast.error("Failed to load scripts"); });
  }, []);

  function guard(next: () => void) {
    if (dirty && !confirm("Discard unsaved changes?")) return;
    next();
  }

  async function create(starter: boolean) {
    const res = await fetch("/api/dialer/scripts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: starter ? "Cold call opener" : "Untitled script", body: starter ? STARTER : "" }),
    });
    if (!res.ok) { toast.error("Failed to create"); return; }
    const s = await res.json() as Script;
    setScripts((prev) => [...(prev ?? []), s].sort((a, b) => a.name.localeCompare(b.name)));
    open(s);
  }

  async function save() {
    if (!sel || !name.trim()) return;
    setSaving(true);
    const res = await fetch(`/api/dialer/scripts?id=${sel.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, body }),
    });
    setSaving(false);
    if (!res.ok) { toast.error("Failed to save"); return; }
    const s = await res.json() as Script;
    setScripts((prev) => (prev ?? []).map((x) => (x.id === s.id ? s : x)).sort((a, b) => a.name.localeCompare(b.name)));
    toast.success("Saved");
  }

  async function remove() {
    if (!sel || !confirm(`Delete "${sel.name}"?`)) return;
    const res = await fetch(`/api/dialer/scripts?id=${sel.id}`, { method: "DELETE" });
    if (!res.ok) { toast.error("Failed to delete"); return; }
    const rest = (scripts ?? []).filter((s) => s.id !== sel.id);
    setScripts(rest);
    open(rest[0] ?? null);
  }

  function insertVar(v: string) {
    const el = bodyRef.current;
    const tag = `{{${v}}}`;
    if (!el) { setBody((b) => b + tag); return; }
    const a = el.selectionStart, b = el.selectionEnd;
    setBody(body.slice(0, a) + tag + body.slice(b));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a + tag.length, a + tag.length); });
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); save(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <>
      <Head><title>Call scripts — MoonSys LinkedIn</title></Head>
      <div className="ms-split-workspace">
        <div className="ms-split-sidebar w-72 flex flex-col">
          <PageHeader className="px-4 pt-5 pb-3 flex items-center justify-between ms-page-header--compact">
            <div>
              <PageTitle className="text-base font-semibold text-base-content tracking-tight">Scripts</PageTitle>
              <PageDescription className="text-xs text-muted mt-1">What you read during a call</PageDescription>
            </div>
            <button onClick={() => guard(() => create(false))} title="New script" className="w-8 h-8 flex items-center justify-center rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors">
              <RiAddLine size={16} />
            </button>
          </PageHeader>
          <div className="flex-1 overflow-y-auto px-3 pb-4 flex flex-col gap-1">
            {scripts === null ? <p className="text-center text-xs text-muted py-16">Loading…</p>
              : scripts.length === 0 ? (
                <div className="text-center py-12 px-4">
                  <p className="text-xs text-muted mb-3">No scripts yet.</p>
                  <button onClick={() => create(true)} className="px-3 py-2 rounded-xl text-xs bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20">Start from a template</button>
                </div>
              ) : scripts.map((s) => (
                <button
                  key={s.id}
                  onClick={() => guard(() => open(s))}
                  className={`text-left px-3 py-2.5 rounded-xl border transition-colors ${s.id === selId ? "bg-primary/10 border-primary/30" : "bg-base-200/50 border-base-300/30 hover:bg-base-200"}`}
                >
                  <p className="text-sm font-medium text-base-content truncate">{s.name}</p>
                  <p className="text-[11px] text-muted truncate mt-0.5">{s.body.replace(/[#>*\n]+/g, " ").trim() || "Empty"}</p>
                </button>
              ))}
          </div>
        </div>

        <div className="flex-1 min-w-0 flex flex-col">
          {!sel ? (
            <div className="flex-1 flex items-center justify-center text-sm text-muted">Create a script to get started.</div>
          ) : (
            <>
              <div className="shrink-0 px-5 py-3 border-b border-base-300/40 flex flex-wrap items-center gap-3">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  aria-label="Script name"
                  placeholder="Script name"
                  className="min-w-0 flex-1 bg-transparent text-base font-semibold text-base-content placeholder:text-muted focus:outline-none"
                />
                <div className="flex bg-base-200 border border-base-300/40 rounded-lg p-0.5">
                  <button aria-pressed={!preview} onClick={() => setPreview(false)} className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs ${!preview ? "bg-base-300 text-base-content" : "text-muted"}`}><RiEditLine size={12} /> Edit</button>
                  <button aria-pressed={preview} onClick={() => setPreview(true)} className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs ${preview ? "bg-base-300 text-base-content" : "text-muted"}`}><RiEyeLine size={12} /> Preview</button>
                </div>
                <button onClick={remove} title="Delete" className="w-8 h-8 flex items-center justify-center rounded-lg text-muted hover:text-error hover:bg-error/10 transition-colors"><RiDeleteBinLine size={15} /></button>
                <button
                  onClick={save}
                  disabled={!dirty || saving || !name.trim()}
                  className="px-4 py-2 rounded-xl text-sm font-medium bg-primary/90 text-primary-content hover:bg-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >{saving ? "Saving…" : dirty ? "Save" : "Saved"}</button>
              </div>

              {preview ? (
                <div className="flex-1 overflow-y-auto px-10 py-8">
                  <div className="max-w-3xl mx-auto">
                    <p className="text-[11px] text-muted mb-4">Preview with sample contact ({SAMPLE.full_name}, {SAMPLE.company})</p>
                    <ScriptView body={fillScript(body, SAMPLE)} large />
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex flex-col min-h-0 px-6 py-4 gap-3">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[11px] text-muted mr-1">Insert</span>
                    {SCRIPT_VARS.map((v) => (
                      <button key={v} onClick={() => insertVar(v)} className="px-2 py-1 rounded-md text-[11px] font-mono bg-base-200 text-muted border border-base-300/40 hover:text-primary hover:border-primary/30 transition-colors">{`{{${v}}}`}</button>
                    ))}
                    <span className="ml-auto text-[11px] text-muted">Markdown · Ctrl/⌘+S to save</span>
                  </div>
                  <textarea
                    ref={bodyRef}
                    aria-label="Script content"
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder="Write what you want to say. Use ### for sections, - for bullets, > for quotes, **bold** for emphasis."
                    className="flex-1 w-full bg-base-200/60 border border-base-300/40 rounded-xl px-5 py-4 text-sm font-mono text-base-content/80 placeholder:text-muted leading-relaxed focus:outline-none focus:border-base-300/80 resize-none"
                  />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
