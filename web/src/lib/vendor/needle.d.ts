export type NeedleModule = {
  HEAPU8: Uint8Array;
  _malloc(size: number): number;
  _free(pointer: number): void;
  _needle_load(pointer: number, size: bigint): number;
  _needle_last_error(): number;
  _needle_transcribe(pcm: number, samples: number, language: number, keywords: number, timestamps: number, out: number, capacity: number): number;
  UTF8ToString(pointer: number): string;
};
export default function createNeedle(options: { wasmBinary: Uint8Array }): Promise<NeedleModule>;
