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
// A chainable stub for the layout-transition builders: every method returns
// the builder, so `.duration().easing().reduceMotion()` resolves to an object
// the mocked views simply ignore.
const chain: any = new Proxy({}, {get:()=>()=>chain});
mock.module(import.meta.resolve('react-native-reanimated'), () => ({
 default:{View, createAnimatedComponent:(C:any)=>C},
 Easing:{linear:(x:any)=>x, bezier:()=>(x:any)=>x},
 LinearTransition: chain,
 ReduceMotion:{Always:'always',Never:'never'},
 useSharedValue:(value:any)=>React.useRef({value}).current,
 useAnimatedStyle:(fn:any)=>fn(),
 withTiming:(x:any)=>x,
 withRepeat:(x:any)=>x,
}));
mock.module(import.meta.resolve('expo-symbols'), () => ({SymbolView:()=>null}));
const local = (file:string, exports:any) => mock.module(resolve(import.meta.dir, `../src/omg/${file}`), () => exports);
local('sheet.tsx',{Sheet:()=>null});
local('session-activity.tsx',{SessionActivityField:({identity}:any)=><div data-activity={identity}/>});
local('text.tsx',{Text:View,TextInput:(props:any)=>{input=props;return <textarea value={props.value} readOnly/>;}});
local('agent-icons.ts',{agentIcon:()=>null});
local('glass.tsx',{GlassSurface:View,LIQUID_GLASS:false});
local('lucide.tsx',{LucideIcon:()=>null});
local('usage.ts',{orderWindows:(x:any)=>x,providerKindForAgent:()=>undefined});
local('menu.tsx',{DropdownMenu:View});
local('agent-setup-sheet.tsx',{AgentSetupSheet:()=>null});
local('skill-suggest.tsx',{SkillSuggest:()=>null});
local('session-mention-suggest.tsx',{SessionMentionSuggest:()=>null});
local('motion.tsx',{PressableScale:Pressable,useListItemMotion:()=>({}),useReduceMotionEnabled:()=>false});
local('swipe-row.ts',{useSwipeToCommit:()=>({})});
const { light, space, type, radius, motion } = await import('../src/omg/palette');
local('theme.ts',{useTheme:()=>({colors:light,space,type,radius,motion,isDark:false})});
const {HomeComposer,SessionCard}=await import('../src/components');
test('only working session rows have an activity field',()=>{
 const ui=mount();
 const base={sessionId:'stable-id',title:'Task',onPress:()=>{},animateEntry:false};
 try {
  ui.render(<SessionCard {...base} busy/>);
  expect(ui.query('[data-activity="stable-id"]')).not.toBeNull();
  ui.render(<SessionCard {...base} busy title="Renamed task"/>);
  expect(ui.query('[data-activity="stable-id"]')).not.toBeNull();
  for(const state of [{busy:false},{busy:true,blocked:true},{busy:true,ended:true}]) {
   ui.render(<SessionCard {...base} {...state}/>);
   expect(ui.query('[data-activity]')).toBeNull();
  }
 } finally {ui.cleanup();}
});
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

/**
 * FOCUSING MUST NOT RECREATE THE FIELD.
 *
 * The composer morphs when it gains focus, and it used to do that by swapping
 * between two different child orders. React reconciles unkeyed siblings by
 * POSITION, so the TextInput moved from index 1 to index 0 and was unmounted
 * and remounted instead of updated.
 *
 * Two reports came from that one remount. The first tap did not open the
 * keyboard, because focusing destroyed the field that had just taken focus.
 * And the composer never morphed back, because a destroyed field cannot
 * deliver its `onBlur`, so the focused flag stayed true forever.
 *
 * The DOM node is the evidence: React replaces it on a remount and keeps it on
 * an update. A test that only checked which controls were on screen passed
 * through the whole bug.
 */
test('the field survives the morph, so the keyboard it just opened stays open',()=>{
 const ui=mount();
 const base={onChangeText:()=>{},onStart:()=>{},projectOptions:[],agentOptions:[],attachments:{items:[],options:[],remove:()=>{}}};
 try {
  ui.render(<HomeComposer {...base} value="" dictation={{state:'idle',toggle:()=>{}}}/>);
  const collapsed = ui.query('textarea');
  expect(collapsed).not.toBeNull();
  // Tap: the field takes focus and the composer expands around it.
  ui.flush(()=>input.onFocus?.());
  expect(ui.query('textarea')).toBe(collapsed);
  // And back again when focus leaves, which is the half that stayed stuck.
  ui.flush(()=>input.onBlur?.());
  expect(ui.query('textarea')).toBe(collapsed);
 } finally {ui.cleanup();}
});

/** The same slot has to hold while text arrives, which expands it too. */
test('the field survives expanding because of typed text',()=>{
 const ui=mount();
 const base={onChangeText:()=>{},onStart:()=>{},projectOptions:[],agentOptions:[],attachments:{items:[],options:[],remove:()=>{}}};
 try {
  ui.render(<HomeComposer {...base} value="" dictation={{state:'idle',toggle:()=>{}}}/>);
  const field = ui.query('textarea');
  ui.render(<HomeComposer {...base} value="Typed" dictation={{state:'idle',toggle:()=>{}}}/>);
  expect(ui.query('textarea')).toBe(field);
  ui.render(<HomeComposer {...base} value="" dictation={{state:'idle',toggle:()=>{}}}/>);
  expect(ui.query('textarea')).toBe(field);
 } finally {ui.cleanup();}
});
