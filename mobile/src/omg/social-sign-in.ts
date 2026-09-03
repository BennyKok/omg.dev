import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";
import { Platform } from "react-native";

import { signInWithIdToken, type SignedInUser } from "./auth";
import { GOOGLE_IOS_CLIENT_ID, GOOGLE_WEB_CLIENT_ID } from "./config";

/**
 * Native sign-in that ends in the same place as the email code: a session
 * cookie in the platform jar, followed by the caller's `refreshSession()`.
 *
 * Both flows resolve to `null` when the person dismissed the sheet. Cancelling
 * is not an error and must not toast one.
 */

export const googleSignInConfigured = Boolean(GOOGLE_IOS_CLIENT_ID);

export async function appleSignInAvailable(): Promise<boolean> {
  if (Platform.OS !== "ios") return false;
  return AppleAuthentication.isAvailableAsync();
}

export async function signInWithApple(): Promise<SignedInUser | null> {
  // Apple returns the SHA-256 of the nonce it was given inside the identity
  // token. Hand Apple the hash and the server the raw value; better-auth
  // hashes the raw value to compare.
  const nonce = Crypto.randomUUID();
  const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonce);
  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashedNonce,
    });
  } catch (error) {
    if ((error as { code?: string })?.code === "ERR_REQUEST_CANCELED") return null;
    throw error;
  }
  if (!credential.identityToken) {
    throw new Error("Apple did not return an identity token. Try again.");
  }
  const name =
    credential.fullName?.givenName || credential.fullName?.familyName
      ? {
          firstName: credential.fullName?.givenName ?? undefined,
          lastName: credential.fullName?.familyName ?? undefined,
        }
      : undefined;
  return signInWithIdToken("apple", credential.identityToken, {
    nonce,
    name,
    email: credential.email ?? undefined,
  });
}

export async function signInWithGoogle(): Promise<SignedInUser | null> {
  if (!googleSignInConfigured) {
    throw new Error("Google sign-in is not configured in this build.");
  }
  // Loaded lazily: the native module throws at import when the URL scheme is
  // absent from the binary, and this module must still load on such builds.
  const { GoogleSignin, isSuccessResponse, isErrorWithCode, statusCodes } = await import(
    "@react-native-google-signin/google-signin"
  );
  GoogleSignin.configure({
    // The id token's audience. Must match the server's GOOGLE_CLIENT_ID.
    webClientId: GOOGLE_WEB_CLIENT_ID,
    iosClientId: GOOGLE_IOS_CLIENT_ID,
  });
  try {
    await GoogleSignin.hasPlayServices();
    const response = await GoogleSignin.signIn();
    if (!isSuccessResponse(response)) return null;
    const idToken = response.data.idToken;
    if (!idToken) throw new Error("Google did not return an id token. Try again.");
    return await signInWithIdToken("google", idToken);
  } catch (error) {
    if (isErrorWithCode(error) && error.code === statusCodes.SIGN_IN_CANCELLED) return null;
    throw error;
  }
}
