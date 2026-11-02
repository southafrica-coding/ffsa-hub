import { EnvError, parseEnv } from "../env";

const good = {
  EXPO_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
  EXPO_PUBLIC_SUPABASE_ANON_KEY: "public-anon-key-placeholder-000",
  EXPO_PUBLIC_API_BASE_URL: "https://www.ffsahub.com/",
};

describe("parseEnv", () => {
  it("accepts valid values and strips trailing slashes", () => {
    expect(parseEnv(good)).toEqual({
      supabaseUrl: "https://abc.supabase.co",
      supabaseAnonKey: "public-anon-key-placeholder-000",
      apiBaseUrl: "https://www.ffsahub.com",
    });
  });

  it("allows http for local development", () => {
    expect(parseEnv({ ...good, EXPO_PUBLIC_API_BASE_URL: "http://192.168.1.20:3000" }).apiBaseUrl).toBe(
      "http://192.168.1.20:3000",
    );
  });

  it("fails loudly, naming every missing variable and the fix", () => {
    let error: unknown;
    try {
      parseEnv({});
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(EnvError);
    const msg = (error as Error).message;
    expect(msg).toContain("EXPO_PUBLIC_SUPABASE_URL: missing");
    expect(msg).toContain("EXPO_PUBLIC_SUPABASE_ANON_KEY: missing");
    expect(msg).toContain("EXPO_PUBLIC_API_BASE_URL: missing");
    expect(msg).toContain(".env.example");
  });

  it("explains invalid values without echoing them", () => {
    expect(() => parseEnv({ ...good, EXPO_PUBLIC_API_BASE_URL: "ffsahub.com" })).toThrow(
      /EXPO_PUBLIC_API_BASE_URL: must be a full http\(s\) URL/,
    );
    expect(() => parseEnv({ ...good, EXPO_PUBLIC_SUPABASE_URL: "ftp://x.y" })).toThrow(/EXPO_PUBLIC_SUPABASE_URL/);
    try {
      parseEnv({ ...good, EXPO_PUBLIC_SUPABASE_ANON_KEY: "short" });
    } catch (e) {
      expect((e as Error).message).toContain("EXPO_PUBLIC_SUPABASE_ANON_KEY");
      expect((e as Error).message).not.toContain("short\n");
    }
  });
});
