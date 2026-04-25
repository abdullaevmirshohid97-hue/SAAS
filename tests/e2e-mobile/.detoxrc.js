module.exports = {
  testRunner: { args: { $0: 'jest', config: 'jest.config.js' }, jest: { setupTimeout: 120000 } },
  apps: {
    'ios.debug': { type: 'ios.app', build: 'xcodebuild -workspace ios/Clary.xcworkspace -scheme Clary -configuration Debug -sdk iphonesimulator -derivedDataPath ios/build', binaryPath: 'ios/build/Build/Products/Debug-iphonesimulator/Clary.app' },
  },
  devices: { 'ios.simulator': { type: 'ios.simulator', device: { type: 'iPhone 15' } } },
  configurations: { 'ios.sim.debug': { device: 'ios.simulator', app: 'ios.debug' } },
};
