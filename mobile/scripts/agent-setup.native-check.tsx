/** @jsxImportSource ../../web/node_modules/react */
import { mount } from '../../web/src/test-support/render';
import { expect, mock, test } from 'bun:test';
import * as React from '../../web/node_modules/react';
import { resolve } from 'node:path';
mock.module(resolve(import.meta.dir, '../node_modules/react/index.js'), () => React);
const View = ({children,style}: any) => <div style={style}>{children}</div>;
const Pressable = ({children,onPress,accessibilityLabel,disabled}: any) => <button aria-label={accessibilityLabel} disabled={disabled} onClick={onPress}>{children}</button>;
mock.module(resolve(import.meta.dir, '../node_modules/react-native/index.js'), () => ({View, ScrollView:View, Image:()=>null, ActivityIndicator:()=>null, Pressable, Platform:{OS:'ios'}, StyleSheet:{hairlineWidth:1}, PanResponder:{create:()=>({panHandlers:{}})}}));
mock.module(import.meta.resolve('react-native-reanimated'), () => ({default:{View},useSharedValue:(value:any)=>React.useRef({value}).current,useAnimatedStyle:(fn:any)=>fn(),withTiming:(x:any)=>x}));
mock.module(import.meta.resolve('expo-haptics'), () => ({selectionAsync:async()=>{}}));
mock.module(import.meta.resolve('expo-symbols'), () => ({SymbolView:()=>null}));
mock.module(resolve(import.meta.dir,'../src/omg/sheet.tsx'), () => ({Sheet:({children}:any)=><section>{children}</section>}));
mock.module(resolve(import.meta.dir,'../src/omg/motion.tsx'), () => ({PressableScale:Pressable}));
mock.module(resolve(import.meta.dir,'../src/omg/text.tsx'), () => ({Text:({children}:any)=><span>{children}</span>,TextInput:({value,onChangeText,placeholder}:any)=><input value={value} placeholder={placeholder} onInput={e=>onChangeText(e.currentTarget.value)}/>}));
const { light, space, type, radius } = await import('../src/omg/palette');
mock.module(resolve(import.meta.dir,'../src/omg/theme.ts'), () => ({useTheme:()=>({colors:light,space,type,radius})}));
const { AgentSetupSheet } = await import('../src/omg/agent-setup-sheet');

test('agent choices stay available and model viewport survives short, long and empty lists',()=>{
 const ui=mount();
 try {
  function Fixture() {
   const [agent,setAgent]=React.useState(0);
   return <AgentSetupSheet visible onClose={()=>{}} agentOptions={['Claude','Codex','Gemini'].map((label,i)=>({label,selected:agent===i,onPress:()=>setAgent(i)}))} modelOptions={Array.from({length:[3,12,0][agent]},(_,i)=>({label:`Model ${i}`,selected:i===0}))}/>;
  }
  ui.render(<Fixture/>);
  const viewport=()=>Array.from(ui.queryAll('div')).find((n:any)=>n.style.height==='242px');
  expect(viewport()).toBeDefined();
  for(const agent of ['Codex','Gemini','Claude']) {
   ui.flush(()=> (ui.query(`button[aria-label="${agent} agent"]`) as HTMLElement).click());
   expect(viewport()).toBeDefined();
   expect(ui.queryAll('button')).toHaveLength(3 + (agent==='Codex'?12:agent==='Claude'?3:0));
   expect(ui.text()).toContain('No thinking level for this model');
  }
  const input=ui.query('input') as HTMLInputElement;
  ui.flush(()=>{input.value='nothing'; input.dispatchEvent(new Event('input',{bubbles:true}));});
  expect(ui.text()).toContain('No model matches');
  expect(viewport()).toBeDefined();
  ui.flush(()=> (ui.query('button[aria-label="Codex agent"]') as HTMLElement).click());
  expect((ui.query('input') as HTMLInputElement).value).toBe('');
  expect(ui.text()).toContain('Model 11');
 } finally {ui.cleanup();}
});
