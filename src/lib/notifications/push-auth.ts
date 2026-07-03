import { createHmac, timingSafeEqual } from "node:crypto";

type PushOpenTokenPayload = {
  u: string;
  exp: number;
};

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function getTokenSecret(): string {
  return (
    asString(process.env.PUSH_OPEN_TOKEN_SECRET) ||
    asString(process.env.VAPID_PRIVATE_KEY) ||
    asString(process.env.SUPABASE_SERVICE_ROLE_KEY)
  );
}

function toBase64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function fromBase64Url(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function sign(payloadB64: string, secret: string): string {
  return createHmac("sha256", secret).update(payloadB64).digest("base64url");
}

export function createPushOpenToken(username: string): string | null {
  const secret = getTokenSecret();
  if (!secret || !username) return null;

  const payload: PushOpenTokenPayload = {
    u: username,
    exp: Date.now() + 15 * 60 * 1000,
  };

  const payloadB64 = toBase64Url(JSON.stringify(payload));
  const signature = sign(payloadB64, secret);
  return `${payloadB64}.${signature}`;
}

export function verifyPushOpenToken(token: string): { valid: true; username: string } | { valid: false } {
  const secret = getTokenSecret();
  if (!secret || !token) return { valid: false };

  const [payloadB64, signature] = token.split(".");
  if (!payloadB64 || !signature) return { valid: false };

  const expected = sign(payloadB64, secret);
  const sigBuf = Buffer.from(signature, "utf8");
  const expectedBuf = Buffer.from(expected, "utf8");

  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    return { valid: false };
  }

  try {
    const parsed = JSON.parse(fromBase64Url(payloadB64)) as PushOpenTokenPayload;
    if (!parsed?.u || typeof parsed.u !== "string") return { valid: false };
    if (!parsed?.exp || typeof parsed.exp !== "number") return { valid: false };
    if (Date.now() > parsed.exp) return { valid: false };

    return { valid: true, username: parsed.u };
  } catch {
    return { valid: false };
  }
}
