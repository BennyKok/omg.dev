/** @jsxImportSource ../../web/node_modules/react */
import { mount } from '../../web/src/test-support/render';
import { expect, mock, test } from 'bun:test';
import * as React from '../../web/node_modules/react';
import { resolve } from 'node:path';
mock.module(resolve(import.meta.dir,'../node_modules/react/index.js'),()=>React);
let handlers:any;
const View=({children}:any)=><div>{children}</div>;
mock.module(resolve(import.meta.dir,'../node_modules/react-native/index.js'),()=>({BackHandler:{addEventListener:()=>({remove(){}})},useWindowDimensions:()=>({width:430,height:932}),View,Pressable:View,ScrollView:View,Keyboard:{dismiss(){}},Platform:{OS:'ios'},StyleSheet:{absoluteFill:{}},PanResponder:{create:(h:any)=>{handlers=h;return{panHandlers:{}}}}}));
mock.module(import.meta.resolve('react-native-reanimated'),()=>({default:{View},Easing:{out:(x:any)=>x,cubic:()=>{}},cancelAnimation(){},runOnJS:(f:any)=>f,useAnimatedStyle:(f:any)=>f(),withTiming:(n:any)=>n}));
mock.module(import.meta.resolve('react-native-safe-area-context'),()=>({useSafeAreaInsets:()=>({top:0,bottom:0})}));
for(const [file,exports] of Object.entries({'components.tsx':{Icon:View,StatusDot:View},'omg/brand-mark.tsx':{BrandWordmark:View},'omg/glass.tsx':{GlassSurface:View},'omg/menu.tsx':{DropdownMenu:View},'omg/motion.tsx':{PressableScale:View,useReduceMotionEnabled:()=>false},'omg/lucide.tsx':{LucideIcon:View},'omg/text.tsx':{Text:View},'omg/theme.ts':{useTheme:()=>({})}}))mock.module(resolve(import.meta.dir,'../src',file),()=>exports);
const {useSideNavGesture}=await import('../src/omg/side-nav');

test('folder touches never open navigation; the next edge swipe and open-drawer closing still work',()=>{
 const ui=mount();let controller:ReturnType<typeof useSideNavGesture>;let opens=0;
 const progress={value:0};
 function Fixture({visible=false,enabled=true}:{visible?:boolean;enabled?:boolean}){controller=useSideNavGesture({visible,enabled,progress:progress as any,width:300,onOpen:()=>opens++,onClose:()=>{}});return null;}
 const drag={x0:10,dx:80,dy:2,vx:1};
 try{
  ui.render(<Fixture/>);
  expect(handlers.onStartShouldSetPanResponderCapture()).toBe(false);
  controller!.blockOpeningGesture();
  expect(handlers.onMoveShouldSetPanResponderCapture(null,drag)).toBe(false);
  // Leaving the rail or reaching its boundary must not transfer the drag.
  expect(handlers.onMoveShouldSetPanResponderCapture(null,{...drag,dx:200,dy:30})).toBe(false);
  expect(opens).toBe(0);
  handlers.onStartShouldSetPanResponderCapture();
  expect(handlers.onMoveShouldSetPanResponderCapture(null,drag)).toBe(true);
  expect(handlers.onMoveShouldSetPanResponderCapture(null,{...drag,x0:100})).toBe(false);
  expect(handlers.onMoveShouldSetPanResponderCapture(null,{...drag,dy:100})).toBe(false);
  ui.flush(()=>handlers.onPanResponderGrant());
  expect(opens).toBe(1);
  ui.render(<Fixture visible/>);
  controller!.blockOpeningGesture();
  expect(handlers.onMoveShouldSetPanResponderCapture(null,{...drag,dx:-80})).toBe(true);
  ui.render(<Fixture visible enabled={false}/>);
  expect(handlers.onMoveShouldSetPanResponderCapture(null,{...drag,dx:-80})).toBe(false);
 }finally{ui.cleanup();}
});

test('protected controls keep horizontal gestures even over an open drawer; a new background touch resets the exclusion',()=>{
 const ui=mount();let controller:ReturnType<typeof useSideNavGesture>;
 function Fixture({visible=false}:{visible?:boolean}) {
  controller=useSideNavGesture({visible,enabled:true,progress:{value:0} as any,width:300,onOpen:()=>{},onClose:()=>{}});
  return null;
 }
 const drag={x0:10,dx:80,dy:2,vx:1};
 try {
  ui.render(<Fixture/>);
  handlers.onStartShouldSetPanResponderCapture();
  controller!.blockGesture();
  expect(handlers.onMoveShouldSetPanResponderCapture(null,drag)).toBe(false);
  expect(handlers.onMoveShouldSetPanResponderCapture(null,{...drag,dx:220})).toBe(false);
  // A parent rail cannot weaken a child's exclusion.
  controller!.blockOpeningGesture();
  expect(handlers.onMoveShouldSetPanResponderCapture(null,drag)).toBe(false);
  ui.render(<Fixture visible/>);
  expect(handlers.onMoveShouldSetPanResponderCapture(null,{...drag,dx:-80})).toBe(false);
  handlers.onStartShouldSetPanResponderCapture();
  expect(handlers.onMoveShouldSetPanResponderCapture(null,{...drag,dx:-80})).toBe(true);
 } finally {ui.cleanup();}
});
