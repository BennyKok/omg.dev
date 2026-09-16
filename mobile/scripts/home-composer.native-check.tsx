/** @jsxImportSource ../../web/node_modules/react */
import { mount } from '../../web/src/test-support/render';
import { expect, mock, test } from 'bun:test';
import * as React from '../../web/node_modules/react';
import { resolve } from 'node:path';
mock.module(resolve(import.meta.dir, '../node_modules/react/index.js'), () => React);
const View = ({children}: any) => <div>{children}</div>;
const Pressable = ({children,onPress,disabled,accessibilityLabel}: any) => <button aria-label={accessibilityLabel} disabled={disabled} onClick={onPress}>{children}</button>;
let input: any;
mock.module(resolve(import.meta.dir, '../node_modules/react-native/index.js'), () => ({View,ScrollView:View,Image:()=>null,ActivityIndicator:()=>null,Pressable,useWindowDimensions:()=>({width:393,height:400}),StyleSheet:{hairlineWidth:1,create:(s:any)=>s}}));
mock.module(import.meta.resolve('react-native-reanimated'), () => ({default:{View},Easing:{linear:(x:any)=>x},useSharedValue:(value:any)=>React.useRef({value}).current,useAnimatedStyle:(fn:any)=>fn(),withTiming:(x:any)=>x,withRepeat:(x:any)=>x}));
mock.module(import.meta.resolve('expo-symbols'), () => ({SymbolView:()=>null}));
const local = (file:string, exports:any) => mock.module(resolve(import.meta.dir, `../src/omg/${file}`), () => exports);
local('sheet.tsx',{Sheet:()=>null});
local('text.tsx',{Text:View,TextInput:(props:any)=>{input=props;return <textarea value={props.value} readOnly/>;}});
local('agent-icons.ts',{agentIcon:()=>null});
local('glass.tsx',{GlassSurface:View,LIQUID_GLASS:false});
local('lucide.tsx',{LucideIcon:()=>null});
local('usage.ts',{orderWindows:(x:any)=>x,providerKindForAgent:()=>undefined});
local('menu.tsx',{DropdownMenu:View});
local('agent-setup-sheet.tsx',{AgentSetupSheet:()=>null});
local('skill-suggest.tsx',{SkillSuggest:()=>null});
local('session-mention-suggest.tsx',{SessionMentionSuggest:()=>null});
local('motion.tsx',{PressableScale:Pressable,useListItemMotion:()=>({})});
local('swipe-row.ts',{useSwipeToCommit:()=>({})});
const { light, space, type, radius } = await import('../src/omg/palette');
local('theme.ts',{useTheme:()=>({colors:light,space,type,radius,isDark:false})});
const {HomeComposer}=await import('../src/components');
test('the live composer grows from measured text, caps scrolling, and resets after clearing',()=>{
 const ui=mount();
 const render=(value:string)=>ui.render(<HomeComposer value={value} onChangeText={()=>{}} onStart={()=>{}} projectOptions={[]} agentOptions={[]} attachments={{items:[],options:[],remove:()=>{}}} dictation={{state:'idle',toggle:()=>{}}}/>);
 try {
  render('');
  expect(input.style.height).toBe(24);
  expect(input.multiline).toBe(true);
  expect(input.submitBehavior).toBe('newline');
  ui.flush(()=>input.onFocus?.());
  expect(input.style.height).toBe(24);
  render('A message that wraps to several lines');
  ui.flush(()=>input.onContentSizeChange({nativeEvent:{contentSize:{height:72}}}));
  expect(input.style.height).toBe(72);
  expect(input.scrollEnabled).toBe(true);
  ui.flush(()=>input.onContentSizeChange({nativeEvent:{contentSize:{height:192}}}));
  expect(input.style.height).toBe(120);
  expect(input.scrollEnabled).toBe(true);
  render('Short');
  ui.flush(()=>input.onContentSizeChange({nativeEvent:{contentSize:{height:24}}}));
  expect(input.style.height).toBe(24);
  render('');
  expect(input.style.height).toBe(24);
  expect(input.scrollEnabled).toBe(true);
 } finally {ui.cleanup();}
});

test('typed text keeps voice beside send and recording uses the inline controls',()=>{
 const ui=mount();
 const base={onChangeText:()=>{},onStart:()=>{},projectOptions:[],agentOptions:[],attachments:{items:[],options:[],remove:()=>{}}};
 try {
  ui.render(<HomeComposer {...base} value="Typed prompt" dictation={{state:'idle',toggle:()=>{}}}/>);
  expect(ui.query('[aria-label="Dictate a prompt"]')).not.toBeNull();
  expect(ui.query('[aria-label="Start session"]')).not.toBeNull();
  ui.render(<HomeComposer {...base} value="Typed prompt" dictation={{state:'recording',toggle:()=>{},cancel:()=>{},level:0.5}}/>);
  expect(ui.query('[aria-label="Discard recording"]')).not.toBeNull();
  expect(ui.query('[aria-label="Finish recording"]')).not.toBeNull();
  expect(ui.query('[aria-label="Dictate a prompt"]')).toBeNull();
 } finally {ui.cleanup();}
});
