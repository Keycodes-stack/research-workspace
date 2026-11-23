"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { consumeTokenFragment, getToken, setToken } from "@/lib/api";
import { V2 } from "@/lib/v2/routes";

/**
 * Entry point. A signed-in user goes to Home. Anyone else gets the sign-in form: the access token issued by an
 * administrator, kept in this browser only. Launcher links (#kc_token=...) are accepted here too.
 */
export default function SignInPage() {
  const router = useRouter();
  const [token, setTok] = useState<string | null | undefined>(undefined);
  const [draft, setDraft] = useState("");

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

  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <form
        className="flex w-full max-w-md flex-col gap-3 rounded-[20px] border border-[#EDEDF0] bg-white p-8"
        onSubmit={(e) => { e.preventDefault(); const t = draft.trim(); if (t) { setToken(t); router.replace(`${V2}/home`); } }}
      >
        <h1 className="text-xl font-semibold text-[#101D37]">Sign in</h1>
        <p className="text-sm text-body">Paste the access token issued by your administrator. It is kept in this browser only.</p>
        <label htmlFor="token" className="sr-only">Access token</label>
        <input id="token" type="password" autoComplete="off" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Access token"
          className="w-full rounded-[10px] border border-[#EDEDF0] bg-white px-3 py-2.5 text-sm text-[#101D37] outline-none focus:border-blue" />
        <button type="submit" disabled={!draft.trim()} className="rounded-[10px] bg-blue px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">Continue</button>
      </form>
    </main>
  );
}
