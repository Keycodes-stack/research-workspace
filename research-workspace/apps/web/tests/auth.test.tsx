import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, consumeTokenFragment, getToken, setToken } from "@/lib/api";
import { useLoad } from "@/components/useLoad";

/**
 * Testing build: there is no sign-in page at all. The entry page sends the
 * user straight to Home, and a 401 from the server is shown as an error
 * instead of bouncing back to a sign-in form.
 */
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), replace }),
  useParams: () => ({}),
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
}));

import SignInPage from "@/app/(v2)/page";

describe("no sign-in gate (testing build)", () => {
  beforeEach(() => { replace.mockClear(); setToken(null); window.history.replaceState(null, "", "/"); });

  it("entry page redirects straight to Home", async () => {
    render(<SignInPage />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/home"));
    expect(document.querySelector("form")).toBeNull();
    expect(screen.queryByText(/Sign in/i)).toBeNull();
  });
});

describe("launcher sign-in fragment (kept for later)", () => {
  beforeEach(() => { setToken(null); window.history.replaceState(null, "", "/"); });

  it("stores the token and removes it from the address bar", () => {
    window.history.replaceState(null, "", "/#kc_token=abc.def.ghi");
    consumeTokenFragment();
    expect(getToken()).toBe("abc.def.ghi");
    expect(window.location.hash).toBe("");
  });

  it("does nothing without a fragment and never invents a token", () => {
    consumeTokenFragment();
    expect(getToken()).toBeNull();
  });
});

describe("sign-in when the browser cannot save (disk full, private mode)", () => {
  it("keeps the user signed in for the visit", () => {
    const full = () => { throw new DOMException("quota", "QuotaExceededError"); };
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(full);
    try {
      setToken("abc.def.ghi");
      expect(getToken()).toBe("abc.def.ghi");                                   // memory fallback
      expect((window as unknown as { __kcToken?: string }).__kcToken).toBe("abc.def.ghi"); // Halden frame reads this
    } finally {
      spy.mockRestore();
      setToken(null);
    }
    expect(getToken()).toBeNull();
  });
});

function FailingLoader() {
  const { error, loading } = useLoad(async () => { throw new ApiError(401, { error: "unauthorized" }, "unauthorized"); });
  if (loading) return <p>Loading...</p>;
  return <p>{error ?? "no error"}</p>;
}

describe("useLoad on 401 (no sign-in page to bounce to)", () => {
  it("shows an error and stays on the page", async () => {
    render(<FailingLoader />);
    await waitFor(() => expect(screen.getByText(/Not signed in/)).toBeInTheDocument());
    expect(window.location.pathname).toBe("/");
  });
});
