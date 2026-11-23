import Head from "next/head";
import { signIn } from "next-auth/react";
import { useRouter } from "next/router";
import { useState } from "react";
import { RiLockPasswordLine, RiMailLine, RiKeyLine, RiContactsLine, RiFlowChart, RiChat3Line, RiArrowRightLine } from "react-icons/ri";
import MoonSysLogo from "@/components/brand/MoonSysLogo";
import { PageTitle, PageDescription } from "@/components/ui/PageHeader";

type Mode = "signin" | "signup";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function switchMode(next: Mode) {
    setMode(next);
    setError("");
  }

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const res = await signIn("credentials", { email, password, redirect: false });
    setLoading(false);

    if (res?.ok) {
      router.replace("/");
    } else {
      setError("Incorrect email or password.");
    }
  }

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const res = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, inviteCode }),
    });

    const data = await res.json();
    if (!res.ok) {
      setLoading(false);
      setError(data.error ?? "Something went wrong.");
      return;
    }

    // Auto sign in after signup
    const signInRes = await signIn("credentials", { email, password, redirect: false });
    setLoading(false);

    if (signInRes?.ok) {
      router.replace("/");
    } else {
      setError("Account created but sign-in failed. Try signing in manually.");
      switchMode("signin");
    }
  }

  return (
    <>
      <Head><title>{mode === "signin" ? "Sign in" : "Create account"} — MoonSys LinkedIn</title><meta name="robots" content="noindex, nofollow" /></Head>
      <div className="ms-auth">
        <section className="ms-auth-story" aria-label="MoonSys LinkedIn workspace">
          <MoonSysLogo linked={false} />
          <div className="ms-auth-story-content">
            <span className="ms-eyebrow">MoonSys LinkedIn</span>
            <h2 className="ms-auth-headline">Your outreach,<br />all in one place.</h2>
            <p>A focused workspace for your prospects, campaigns and conversations. Built around the way you work.</p>
            <div className="mt-9">
              <div className="ms-auth-feature"><span><RiContactsLine size={19} aria-hidden="true" /></span>Organize your prospects</div>
              <div className="ms-auth-feature"><span><RiFlowChart size={19} aria-hidden="true" /></span>Build multi-step campaigns</div>
              <div className="ms-auth-feature"><span><RiChat3Line size={19} aria-hidden="true" /></span>Keep replies in view</div>
            </div>
          </div>
          <p className="ms-auth-footer">Your workspace. Your data. &nbsp; Built by MoonSys.</p>
        </section>
        <div className="ms-auth-form-side">
          <div className="ms-auth-form-container">
            <div className="ms-auth-mobile-brand"><MoonSysLogo linked={false} /></div>
            <PageTitle>{mode === "signin" ? "Welcome back." : "Create your account."}</PageTitle>
            <PageDescription>{mode === "signin" ? "Sign in to your MoonSys workspace." : "Use your workspace invite code to get started."}</PageDescription>
            <div className="ms-auth-tabs" aria-label="Account access">
              <button type="button" onClick={() => switchMode("signin")} aria-pressed={mode === "signin"}>Sign in</button>
              <button type="button" onClick={() => switchMode("signup")} aria-pressed={mode === "signup"}>Create account</button>
            </div>
            <form onSubmit={mode === "signin" ? handleSignIn : handleSignUp} className="ms-auth-form" aria-busy={loading}>
              <div>
                <label htmlFor="auth-email">Email address</label>
                <div className="ms-auth-input-wrap">
                  <RiMailLine size={17} aria-hidden="true" />
                  <input id="auth-email" name="email" type="email" className="ms-auth-input" placeholder="you@company.com" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} autoFocus required disabled={loading} />
                </div>
              </div>
              <div>
                <label htmlFor="auth-password">Password</label>
                <div className="ms-auth-input-wrap">
                  <RiLockPasswordLine size={17} aria-hidden="true" />
                  <input id="auth-password" name="password" type="password" className="ms-auth-input" placeholder={mode === "signup" ? "At least 8 characters" : "Enter your password"} autoComplete={mode === "signup" ? "new-password" : "current-password"} value={password} onChange={event => setPassword(event.target.value)} required disabled={loading} />
                </div>
              </div>
              {mode === "signup" && <div>
                <label htmlFor="auth-invite">Workspace invite code</label>
                <div className="ms-auth-input-wrap">
                  <RiKeyLine size={17} aria-hidden="true" />
                  <input id="auth-invite" name="inviteCode" type="password" className="ms-auth-input" placeholder="Ask your workspace admin" autoComplete="off" value={inviteCode} onChange={event => setInviteCode(event.target.value)} required disabled={loading} />
                </div>
              </div>}
              {error && <p role="alert" className="text-sm text-error">{error}</p>}
              <button type="submit" disabled={loading} className="ms-auth-submit">
                {loading ? <><span className="loading loading-spinner loading-xs" aria-hidden="true" /><span>{mode === "signin" ? "Signing in…" : "Creating account…"}</span></> : <>{mode === "signin" ? "Sign in" : "Create account"}<RiArrowRightLine size={17} aria-hidden="true" /></>}
              </button>
            </form>
            <p className="ms-auth-note">Need access? Ask your workspace admin for an invite code.<br />Learn more at <a href="https://www.moonsys.co" target="_blank" rel="noopener noreferrer" className="font-semibold underline underline-offset-4">MoonSys.co</a>.</p>
          </div>
        </div>
      </div>
    </>
  );
}
