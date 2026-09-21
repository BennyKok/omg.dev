Pod::Spec.new do |s|
  s.name = 'OmgBrowserLogin'
  s.version = '1.0.0'
  s.summary = 'User-approved website login transfer for omg.dev'
  s.description = 'A private WKWebView login sheet and scoped cookie export.'
  s.author = 'omg.dev'
  s.homepage = 'https://omg.dev'
  s.license = { :type => 'MIT' }
  s.platforms = { :ios => '16.4' }
  s.source = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.swift'
  s.swift_version = '5.9'
end
