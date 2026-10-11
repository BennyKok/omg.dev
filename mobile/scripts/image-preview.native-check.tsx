/** @jsxImportSource ../../web/node_modules/react */
import { mount, type Mounted } from '../../web/src/test-support/render';
import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import * as React from '../../web/node_modules/react';
import { resolve } from 'node:path';

mock.module(resolve(import.meta.dir, '../node_modules/react/index.js'), () => React);
let nativeImages = 0;
mock.module(resolve(import.meta.dir, '../node_modules/react-native/index.js'), () => ({
  Image: () => { nativeImages++; return <span>native image</span>; },
  StyleSheet: { flatten: (style: unknown) => style },
}));
mock.module(import.meta.resolve('@shopify/react-native-skia'), () => ({
  Skia: {
    Data: { fromBase64: (bytes: string) => bytes },
    Image: { MakeImageFromEncoded: (bytes: string) => bytes === 'broken' ? null : { bytes } },
  },
  Canvas: ({ children, accessibilityLabel }: any) => <div aria-label={accessibilityLabel}>{children}</div>,
  Image: ({ image, width, height, fit }: any) => <span data-fit={fit} data-width={width} data-height={height}>{image.bytes}</span>,
}));
const { ImagePreview } = await import('../src/omg/image-preview');
let ui: Mounted;
beforeEach(() => { ui = mount(); nativeImages = 0; });
afterEach(() => ui.cleanup());
const preview = (bytes: string, style?: any) => <ImagePreview uri={`data:image/webp;base64,${bytes}`} width={200} height={250} radius={16} placeholderColor="#111" accessibilityLabel="Screenshot" style={style} />;

test('changing preview bytes replaces the bitmap without a recycled native image', () => {
  ui.render(preview('first'));
  expect(ui.text()).toBe('first');
  ui.render(preview('second'));
  expect(ui.text()).toBe('second');
  expect(nativeImages).toBe(0);
});

test('an unreadable replacement leaves a placeholder instead of the previous image', () => {
  ui.render(preview('first'));
  ui.render(preview('broken'));
  expect(ui.text()).toBe('');
  expect(ui.query('[aria-label="Screenshot"]')).not.toBeNull();
  expect(nativeImages).toBe(0);
});

test('image bytes still render when FileReader supplies a generic or empty MIME type', () => {
  for (const type of ['application/octet-stream', '']) {
    ui.render(<ImagePreview uri={`data:${type};base64,screenshot`} width={200} height={250} radius={16} placeholderColor="#111" accessibilityLabel="Screenshot" />);
    expect(ui.text()).toBe('screenshot');
  }
});

test('screenshots keep contain fitting and their bounded dimensions', () => {
  ui.render(preview('screenshot', { resizeMode: 'contain' }));
  const picture = ui.query('span')!;
  expect(picture.getAttribute('data-fit')).toBe('contain');
  expect(picture.getAttribute('data-width')).toBe('200');
  expect(picture.getAttribute('data-height')).toBe('250');
});
