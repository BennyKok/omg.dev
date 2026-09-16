/** @jsxImportSource ../../web/node_modules/react */
import { mount } from '../../web/src/test-support/render';
import { expect, mock, test } from 'bun:test';
import * as React from '../../web/node_modules/react';
import { resolve } from 'node:path';
mock.module(resolve(import.meta.dir, '../node_modules/react/index.js'), () => React);
let input: any;
mock.module(resolve(import.meta.dir, '../node_modules/react-native/index.js'), () => ({
 Text: ({children}: any) => <span>{children}</span>,
 TextInput: (props: any) => { input=props; return <textarea/>; },
}));
const { TextInput } = await import('../src/omg/text');
const { NavGestureContext } = await import('../src/omg/nav-gesture-context');

test('input touch excludes navigation and preserves the callers touch handler',()=>{
 const ui=mount();const calls:string[]=[];const event={nativeEvent:{pageX:10}};
 try {
  ui.render(<NavGestureContext.Provider value={()=>calls.push('blocked')}>
   <TextInput multiline onTouchStart={e=>{expect(e).toBe(event as any);calls.push('input');}}/>
  </NavGestureContext.Provider>);
  ui.flush(()=>input.onTouchStart(event));
  expect(calls).toEqual(['blocked','input']);
  ui.render(<TextInput/>);
  expect(()=>input.onTouchStart(event)).not.toThrow();
 } finally {ui.cleanup();}
});
