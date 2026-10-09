// Native: the screen moves with the keyboard frame by frame on iOS and Android.
// React Native's KeyboardAvoidingView reacts only after the keyboard frame
// changes, so the screen followed the keyboard late.
export { KeyboardAwareScrollView, KeyboardProvider, KeyboardStickyView } from "react-native-keyboard-controller";
