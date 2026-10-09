Pod::Spec.new do |s|
  s.name = 'OmgWhistle'
  s.version = '1.0.0'
  s.summary = 'On-device Whistle dictation for omg.dev'
  s.author = 'omg.dev'
  s.homepage = 'https://omg.dev'
  s.license = { :type => 'Apache-2.0' }
  s.platforms = { :ios => '16.4' }
  s.source = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '*.swift'
  s.vendored_frameworks = 'vendor/NeedleEngine.xcframework'
  s.libraries = 'c++'
  s.frameworks = 'Accelerate'
  s.swift_version = '5.9'
  s.pod_target_xcconfig = {
    'EXCLUDED_ARCHS[sdk=iphonesimulator*]' => 'x86_64'
  }
  s.user_target_xcconfig = { 'EXCLUDED_ARCHS[sdk=iphonesimulator*]' => 'x86_64' }
  unless system('bash', File.join(__dir__, '../scripts/prepare-ios.sh'))
    raise 'Could not prepare the pinned Whistle iOS engine'
  end
end
