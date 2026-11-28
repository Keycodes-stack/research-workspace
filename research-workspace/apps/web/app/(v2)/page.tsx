"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { V2 } from "@/lib/v2/routes";

/**
 * Entry point. Testing build: no sign-in at all — the app opens straight
 * into Home. The server still guards the data (calls without a token get
 * 401), so pages show their empty/error states until a token is present.
 * The email/password login is kept in the repo for the later VPS deploy.
 */
export default function SignInPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace(`${V2}/home`);
  }, [router]);

  return null;
}
