import { endpoint } from '../platform/runtime.ts';
export default endpoint(() => ({
  runtime: 'tgcloud-v8',
  wasm: typeof Reflect.get(globalThis, 'WebAssembly') === 'object',
  crypto: typeof Reflect.get(globalThis, 'crypto') === 'object',
  now: Date.now(),
}));
