import { beforeEach, describe, expect, it } from "vitest";
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
