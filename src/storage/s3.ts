export type S3Config = {
  endpoint: string;
  accessKey: string;
  secretKey: string;
  region: string;
};

function baseRegion(config: S3Config): string {
  return config.region.trim() || "us-east-1";
}

function bytesToHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256(input: BufferSource): Promise<ArrayBuffer> {
  return crypto.subtle.digest("SHA-256", input);
}

function sha256Utf8(value: string): Promise<ArrayBuffer> {
  return sha256(new TextEncoder().encode(value));
}

async function hmac(key: ArrayBuffer, value: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(value));
}

async function deriveSigningKey(
  secretKey: string,
  dateStamp: string,
  region: string,
): Promise<ArrayBuffer> {
  const kDate = await hmac(
    new TextEncoder().encode(`AWS4${secretKey}`).buffer as ArrayBuffer,
    dateStamp,
  );
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, "s3");
  return hmac(kService, "aws4_request");
}

function canonicalUri(url: URL): string {
  const raw = url.pathname === "" ? "/" : url.pathname;
  return encodeURIComponent(raw).replace(/%2F/g, "/").replace(/%3F/g, "?");
}

function canonicalQuery(url: URL): string {
  if (url.searchParams.size === 0) return "";
  return [...url.searchParams.entries()]
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

function canonicalHeadersAndSigned(headers: Headers): { canonical: string; signed: string } {
  const names = [...headers.keys()].map((k) => k.toLowerCase());
  const sorted = names.sort();
  const canonical = sorted
    .map((name) => `${name}:${(headers.get(name) ?? "").trim().replace(/\s+/g, " ")}`)
    .join("\n");
  return { canonical, signed: sorted.join(";") };
}

function buildUrl(config: S3Config, path: string, query?: Record<string, string>): URL {
  const base = config.endpoint.replace(/\/$/, "");
  const url = new URL(`${base}${path.startsWith("/") ? path : `/${path}`}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  }
  return url;
}

async function buildSignedHeaders(
  config: S3Config,
  method: string,
  url: URL,
  bodyHash: string,
  extra: Record<string, string>,
): Promise<Headers> {
  const headers = new Headers(extra);
  headers.set("host", url.host);
  headers.set("x-amz-content-sha256", bodyHash);

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  headers.set("x-amz-date", amzDate);

  const { canonical, signed } = canonicalHeadersAndSigned(headers);
  const canonicalRequest = [
    method,
    canonicalUri(url),
    canonicalQuery(url),
    canonical,
    "",
    signed,
    bodyHash,
  ].join("\n");
  const scope = `${dateStamp}/${baseRegion(config)}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    bytesToHex(await sha256Utf8(canonicalRequest)),
  ].join("\n");

  const signingKey = await deriveSigningKey(config.secretKey, dateStamp, baseRegion(config));
  const signature = bytesToHex(await hmac(signingKey, stringToSign));
  headers.set(
    "Authorization",
    `AWS4-HMAC-SHA256 Credential=${config.accessKey}/${scope}, SignedHeaders=${signed}, Signature=${signature}`,
  );
  return headers;
}

export async function s3Request(
  config: S3Config,
  method: string,
  path: string,
  options: { query?: Record<string, string>; body?: ArrayBuffer | null; contentType?: string } = {},
): Promise<Response> {
  const url = buildUrl(config, path, options.query);
  const bodyBytes = options.body ?? null;
  const bodyHash = bytesToHex(await sha256(bodyBytes ?? new ArrayBuffer(0)));
  const extra: Record<string, string> = {};
  if (options.contentType) extra["content-type"] = options.contentType;
  const headers = await buildSignedHeaders(config, method, url, bodyHash, extra);
  return fetch(url.toString(), { method, headers, body: bodyBytes });
}

export async function headBucket(config: S3Config, bucket: string): Promise<boolean> {
  const res = await s3Request(config, "HEAD", `/${bucket}`);
  return res.status === 200;
}

export async function makeBucket(config: S3Config, bucket: string): Promise<boolean> {
  const res = await s3Request(config, "PUT", `/${bucket}`);
  return res.status === 200;
}

export async function putObject(
  config: S3Config,
  bucket: string,
  key: string,
  body: Buffer | string | Uint8Array,
  contentType?: string,
): Promise<Response> {
  const bytes =
    typeof body === "string"
      ? new TextEncoder().encode(body)
      : body instanceof Uint8Array
        ? body
        : new Uint8Array(body);
  const options: {
    query?: Record<string, string>;
    body?: ArrayBuffer | null;
    contentType?: string;
  } = { body: bytes.buffer as ArrayBuffer };
  if (contentType) options.contentType = contentType;
  return s3Request(config, "PUT", `/${bucket}/${encodeURIComponent(key)}`, options);
}

export async function getObject(config: S3Config, bucket: string, key: string): Promise<Response> {
  return s3Request(config, "GET", `/${bucket}/${encodeURIComponent(key)}`);
}

export async function deleteObject(
  config: S3Config,
  bucket: string,
  key: string,
): Promise<Response> {
  return s3Request(config, "DELETE", `/${bucket}/${encodeURIComponent(key)}`);
}

export type S3ObjectMeta = { key: string; size: number; lastModified?: string };
