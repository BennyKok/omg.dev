/** @jsxImportSource ../../web/node_modules/react */
import { mount, type Mounted } from '../../web/src/test-support/render';
import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import * as React from '../../web/node_modules/react';
import { resolve } from 'node:path';
mock.module(resolve(import.meta.dir,'../node_modules/react/index.js'),()=>React);
const View=({children}:any)=><div>{children}</div>;
const Image=Object.assign(({accessibilityLabel}:any)=><span>{accessibilityLabel}</span>,{getSize:(_uri:any,ready:any)=>ready(200,200)});
let pans:any;
const finished:Function[]=[];
mock.module(resolve(import.meta.dir,'../node_modules/react-native/index.js'),()=>({
 View,Image,StatusBar:()=>null,Keyboard:{dismiss(){}},
 Modal:({children}:any)=><section role="dialog">{children}</section>,
 Pressable:({children,onPress,accessibilityLabel,disabled}:any)=><button aria-label={accessibilityLabel} disabled={disabled} onClick={onPress}>{children}</button>,
 PanResponder:{create:(handlers:any)=>{pans=handlers;return {panHandlers:{}};}},
 useWindowDimensions:()=>({width:390,height:844}),
}));
mock.module(import.meta.resolve('react-native-reanimated'),()=>({
 default:{View,Image},Easing:{cubic:()=>{},out:()=>{},in:()=>{}},runOnJS:(fn:Function)=>fn,
 useSharedValue:(value:any)=>React.useRef({value}).current,
 useAnimatedStyle:(fn:Function)=>fn(),
 withTiming:(value:any,_options:any,done?:Function)=>{if(done)finished.push(done);return value;},
}));
mock.module(resolve(import.meta.dir,'../src/omg/text.tsx'),()=>({Text:({children}:any)=><span>{children}</span>}));
mock.module(resolve(import.meta.dir,'../src/omg/provider.tsx'),()=>({useOmg:()=>({client:null})}));
const {ImageViewer}=await import('../src/omg/remote-image');
const {ImageGalleryProvider}=await import('../src/omg/image-gallery');
const {ImageGalleryContext}=await import('../src/omg/image-gallery-context');
const origin={x:20,y:200,width:200,height:200};
let ui:Mounted;
beforeEach(()=>{ui=mount();finished.length=0;});afterEach(()=>ui.cleanup());
const complete=()=>ui.flush(()=>{for(const callback of finished.splice(0))callback(true);});

test('horizontal swipe pages without closing; vertical swipe closes',async()=>{
 const pages:number[]=[];let closed=0;
 ui.render(<ImageViewer uri="image" origin={origin} sourceRadius={16} accessibilityLabel="First" position={1} count={2} onPage={d=>pages.push(d)} onClosed={()=>closed++}/>);
 ui.flush(()=>pans.onPanResponderRelease({}, {dx:-120,dy:5,vx:-1,vy:0}));complete();
 expect(pages).toEqual([1]);expect(closed).toBe(0);
 ui.render(null);
 ui.render(<ImageViewer uri="image" origin={origin} sourceRadius={16} accessibilityLabel="First" onClosed={()=>closed++}/>);
 await ui.flushAsync(async()=>{pans.onPanResponderRelease({}, {dx:3,dy:150,vx:0,vy:1});await Promise.resolve();});
 complete();expect(closed).toBe(1);
});

test('pinching pans instead of paging',()=>{
 const pages:number[]=[];
 ui.render(<ImageViewer uri="image" origin={origin} sourceRadius={16} accessibilityLabel="First" position={1} count={2} onPage={d=>pages.push(d)} onClosed={()=>{}}/>);
 ui.flush(()=>{
  pans.onPanResponderGrant();
  pans.onPanResponderMove({nativeEvent:{touches:[{pageX:0,pageY:0},{pageX:50,pageY:0}]}},{dx:0,dy:0});
  pans.onPanResponderMove({nativeEvent:{touches:[{pageX:0,pageY:0},{pageX:100,pageY:0}]}},{dx:0,dy:0});
  pans.onPanResponderRelease({}, {dx:-120,dy:0,vx:-1,vy:0});
 });complete();expect(pages).toEqual([]);
});

const images=[{id:'a',rowKey:'row-a',path:'/a',label:'A'},{id:'b',rowKey:'row-b',path:'/b',label:'B'}];
function Thumbnail(){
 const gallery=React.useContext(ImageGalleryContext)!;
 const thumbnail=React.useMemo(()=>({uri:'a',radius:16,measure:async()=>origin}),[]);
 React.useEffect(()=>gallery.register('a',thumbnail),[gallery.register,thumbnail]);
 return <button onClick={()=>gallery.open('a',origin,thumbnail)}>Open thumbnail</button>;
}
test('gallery survives thumbnail unmount and restores the selected row before closing',async()=>{
 const reveals:string[]=[];
 const reveal=async(key:string)=>{reveals.push(key);};
 const app=(show:boolean)=><ImageGalleryProvider images={images} onReveal={reveal}>{show?<Thumbnail/>:null}</ImageGalleryProvider>;
 ui.render(app(true));ui.flush(()=>ui.query('button')!.click());
 ui.flush(()=>ui.query('button[aria-label="Next image"]')!.click());complete();
 ui.render(app(false));expect(ui.query('[role="dialog"]')).not.toBeNull();expect(ui.text()).toContain('2 / 2');
 await ui.flushAsync(async()=>{ui.query('button[aria-label="Close image"]')!.click();await new Promise(r=>setTimeout(r,0));});
 expect(reveals).toEqual(['row-b']);complete();expect(ui.query('[role="dialog"]')).toBeNull();
});
