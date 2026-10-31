import { describe, expect, it } from "bun:test";
import { buildLatestJson } from "./gen-latest-json.mjs";

describe("buildLatestJson", () => {
  it("assembles a multi-platform manifest", () => {
    const m = buildLatestJson({
      version: "0.9.8-snatvb.2",
      pubDate: "2026-10-31T00:00:00Z",
      notes: "See the release page.",
      platforms: {
        "darwin-aarch64": {
          signature: "SIG_MAC",
          url: "https://github.com/snatvb/Handy/releases/download/personal-v0.9.8-snatvb.2/Handy.app.tar.gz",
        },
        "windows-x86_64": {
          signature: "SIG_WIN",
          url: "https://github.com/snatvb/Handy/releases/download/personal-v0.9.8-snatvb.2/Handy_0.9.8-snatvb.2_x64-setup.exe.nsis.zip",
        },
      },
    });
    expect(m.version).toBe("0.9.8-snatvb.2");
    expect(m.pub_date).toBe("2026-10-31T00:00:00Z");
    expect(m.notes).toBe("See the release page.");
    expect(m.platforms["darwin-aarch64"]).toEqual({
      signature: "SIG_MAC",
      url: "https://github.com/snatvb/Handy/releases/download/personal-v0.9.8-snatvb.2/Handy.app.tar.gz",
    });
    expect(m.platforms["windows-x86_64"].signature).toBe("SIG_WIN");
  });

  it("still works for a single platform", () => {
    const m = buildLatestJson({
      version: "1.0.0",
      pubDate: "d",
      platforms: { "darwin-aarch64": { signature: "s", url: "u" } },
    });
    expect(m.notes).toBe("");
    expect(Object.keys(m.platforms)).toEqual(["darwin-aarch64"]);
  });

  it("rejects empty platform sets and incomplete entries", () => {
    expect(() =>
      buildLatestJson({ version: "1.0.0", pubDate: "d", platforms: {} }),
    ).toThrow();
    expect(() =>
      buildLatestJson({
        version: "1.0.0",
        pubDate: "d",
        platforms: { "darwin-aarch64": { signature: "s" } },
      }),
    ).toThrow();
    expect(() => buildLatestJson({ version: "1.0.0", pubDate: "d" })).toThrow();
  });
});
