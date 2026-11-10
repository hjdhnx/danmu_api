// danmu-api server 单文件 bundle 配置（DsPlayer 市场版，2026-11-10）：
// 手法同 drpy-node-bundle/rolldown.server.config.js（七坑经验复用）。
// 目标 = 消灭 Android FUSE 上 node_modules 1643 文件的 ESM 解析 stat 风暴
//（实测 boot 3.0~3.6s）；bundle 后零 external 运行时依赖 → zip 不带 node_modules。
// 伴生：config/ ui/ config_example/ package.json LICENSE（server.js 同深度放
// bundle，../config 等相对路径推导零变化）；wrapper = server.js 一行 import。
import { defineConfig } from 'rolldown';
import path from 'path';
import { fileURLToPath } from 'url';

const __cfgdir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__cfgdir, '..');

const builtins = [
  'assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console',
  'constants', 'crypto', 'dgram', 'dns', 'domain', 'events', 'fs',
  'fs/promises', 'http', 'http2', 'https', 'inspector', 'module', 'net', 'os',
  'path', 'perf_hooks', 'process', 'punycode', 'querystring', 'readline',
  'repl', 'stream', 'string_decoder', 'sys', 'timers', 'tls', 'trace_events',
  'tty', 'url', 'util', 'v8', 'vm', 'wasi', 'worker_threads', 'zlib',
];

// 动态 import 的可选依赖（未安装，运行时 try/catch 软降级——Android 形态
// 保持）：chokidar=配置热重载（Android 不可用）、redis=持久缓存（可选）
const optionalPkgs = ['chokidar', 'redis'];

export default defineConfig({
  input: path.resolve(root, 'danmu_api/server.js'),
  output: {
    dir: path.resolve(root, 'build'),
    entryFileNames: 'server.bundle.mjs',
    format: 'esm',
    sourcemap: false,
    codeSplitting: false,
    minify: true,
  },
  platform: 'node',
  treeshake: false,
  resolve: {
    conditionNames: ['node', 'import'],
    alias: {
      // Node>=20.19 原生 require(esm)，node24 恒无需该 shim（其内部靠运行时
      // esbuild 转译 + Hook Module 系统按 __dirname 圈定范围——inline 进
      // bundle 后 __dirname 语义错位，故整体豁免为空模块）
      [path.resolve(root, 'danmu_api/esm-shim.cjs')]:
          path.resolve(__cfgdir, 'esm-shim-stub.mjs'),
    },
  },
  onwarn: (warning, defaultHandler) => {
    if (warning.code === 'EVAL') return;
    defaultHandler(warning);
  },
  external: (id) => {
    if (builtins.includes(id) || id.startsWith('node:')) return true;
    if (optionalPkgs.some((p) => id === p || id.startsWith(p + '/'))) {
      return true;
    }
    return false;
  },
});
