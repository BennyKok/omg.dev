/** @jsxImportSource ../../web/node_modules/react */
import { mount } from '../../web/src/test-support/render';
import { expect, mock, test } from 'bun:test';
import * as React from '../../web/node_modules/react';
import { resolve } from 'node:path';
mock.module(resolve(import.meta.dir, '../node_modules/react/index.js'), () => React);
const responders: any[] = [];
const View = ({children,style,accessibilityLabel,onLayout}: any) => {
 React.useLayoutEffect(() => { onLayout?.({nativeEvent:{layout:{width:400}}}); }, []);
 return <div aria-label={accessibilityLabel} style={Array.isArray(style) ? Object.assign({}, ...style) : style}>{children}</div>;
};
const Pressable = ({children,onPress,onLongPress,accessibilityLabel,disabled}: any) => <button aria-label={accessibilityLabel} disabled={disabled} onClick={onPress} onContextMenu={e=>{e.preventDefault();onLongPress?.();}}>{children}</button>;
mock.module(resolve(import.meta.dir, '../node_modules/react-native/index.js'), () => ({View, ScrollView:View, Image:()=>null, ActivityIndicator:()=>null, Pressable, Platform:{OS:'ios'}, StyleSheet:{hairlineWidth:1}, PanResponder:{create:(handlers:any)=>{responders.push(handlers);return {panHandlers:{}};}}}));
mock.module(import.meta.resolve('react-native-reanimated'), () => ({default:{View},useSharedValue:(value:any)=>React.useRef({value}).current,useAnimatedStyle:(fn:any)=>fn(),withTiming:(x:any)=>x}));
let haptics = 0;
mock.module(import.meta.resolve('expo-haptics'), () => ({selectionAsync:async()=>{haptics++;}}));
mock.module(import.meta.resolve('expo-linear-gradient'), () => ({LinearGradient:View}));
mock.module(import.meta.resolve('expo-symbols'), () => ({SymbolView:()=>null}));
mock.module(resolve(import.meta.dir,'../src/omg/sheet.tsx'), () => ({Sheet:({children}:any)=><section>{children}</section>}));
mock.module(resolve(import.meta.dir,'../src/omg/motion.tsx'), () => ({PressableScale:Pressable,useReduceMotionEnabled:()=>false}));
mock.module(resolve(import.meta.dir,'../src/omg/text.tsx'), () => ({Text:({children}:any)=><span>{children}</span>,TextInput:({value,onChangeText,placeholder}:any)=><input value={value} placeholder={placeholder} onInput={e=>onChangeText(e.currentTarget.value)}/>}));
mock.module(import.meta.resolve('react-native-gesture-handler'), () => ({NativeViewGestureHandler:View}));
const { light, space, type, radius } = await import('../src/omg/palette');
mock.module(resolve(import.meta.dir,'../src/omg/theme.ts'), () => ({useTheme:()=>({colors:light,space,type,radius})}));
const { AgentSetupSheet, Slider, thinkingDotScale } = await import('../src/omg/agent-setup-sheet');

test('compact controls open searchable models and return after choosing',()=>{
 const ui=mount();
 let picked='Model 0';
 try {
  function Fixture() {
   const [agent,setAgent]=React.useState(0);
   const [model,setModel]=React.useState(0);
   return <AgentSetupSheet visible onClose={()=>{}} agentOptions={['Claude','Codex'].map((label,i)=>({id:i?'codex-aisdk':'aisdk',label,selected:agent===i,onPress:()=>setAgent(i)}))}
    modelOptions={Array.from({length:60},(_,i)=>({label:`Model ${i}`,selected:i===model,onPress:()=>{picked=`Model ${i}`;setModel(i);}}))}
    thinkingOptions={[{label:'Low'},{label:'High',selected:true},{label:'Max'}]}/>;
  }
  ui.render(<Fixture/>);
  expect(ui.query('input')).toBeNull();
  expect(ui.text()).not.toContain('Thinking');
  expect(ui.text()).not.toContain('Low');
  expect(ui.text()).toContain('High');
  ui.flush(()=> (ui.query('button[aria-label^="Model Model 0"]') as HTMLElement).click());
  const input=ui.query('input') as HTMLInputElement;
  expect(input).not.toBeNull();
  expect(ui.text()).toContain('Model 59');
  ui.flush(()=>{input.value='59';input.dispatchEvent(new Event('input',{bubbles:true}));});
  expect(ui.text()).not.toContain('Model 58');
  const row=Array.from(ui.queryAll('button')).find(n=>n.textContent==='Model 59') as HTMLElement;
  ui.flush(()=>row.click());
  expect(picked).toBe('Model 59');
  expect(ui.query('input')).toBeNull();
  expect(ui.text()).toContain('Model 59');
  ui.flush(()=> (ui.query('button[aria-label^="Model Model 59"]') as HTMLElement).click());
  expect((ui.query('input') as HTMLInputElement).value).toBe('');
  ui.flush(()=>{const q=ui.query('input') as HTMLInputElement;q.value='absent';q.dispatchEvent(new Event('input',{bubbles:true}));});
  expect(ui.text()).toContain('No model matches');
 } finally {ui.cleanup();}
});

