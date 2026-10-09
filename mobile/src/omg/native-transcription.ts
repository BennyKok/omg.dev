import AsyncStorage from "@react-native-async-storage/async-storage";
import { requireOptionalNativeModule } from "expo";
import { useEffect, useSyncExternalStore } from "react";
import { NativeTranscription, type NativeTranscriptionEngine } from "./native-transcription-state";

export const nativeTranscription = new NativeTranscription(
  requireOptionalNativeModule<NativeTranscriptionEngine>("OmgWhistle"), AsyncStorage,
);
export function useNativeTranscription() {
  const state = useSyncExternalStore(nativeTranscription.subscribe, nativeTranscription.getSnapshot);
  useEffect(() => { void nativeTranscription.initialize(); }, []);
  return state;
}
