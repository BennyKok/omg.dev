/** @jsxImportSource ../../web/node_modules/react */
import { mount } from '../../web/src/test-support/render';
import { expect, mock, test } from 'bun:test';
import * as React from '../../web/node_modules/react';
import { resolve } from 'node:path';
mock.module(resolve(import.meta.dir, '../node_modules/react/index.js'), () => React);
let glyph: any;
mock.module(resolve(import.meta.dir, '../node_modules/react-native/index.js'), () => ({
  Text: (props:any) => { glyph=props; return <span>{props.children}</span>; },
}));
mock.module(import.meta.resolve('expo-font'), () => ({ useFonts: () => [true, null] }));
const { LucideIcon } = await import('../src/omg/lucide');
test('the project plus uses the bundled glyph and stays inside its fixed icon box', () => {
  const ui=mount();
  try {
    ui.render(<LucideIcon name="plus" size={18} color="#fff"/>);
    expect(ui.text()).toBe(String.fromCodePoint(0xe13d));
    expect(glyph.allowFontScaling).toBe(false);
    expect(glyph.style.width).toBe(18);
    expect(glyph.style.height).toBe(18);
    expect(glyph.style.lineHeight).toBe(18);
  } finally { ui.cleanup(); }
});
