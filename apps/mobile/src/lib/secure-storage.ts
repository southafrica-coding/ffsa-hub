// "Large secure store" for the Supabase session.
//
// A session JSON (access + refresh token + user) is several KB, more than the
// keychain/keystore is meant to hold per value. So per item:
//   - two random 256-bit keys (AES + HMAC) live in expo-secure-store
//     (iOS Keychain / Android Keystore),
//   - the AES-256-CTR ciphertext + HMAC-SHA256 tag live in AsyncStorage.
// Without the keychain entry, the AsyncStorage blob is useless. The HMAC
// (encrypt-then-MAC) means a wrong key or corrupted blob is detected and read
// as "no session" instead of handing garbage to supabase-js.
//
// Never log values from here: they are auth tokens.

import AsyncStorage from "@react-native-async-storage/async-storage";
import aesjs from "aes-js";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";

const FORMAT_VERSION = 1;
const KEY_BYTES = 32;
const IV_BYTES = 16;
const SHA256_BLOCK = 64;

type Envelope = { v: number; iv: string; data: string; mac: string };

// SecureStore keys may only contain [A-Za-z0-9._-].
function secureKeyName(key: string) {
  return `${key.replace(/[^A-Za-z0-9._-]/g, "_")}.key`;
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

async function sha256(data: Uint8Array<ArrayBuffer>) {
  return new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, data));
}

// RFC 2104 HMAC over SHA-256 (key is always 32 bytes, so no pre-hashing).
export async function hmacSha256(key: Uint8Array, message: Uint8Array) {
  const block = new Uint8Array(SHA256_BLOCK);
  block.set(key);
  const ipad = block.map((b) => b ^ 0x36);
  const opad = block.map((b) => b ^ 0x5c);
  return sha256(concat(opad, await sha256(concat(ipad, message))));
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

const hex = aesjs.utils.hex;
const utf8 = aesjs.utils.utf8;

function macInput(iv: Uint8Array, data: Uint8Array) {
  return concat(new Uint8Array([FORMAT_VERSION]), iv, data);
}

async function decrypt(keyHex: string, blob: string): Promise<string | null> {
  const keys = hex.toBytes(keyHex);
  if (keys.length !== KEY_BYTES * 2) return null;
  const encKey = keys.slice(0, KEY_BYTES);
  const macKey = keys.slice(KEY_BYTES);

  const env = JSON.parse(blob) as Partial<Envelope>;
  if (env.v !== FORMAT_VERSION || !env.iv || !env.data || !env.mac) return null;
  const iv = hex.toBytes(env.iv);
  const data = hex.toBytes(env.data);
  if (iv.length !== IV_BYTES) return null;

  const expected = await hmacSha256(macKey, macInput(iv, data));
  if (!constantTimeEqual(expected, hex.toBytes(env.mac))) return null;

  const ctr = new aesjs.ModeOfOperation.ctr(encKey, new aesjs.Counter(iv));
  return utf8.fromBytes(ctr.decrypt(data));
}

export const largeSecureStore = {
  async getItem(key: string): Promise<string | null> {
    try {
      const [keyHex, blob] = await Promise.all([
        SecureStore.getItemAsync(secureKeyName(key)),
        AsyncStorage.getItem(key),
      ]);
      if (!keyHex || !blob) return null;
      return await decrypt(keyHex, blob);
    } catch {
      // Corrupt data, wrong key or an unavailable keychain all read as
      // "signed out". Deliberately no logging: the inputs are secrets.
      return null;
    }
  },

  async setItem(key: string, value: string): Promise<void> {
    // Fresh keys and IV on every write: no key/counter reuse across sessions.
    const encKey = Crypto.getRandomBytes(KEY_BYTES);
    const macKey = Crypto.getRandomBytes(KEY_BYTES);
    const iv = Crypto.getRandomBytes(IV_BYTES);

    const ctr = new aesjs.ModeOfOperation.ctr(encKey, new aesjs.Counter(iv));
    const data = ctr.encrypt(utf8.toBytes(value));
    const mac = await hmacSha256(macKey, macInput(iv, data));

    const envelope: Envelope = {
      v: FORMAT_VERSION,
      iv: hex.fromBytes(iv),
      data: hex.fromBytes(data),
      mac: hex.fromBytes(mac),
    };
    await SecureStore.setItemAsync(secureKeyName(key), hex.fromBytes(concat(encKey, macKey)));
    await AsyncStorage.setItem(key, JSON.stringify(envelope));
  },

  async removeItem(key: string): Promise<void> {
    await Promise.all([
      SecureStore.deleteItemAsync(secureKeyName(key)),
      AsyncStorage.removeItem(key),
    ]);
  },
};
