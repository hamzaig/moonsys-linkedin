export async function register() {
  // Only run on the Node.js server runtime, not in the browser/edge
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const { ensureGlobalRunnerStarted } = await import("@/lib/linkedin/runner");
      ensureGlobalRunnerStarted();
    } catch (err) {
      console.error("[instrumentation] Failed to start runner:", err);
    }
    try {
      const [{ ensureLinkedInInboxWorkerStarted }, { getDb }, { syncAccountInbox }] = await Promise.all([
        import("@/lib/linkedin/inbox/worker"), import("@/lib/db"), import("@/lib/linkedin/inbox/session-provider"),
      ]);
      ensureLinkedInInboxWorkerStarted({ getDb, sync: syncAccountInbox });
    } catch {
      console.error("[instrumentation] LinkedIn inbox worker could not start");
    }
  }
}
