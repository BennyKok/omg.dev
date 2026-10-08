/** @jsxImportSource ../../web/node_modules/react */
import { mount } from '../../web/src/test-support/render';
import { expect, mock, test } from 'bun:test';
import * as React from '../../web/node_modules/react';
import { resolve } from 'node:path';
mock.module(resolve(import.meta.dir, '../node_modules/react/index.js'), () => React);
let bindingId='a';
let readiness={status:'ready'};
let fetchPrices:()=>Promise<unknown>;
let calls=0;
const client={transport:{request:()=>{calls++;return fetchPrices();}}};
mock.module(resolve(import.meta.dir, '../src/omg/provider.tsx'),()=>({useOmg:()=>({client,bindingId,readiness,modelsVersion:0})}));
const {useModelPrices}=await import('../src/omg/use-model-prices');

// A stale response from a previous Computer must never classify new models.
test('pricing waits for readiness and discards previous Computer responses',async()=>{
 const ui=mount();let result!:ReturnType<typeof useModelPrices>;let enabled=false;
 function Fixture(){result=useModelPrices(enabled);return null;}
 let oldResolve!:(value:unknown)=>void;
 try {
  fetchPrices=()=>new Promise(resolve=>{oldResolve=resolve;});calls=0;
  ui.render(<Fixture/>);expect(calls).toBe(0);
  enabled=true;readiness={status:'waking'};ui.render(<Fixture/>);expect(calls).toBe(0);
  readiness={status:'ready'};ui.render(<Fixture/>);expect(calls).toBe(1);
  const price={inputPricePerMillion:100_000,outputPricePerMillion:500_000};
  bindingId='b';fetchPrices=async()=>({models:{new:price}});
  ui.render(<Fixture/>);expect(result.loading).toBe(true);expect(result.prices).toEqual({});
  await ui.flushAsync();expect(result.prices).toEqual({new:price});
  await ui.flushAsync(async()=>{oldResolve({models:{old:price}});});
  expect(result.prices).toEqual({new:price});
  bindingId='c';fetchPrices=async()=>{throw new Error('unavailable');};
  await ui.flushAsync(async()=>{ui.render(<Fixture/>);});
  expect(result.loading).toBe(false);expect(result.prices).toEqual({});
 } finally {ui.cleanup();}
});
