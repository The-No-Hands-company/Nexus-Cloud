import { describe, it, expect, afterEach } from "bun:test";
import { selectZone, tunnelTarget, cnameRecordBody } from "./cloudflare-dns";

describe("selectZone", () => {
  const tnhc = { id: "z1", name: "tnhc.dev" };

  it("matches a subdomain to its zone", () => {
    expect(selectZone("draw.tnhc.dev", [tnhc])).toEqual(tnhc);
  });

  it("matches the zone apex itself", () => {
    expect(selectZone("tnhc.dev", [tnhc])).toEqual(tnhc);
  });

  it("is case-insensitive and tolerates a trailing dot", () => {
    expect(selectZone("Draw.TNHC.dev.", [tnhc])).toEqual(tnhc);
  });

  it("returns null when no visible zone owns the host (out of scope)", () => {
    // This is the nohands.company case: the token only sees tnhc.dev.
    expect(selectZone("nohands.company", [tnhc])).toBeNull();
  });

  it("prefers the most specific (longest) matching zone", () => {
    const parent = { id: "z2", name: "example.com" };
    const child = { id: "z3", name: "team.example.com" };
    expect(selectZone("app.team.example.com", [parent, child])).toEqual(child);
  });

  it("does not treat a shared suffix as a match (foo.dev is not in tnhc.dev)", () => {
    // endsWith(".tnhc.dev") guards against "eviltnhc.dev" matching "tnhc.dev".
    expect(selectZone("eviltnhc.dev", [tnhc])).toBeNull();
  });
});

describe("tunnelTarget", () => {
  const saved = { id: process.env.NEXUS_TUNNEL_ID, full: process.env.NEXUS_TUNNEL_CNAME_TARGET };
  afterEach(() => {
    // restore
    if (saved.id === undefined) delete process.env.NEXUS_TUNNEL_ID; else process.env.NEXUS_TUNNEL_ID = saved.id;
    if (saved.full === undefined) delete process.env.NEXUS_TUNNEL_CNAME_TARGET; else process.env.NEXUS_TUNNEL_CNAME_TARGET = saved.full;
  });

  it("builds the cfargotunnel target from a tunnel id", () => {
    delete process.env.NEXUS_TUNNEL_CNAME_TARGET;
    process.env.NEXUS_TUNNEL_ID = "a3fc7587-49de-4792-b532-882775db6457";
    expect(tunnelTarget()).toBe("a3fc7587-49de-4792-b532-882775db6457.cfargotunnel.com");
  });

  it("prefers an explicit full target and strips a trailing dot", () => {
    process.env.NEXUS_TUNNEL_ID = "ignored";
    process.env.NEXUS_TUNNEL_CNAME_TARGET = "custom.cfargotunnel.com.";
    expect(tunnelTarget()).toBe("custom.cfargotunnel.com");
  });

  it("is empty when neither is configured", () => {
    delete process.env.NEXUS_TUNNEL_ID;
    delete process.env.NEXUS_TUNNEL_CNAME_TARGET;
    expect(tunnelTarget()).toBe("");
  });
});

describe("cnameRecordBody", () => {
  it("produces a proxied CNAME payload", () => {
    expect(cnameRecordBody("nohands.company", "x.cfargotunnel.com", true)).toEqual({
      type: "CNAME",
      name: "nohands.company",
      content: "x.cfargotunnel.com",
      ttl: 1,
      proxied: true,
    });
  });
});
