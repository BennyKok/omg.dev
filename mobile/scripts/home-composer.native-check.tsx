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
 FadeIn: chain,
 ReduceMotion:{Always:'always',Never:'never'},
 useSharedValue:(value:any)=>React.useRef({value}).current,
 useAnimatedStyle:(fn:any)=>fn(),
 withTiming:(x:any)=>x,
 withRepeat:(x:any)=>x,
}));
mock.module(import.meta.resolve('expo-symbols'), () => ({SymbolView:()=>null}));
const local = (file:string, exports:any) => mock.module(resolve(import.meta.dir, `../src/omg/${file}`), () => exports);
local('sheet.tsx',{Sheet:()=>null});
local('session-activity.tsx',{useSessionActivity:(active:boolean)=>({present:active}), SessionActivityTitle:({title}:any)=><span>{title}</span>, SessionActivityField:({activity}:any)=>activity.present?<div data-activity="active"/>:null});
local('text.tsx',{Text:View,TextInput:(props:any)=>{input=props;return <textarea value={props.value} readOnly/>;}});
local('agent-icons.ts',{agentIcon:()=>null});
local('model-provider-icons.ts',{modelProviderIcon:()=>null});
local('glass.tsx',{GlassSurface:View,LIQUID_GLASS:false});
local('lucide.tsx',{LucideIcon:()=>null});
local('usage.ts',{orderWindows:(x:any)=>x,providerKindForAgent:()=>undefined,detailsForKind:(_k:any,accounts:any,merged:any)=>accounts.length?accounts:merged});
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
  expect(ui.query('[data-activity="active"]')).not.toBeNull();
  ui.render(<SessionCard {...base} busy title="Renamed task"/>);
  expect(ui.query('[data-activity="active"]')).not.toBeNull();
  for(const state of [{busy:false},{busy:true,blocked:true},{busy:true,ended:true}]) {
   ui.render(<SessionCard {...base} {...state}/>);
   expect(ui.query('[data-activity]')).toBeNull();
  }
 } finally {ui.cleanup();}
});
/**
 * THE FIELD GROWS TO THREE LINES, AND YOGA IS WHAT GROWS IT.
 *
 * This test used to drive `onContentSizeChange` by hand and assert the
 * `height` that came back. It passed for a year while the real field on a
 * real phone stayed at ONE line and scrolled the text out of sight -- the bug
 * Benny reported on 2026-09-19 and this check could not see.
 *
 * The reason is that the old code was a measurement feedback loop, and under
 * the New Architecture the loop deadlocks: a multiline field carrying an
 * explicit `height` reports that same frame height back as its content size.
 * So `onContentSizeChange` fired with 24, which set the height to 24, which
 * measured 24, forever. A hand-written event with 72 in it is a number the
 * renderer would never actually send, so the test proved nothing.
 *
 * Assert the CONSTRAINTS now, not a round trip. `minHeight`/`maxHeight` with
 * no explicit height is a plain Yoga layout: there is no callback to deadlock,
 * and it is what the session composer already did correctly. The `undefined`
 * assertion on `onContentSizeChange` is the load-bearing one -- it is what
 * fails if anyone reintroduces the measurement.
 */
test('the live composer grows to three lines through layout, not measurement',()=>{
 const ui=mount();
 const render=(value:string)=>ui.render(<HomeComposer value={value} onChangeText={()=>{}} onStart={()=>{}} projectOptions={[]} agentOptions={[]} attachments={{items:[],options:[],remove:()=>{}}} dictation={{state:'idle',toggle:()=>{}}}/>);
 try {
  render('');
  // Empty is pinned to one line, so a sent prompt does not leave a tall box.
  expect(input.style.height).toBe(24);
  expect(input.multiline).toBe(true);
  expect(input.submitBehavior).toBe('newline');
  ui.flush(()=>input.onFocus?.());
  expect(input.style.height).toBe(24);

  render('A message that wraps to several lines');
  // No pin once there is text: Yoga sizes it between one and three lines.
  expect(input.style.height).toBeUndefined();
  expect(input.style.minHeight).toBe(24);
  expect(input.style.maxHeight).toBe(72);
  // Past three lines it scrolls; nothing is unreachable.
  expect(input.scrollEnabled).toBe(true);
  // Nothing measures the field. See the comment above -- this is the bug.
  expect(input.onContentSizeChange).toBeUndefined();

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

test('no-project starters stay visible through focus and send one prompt without replacing the field',()=>{
 const ui=mount();
 const sent:string[]=[];
 const base={onChangeText:()=>{},onStart:()=>{},projectOptions:[],agentOptions:[],attachments:{items:[],options:[],remove:()=>{}},dictation:{state:'idle' as const,toggle:()=>{}}};
 const render=(value='',starting=false,onStarter:((s:string)=>void)|undefined=(s)=>sent.push(s))=>ui.render(<HomeComposer {...base} value={value} starting={starting} onStarter={onStarter}/>);
 try {
  render();
  expect(ui.query('[aria-label^="Start website."]')).not.toBeNull();
  const field=ui.query('textarea');
  ui.flush(()=>input.onFocus?.());
  expect(ui.query('textarea')).toBe(field);
  expect(ui.text()).toContain('Website');
  expect(ui.text()).toContain('Design and publish a site');
  expect(ui.text()).toContain('Build a mobile or web app');
  expect(ui.text()).toContain('Create an endpoint or service');
  expect(ui.text()).toContain('Generate a custom visual');
  ui.flush(()=>input.onBlur?.());
  expect(ui.query('[aria-label^="Start website."]')).not.toBeNull();
  expect(ui.query('textarea')).toBe(field);
  ui.flush(()=>input.onFocus?.());
  expect(ui.query('textarea')).toBe(field);
  ui.flush(()=>ui.query<HTMLButtonElement>('[aria-label^="Start website."]')!.click());
  expect(sent).toEqual(['Help me create a website.']);
  render('',true);
  expect(ui.query<HTMLButtonElement>('[aria-label^="Start app."]')!.disabled).toBe(true);
  render('My own question');
  expect(ui.query('[aria-label^="Start website."]')).not.toBeNull();
  ui.render(<HomeComposer {...base} value=""/>);
  expect(ui.query('[aria-label^="Start website."]')).toBeNull();
 } finally {ui.cleanup();}
});
