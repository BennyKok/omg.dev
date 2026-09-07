/** upng-js ships no types. Only the three calls round-avatar.ts uses. */
declare module "upng-js" {
  export interface UpngImage {
    width: number;
    height: number;
  }
  export function decode(buffer: ArrayBuffer): UpngImage;
  export function toRGBA8(image: UpngImage): ArrayBuffer[];
  export function encode(
    frames: ArrayBuffer[],
    width: number,
    height: number,
    colorCount: number,
    delays?: number[],
  ): ArrayBuffer;
}