test('long press reveals indexed profiles and selecting returns to controls',()=>{
 const ui=mount();let selected='Auto';
 try {
  ui.render(<AgentSetupSheet visible onClose={()=>{}} agentOptions={[{id:'aisdk',label:'Claude',selected:true}]}
   accountOptions={['Auto','1','2'].map(label=>({label,selected:label==='Auto',disabled:label==='2',onPress:()=>{selected=label;}}))}/>);
  expect(ui.text()).not.toContain('Auto');
  ui.flush(()=> (ui.query('[aria-label="Claude agent"]') as HTMLElement).dispatchEvent(new Event('contextmenu',{bubbles:true})));
  expect(ui.text()).toContain('Claude profile');
  expect(ui.query('[aria-label="Claude 2"]')?.hasAttribute('disabled')).toBe(true);
  ui.flush(()=> (ui.query('[aria-label="Claude 1"]') as HTMLElement).click());
  expect(selected).toBe('1');
  expect(ui.text()).not.toContain('Claude profile');
 } finally {ui.cleanup();}
});

test('Fast has an accessible switch without a visible label',()=>{
 const ui=mount();let taps=0;
 try {
  ui.render(<AgentSetupSheet visible onClose={()=>{}} agentOptions={[{label:'Claude'}]} onToggleFast={()=>taps++}/>);
  expect(ui.text()).not.toContain('Fast');
  ui.flush(()=> (ui.query('[aria-label="Fast mode"]') as HTMLElement).click());
  expect(taps).toBe(1);
 } finally {ui.cleanup();}
});

test('the whole thinking bar previews, cancels, and commits through the current callback',()=>{
 const ui=mount();const choices:string[]=[];
 const options=[{label:'Low'},{label:'Medium',selected:true},{label:'High'},{label:'Max'}];
 try {
  const start=responders.length;
  ui.render(<Slider options={options} onPick={o=>choices.push('old '+o.label)}/>);
  const gesture=responders[start];
  const at=(locationX:number)=>({nativeEvent:{locationX}});
  ui.flush(()=>gesture.onPanResponderGrant(at(5)));
  expect(ui.text()).toBe('Low');
  ui.flush(()=>gesture.onPanResponderMove(at(390)));
  expect(ui.text()).toBe('Max');
  expect(choices).toEqual([]);
  ui.flush(()=>gesture.onPanResponderTerminate());
  expect(ui.text()).toBe('Medium');
  ui.render(<Slider options={options} onPick={o=>choices.push(o.label)}/>);
  ui.flush(()=>gesture.onPanResponderGrant(at(20)));
  ui.flush(()=>gesture.onPanResponderRelease(at(390)));
  expect(choices).toEqual(['Max']);
  ui.flush(()=>gesture.onPanResponderRelease(at(150)));
  expect(choices).toEqual(['Max']);
 } finally {ui.cleanup();}
});


test('dragging gives one haptic per new enabled step and does not commit on cancel',()=>{
 const ui=mount(); const choices:string[]=[];
 try {
  const start=responders.length; haptics=0;
  ui.render(<Slider options={[{label:'Low',selected:true},{label:'Medium'},{label:'High',disabled:true},{label:'Max'}]} onPick={o=>choices.push(o.label)}/>);
  const gesture=responders[start]; const at=(locationX:number)=>({nativeEvent:{locationX}});
  ui.flush(()=>gesture.onPanResponderGrant(at(20)));
  expect(haptics).toBe(0);
  ui.flush(()=>gesture.onPanResponderMove(at(130)));
  expect(haptics).toBe(1);
  expect(ui.text()).toBe('Medium');
  ui.flush(()=>gesture.onPanResponderMove(at(150)));
  expect(haptics).toBe(1);
  ui.flush(()=>gesture.onPanResponderMove(at(250)));
  expect(haptics).toBe(1);
  expect(ui.text()).toBe('Medium');
  ui.flush(()=>gesture.onPanResponderMove(at(350)));
  expect(haptics).toBe(2);
  ui.flush(()=>gesture.onPanResponderRelease(at(350)));
  expect(haptics).toBe(2);
  expect(choices).toEqual(['Max']);
 } finally {ui.cleanup();}
});

test('usage ring opens one detail page with reset information and a return path',()=>{
 const ui=mount();
 try {
  ui.render(<AgentSetupSheet visible onClose={()=>{}} agentOptions={[{label:'Claude'}]} usageRing={<span>ring</span>}
   usageDetails={<span>Weekly · Next reset in 2d</span>}/>);
  ui.flush(()=>(ui.query('[aria-label="Usage and next resets"]') as HTMLElement).click());
  expect(ui.text()).toContain('Weekly · Next reset in 2d');
  ui.flush(()=>(ui.query('[aria-label="Back to agent controls"]') as HTMLElement).click());
  expect(ui.text()).not.toContain('Weekly');
  expect(ui.text()).toContain('Claude');
 } finally {ui.cleanup();}
});


test('dots grow continuously with finger proximity and settle at their original size',()=>{
 expect(thinkingDotScale(0,100,1)).toBeCloseTo(2.8);
 expect(thinkingDotScale(25,100,1)).toBeGreaterThan(thinkingDotScale(50,100,1));
 expect(thinkingDotScale(50,100,1)).toBeGreaterThan(thinkingDotScale(100,100,1));
 expect(thinkingDotScale(-50,100,1)).toBe(thinkingDotScale(50,100,1));
 expect(thinkingDotScale(150,100,1)).toBe(1);
 expect(thinkingDotScale(0,100,0)).toBe(1);
 expect(thinkingDotScale(0,100,0.5)).toBeCloseTo(1.9);
});
