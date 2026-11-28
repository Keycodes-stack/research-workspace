"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { consumeTokenFragment, getToken, login, setToken } from "@/lib/api";
import { V2 } from "@/lib/v2/routes";

/**
 * Entry point. A signed-in user goes to Home. Anyone else gets the sign-in form: email + password, checked by
 * the gateway (POST /auth/login), which returns the same JWT a minted access token would carry. The password is
 * never stored in this browser. Launcher links (#kc_token=...) are still accepted here as a break-glass fallback.
 */
export default function SignInPage() {
  const router = useRouter();
  const [token, setTok] = useState<string | null | undefined>(undefined);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    consumeTokenFragment();
    const current = getToken();
    setTok(current);
    if (current) router.replace(`${V2}/home`);
    const onHash = () => { consumeTokenFragment(); setTok(getToken()); };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [router]);

  if (token === undefined || token) return null;

  const canSubmit = email.trim() !== "" && password !== "" && !busy;

  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <form
        className="flex w-full max-w-md flex-col gap-3 rounded-[20px] border border-[#EDEDF0] bg-white p-8"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!canSubmit) return;
          setError(null);
          setBusy(true);
          try {
            const { token: t } = await login(email.trim(), password);
            setToken(t);
            router.replace(`${V2}/home`);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Sign-in failed. Try again.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <h1 className="text-xl font-semibold text-[#101D37]">Sign in</h1>
        <p className="text-sm text-body">Sign in with your email and password. Your password is checked by the server and never stored in this browser.</p>
        <label htmlFor="email" className="sr-only">Email</label>
        <input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@artifexlabs"
          className="w-full rounded-[10px] border border-[#EDEDF0] bg-white px-3 py-2.5 text-sm text-[#101D37] outline-none focus:border-blue" />
        <label htmlFor="password" className="sr-only">Password</label>
        <input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password"
          className="w-full rounded-[10px] border border-[#EDEDF0] bg-white px-3 py-2.5 text-sm text-[#101D37] outline-none focus:border-blue" />
        {error && <p role="alert" className="text-sm text-[#B42318]">{error}</p>}
        <button type="submit" disabled={!canSubmit} className="rounded-[10px] bg-blue px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
