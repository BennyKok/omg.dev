#import <UIKit/UIKit.h>
#import <react-native-key-command/HardwareShortcuts.h>

/**
 * UIKit walks the responder chain asking for `keyCommands` and stops at
 * UIApplication. UIApplication itself defines none, so this category is the
 * app-wide answer: whatever JS registered through react-native-key-command.
 * The AppDelegate stays the generated one; nothing here needs prebuild edits.
 */
@interface UIApplication (OmgKeyCommands)
@end

@implementation UIApplication (OmgKeyCommands)

- (NSArray<UIKeyCommand *> *)keyCommands {
  return [[HardwareShortcuts sharedInstance] keyCommands];
}

- (void)handleKeyCommand:(UIKeyCommand *)keyCommand {
  [[HardwareShortcuts sharedInstance] handleKeyCommand:keyCommand];
}

@end
