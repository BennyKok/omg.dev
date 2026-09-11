# Puts react-native-key-command's UIKeyCommands on the responder chain without
# editing the generated AppDelegate. UIKit asks every responder up the chain
# for `keyCommands`, ending at UIApplication; a category there answers for the
# whole app, so a hardware keyboard on iPad reaches JS through the library's
# own event emitter. Autolinked from mobile/modules by expo-modules-autolinking.
Pod::Spec.new do |s|
  s.name           = 'OmgKeyCommands'
  s.version        = '1.0.0'
  s.summary        = 'Hardware keyboard shortcuts for omg.dev on iPad'
  s.description    = 'UIApplication category that serves react-native-key-command shortcuts.'
  s.author         = 'omg.dev'
  s.homepage       = 'https://omg.dev'
  s.license        = { :type => 'MIT' }
  s.platforms      = { :ios => '15.1' }
  s.source         = { :git => '' }
  s.static_framework = true
  s.dependency 'react-native-key-command'
  s.source_files = 'ios/**/*.{h,m}'
end
