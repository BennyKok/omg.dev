import { dlopen, ptr, toArrayBuffer, type Pointer } from "bun:ffi";

export interface SigningVault {
  read(account: string): Promise<string | null>;
  write(account: string, value: string): Promise<void>;
  remove?(account: string): Promise<void>;
}

export interface KeychainStore {
  read(account: string): string | null;
  write(account: string, value: string): void;
  remove(account: string): void;
}

/** The signing record stays in the user's macOS login Keychain. No secrets
 * are passed to a command line, an environment variable, or a web response. */
export function macKeychainStore(): KeychainStore {
  if (process.platform !== "darwin") throw new Error("iOS setup requires a Mac.");
  const security = dlopen("/System/Library/Frameworks/Security.framework/Security", {
    SecKeychainFindGenericPassword: { args: ["ptr", "u32", "ptr", "u32", "ptr", "ptr", "ptr", "ptr"], returns: "i32" },
    SecKeychainAddGenericPassword: { args: ["ptr", "u32", "ptr", "u32", "ptr", "u32", "ptr", "ptr"], returns: "i32" },
    SecKeychainItemModifyAttributesAndData: { args: ["ptr", "ptr", "u32", "ptr"], returns: "i32" },
    SecKeychainItemFreeContent: { args: ["ptr", "ptr"], returns: "i32" },
    SecKeychainItemDelete: { args: ["ptr"], returns: "i32" },
  });
  const core = dlopen("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation", {
    CFRelease: { args: ["ptr"], returns: "void" },
  });
  const service = Buffer.from("dev.omg.ios-testing.signing.v1");
  function lookup(account: string) {
    const name = Buffer.from(account);
    const length = new Uint32Array(1);
    const data = new BigUint64Array(1);
    const item = new BigUint64Array(1);
    const status = security.symbols.SecKeychainFindGenericPassword(
      null, service.length, ptr(service), name.length, ptr(name), ptr(length), ptr(data), ptr(item),
    );
    return { status, length: length[0], data: Number(data[0]) as Pointer, item: Number(item[0]) as Pointer };
  }
  function check(status: number) {
    if (status !== 0) throw new Error(`Allow omg.dev to use the login Keychain, then try again (macOS ${status}).`);
  }
  return {
    remove(account) {
      const result = lookup(account);
      if (result.status === -25300) return;
      check(result.status);
      try { check(security.symbols.SecKeychainItemDelete(result.item)); }
      finally { security.symbols.SecKeychainItemFreeContent(null, result.data); core.symbols.CFRelease(result.item); }
    },
    read(account) {
      const result = lookup(account);
      if (result.status === -25300) return null;
      check(result.status);
      try {
        if (result.length > 8 * 1024 * 1024) throw new Error("The local signing record is too large.");
        return Buffer.from(toArrayBuffer(result.data, 0, result.length)).toString("utf8");
      } finally {
        security.symbols.SecKeychainItemFreeContent(null, result.data);
        core.symbols.CFRelease(result.item);
      }
    },
    write(account, value) {
      const bytes = Buffer.from(value);
      if (bytes.length > 8 * 1024 * 1024) throw new Error("The local signing record is too large.");
      const result = lookup(account);
      try {
        if (result.status === -25300) {
          const name = Buffer.from(account);
          check(security.symbols.SecKeychainAddGenericPassword(
            null, service.length, ptr(service), name.length, ptr(name), bytes.length, ptr(bytes), null,
          ));
        } else {
          check(result.status);
          check(security.symbols.SecKeychainItemModifyAttributesAndData(result.item, null, bytes.length, ptr(bytes)));
        }
      } finally {
        bytes.fill(0);
        if (result.status === 0) {
          security.symbols.SecKeychainItemFreeContent(null, result.data);
          core.symbols.CFRelease(result.item);
        }
      }
    },
  };
}

export function macSigningVault(): SigningVault {
  const store = macKeychainStore();
  return {
    read: async (account) => store.read(account),
    write: async (account, value) => store.write(account, value),
    remove: async (account) => store.remove(account),
  };
}
