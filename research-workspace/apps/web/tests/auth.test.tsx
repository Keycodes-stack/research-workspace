import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { consumeTokenFragment, getToken, login, setToken } from "@/lib/api";
import SignInPage from "@/app/(v2)/page";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
}));

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  } as Response;
}

describe("email/password login", () => {
  beforeEach(() => {
    setToken(null);
    vi.restoreAllMocks();
  });

  it("success stores the token and sends no stale Bearer", async () => {
    setToken("stale.token.here");
    const seen: RequestInit[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url: unknown, init?: RequestInit) => {
      seen.push(init ?? {});
      return jsonResponse(200, { token: "new.token.here" });
    });
    const { token } = await login("admin@artifexlabs", "correct-horse");
    expect(token).toBe("new.token.here");
    setToken(token);
    expect(getToken()).toBe("new.token.here");
    expect(seen).toHaveLength(1);
    const headers = new Headers(seen[0].headers);
    expect(headers.get("Authorization")).toBeNull();
    expect(JSON.parse(String(seen[0].body))).toEqual({ email: "admin@artifexlabs", password: "correct-horse" });
  });

  it("failure stores nothing and throws", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(401, { error: "invalid email or password" }));
    await expect(login("admin@artifexlabs", "wrong")).rejects.toThrow("invalid email or password");
    expect(getToken()).toBeNull();
  });

  it("login not configured (503) throws", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(503, { error: "login not configured" }));
    await expect(login("admin@artifexlabs", "x")).rejects.toThrow("login not configured");
    expect(getToken()).toBeNull();
  });
});

describe("sign-in page", () => {
  beforeEach(() => {
    setToken(null);
    replace.mockClear();
    window.history.replaceState(null, "", "/");
    vi.restoreAllMocks();
  });

  async function signInWith(email: string, password: string) {
    render(<SignInPage />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
  }

  it("signs in with email + password and goes Home", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(200, { token: "abc.def.ghi" }));
    await signInWith("admin@artifexlabs", "correct-horse");
    await waitFor(() => expect(getToken()).toBe("abc.def.ghi"));
    expect(replace).toHaveBeenCalledWith("/home");
  });

  it("shows an error and stores nothing on a failed login", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(401, { error: "invalid email or password" }));
    await signInWith("admin@artifexlabs", "wrong");
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("invalid email or password"));
    expect(getToken()).toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });

  it("does not submit with empty fields", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(200, { token: "abc.def.ghi" }));
    render(<SignInPage />);
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(getToken()).toBeNull();
  });
});

describe("launcher sign-in fragment", () => {
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
