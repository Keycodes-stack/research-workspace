import { beforeEach, describe, expect, it, vi } from "vitest";
import { consumeTokenFragment, getToken, setToken } from "@/lib/api";

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
