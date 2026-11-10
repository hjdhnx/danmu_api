// DsPlayer 市场单文件 bundle 出包脚本（一条命令可复现，2026-11-10）：
//   node build/package-bundle.mjs --version 1.0.2
// 流程：依赖自检 → rolldown 构建 → 组装 staging（wrapper/伴生件/server.json）
//   → zip → 打印 size/md5（market.json 登记用）。
// 产物：build/dist/danmu-<version>.zip（零 node_modules，server.js 为
//   wrapper：import './server.bundle.mjs' 即自启，服务配置/入口零改动）。
// 设计与实测依据见 build/rolldown.bundle.config.js 头注（真机启动
// 3.0~3.6s→~2.0s；fork 打包基线须与 server.json desc 中的 commit 一致）。
import {execSync, execFileSync} from 'child_process';
import {existsSync, mkdirSync, rmSync, cpSync, writeFileSync, readFileSync} from 'fs';
import {createHash} from 'crypto';
import path from 'path';
import url from 'url';

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const args = new Map(process.argv.slice(2).map((v, i, a) =>
    v.startsWith('--') ? [v.slice(2), a[i + 1] ?? ''] : [null, v]).filter(([k]) => k));

const version = args.get('version');
if (!version) {
  console.error('用法: node build/package-bundle.mjs --version <x.y.z> [--commit <sha>]');
  process.exit(1);
}
// 打包基线 commit：缺省取 git HEAD（server.json desc 会写明，可溯源）
const commit = args.get('commit') ?? execSync('git rev-parse --short HEAD',
    {cwd: root}).toString().trim();
const distDir = path.join(root, 'build', 'dist');
const bundle = path.join(root, 'build', 'server.bundle.mjs');

// ① 依赖自检：bundle 解析需要 node_modules（rolldown 静态解析全量依赖）
if (!existsSync(path.join(root, 'node_modules', 'rolldown'))) {
  console.log('[deps] 安装构建依赖（rolldown + 运行时依赖树，--no-save 不入库）…');
  execSync('npm i --omit=dev --no-save --no-audit --no-fund rolldown',
      {cwd: root, stdio: 'inherit'});
} else if (!existsSync(path.join(root, 'node_modules', 'node-fetch'))) {
  execSync('npm i --omit=dev --no-save --no-audit --no-fund',
      {cwd: root, stdio: 'inherit'});
}

// ② rolldown 构建（配置：esm-shim node24 豁免 + minify + 零运行时 external）
console.log('[build] rolldown 构建单文件 bundle…');
execFileSync('node', [
  path.join(root, 'node_modules', 'rolldown', 'dist', 'cli.mjs'),
  '--config', path.join(root, 'build', 'rolldown.bundle.config.js'),
], {cwd: root, stdio: 'inherit'});

// ③ 组装 staging
console.log('[stage] 组装发行目录…');
const stage = path.join(distDir, 'danmu-api');
rmSync(distDir, {recursive: true, force: true});
mkdirSync(path.join(stage, 'danmu_api'), {recursive: true});
mkdirSync(path.join(stage, 'config'));
cpSync(bundle, path.join(stage, 'danmu_api', 'server.bundle.mjs'));
writeFileSync(path.join(stage, 'danmu_api', 'server.js'),
    '// bundle 版包装器：模块求值即自启（原 server.js 顶层 startServer，无主模块判断）\n'
    + "import './server.bundle.mjs';\n");
cpSync(path.join(root, 'danmu_api', 'ui'), path.join(stage, 'danmu_api', 'ui'),
    {recursive: true});
cpSync(path.join(root, 'LICENSE'), path.join(stage, 'LICENSE'));
writeFileSync(path.join(stage, 'config', '.gitkeep'), '');
writeFileSync(path.join(stage, 'package.json'), JSON.stringify({
  name: 'danmu-api-server',
  version,
  type: 'module',
  description: 'LogVar danmu API server (DsPlayer market bundle edition, no node_modules)',
  main: 'danmu_api/server.js',
  scripts: {start: 'node danmu_api/server.js'},
  license: 'ISC',
}, null, 2));
writeFileSync(path.join(distDir, 'server.json'), JSON.stringify({
  serviceId: 'danmu-api',
  serviceName: '弹幕 API',
  workDir: 'danmu-api',
  entry: 'danmu_api/server.js',
  port: 9321,
  healthType: 'tcp',
  version,
  desc: `LogVar 弹幕 API 服务 v${version}（来源 github.com/huangxd-/danmu_api commit `
      + `${commit}）：兼容弹弹play 协议的弹幕聚合接口，直连爱优腾芒哔咪等平台取弹幕。`
      + '本版为单文件 bundle 形态（零 node_modules）。安装后自动创建「弹幕 API」服务'
      + '（需 nodejs 运行时插件），启动后在 设置→播放器 把弹幕接口改为 '
      + 'http://127.0.0.1:9321 即可自动匹配弹幕；浏览器访问 http://<设备IP>:9321 '
      + '可搜索调试。另监听 5321 代理端口；配置热重载在 Android 上不可用（chokidar 已裁）。',
}, null, 2));

// ④ zip：python zipfile 统一打包（禁用 PowerShell Compress-Archive——
// PS5.1 会写出「Local File Header 条目名用 \、Central Directory 用 /」的
// 畸形 zip：python 校验读 CD 全部 `/` 而客户端 Dart archive 包读 LFH 拿到
// `\`，解压即 PathAccessException（2026-11-10 1.0.1 首包实锤）。zipfile
// 两处一致且恒 `/`）
const zipPath = path.join(distDir, `danmu-${version}.zip`);
console.log('[zip] 打包（python zipfile，分隔符恒 /）…');
execFileSync('python', ['-c', `import zipfile, sys, os
root, out = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for base in ('danmu-api', 'server.json'):
        p = os.path.join(root, base)
        if os.path.isfile(p):
            z.write(p, base)
            continue
        for dp, _, fns in os.walk(p):
            for fn in fns:
                fp = os.path.join(dp, fn)
                z.write(fp, os.path.relpath(fp, root).replace(os.sep, '/'))
`, distDir, zipPath], {cwd: root, stdio: 'inherit'});

// ⑤ 对账信息（market.json / README 登记用）
const data = readFileSync(zipPath);
console.log(`\n[done] ${zipPath}`);
console.log(`  size: ${data.length}`);
console.log(`  md5:  ${createHash('md5').update(data).digest('hex')}`);
console.log(`  commit: ${commit}`);
console.log('  登记两处：market.json（url/size/md5/version/desc/changelog）与 README 条目表；');
console.log('  旧 zip 按「包滚动」惯例删除（check_market.py 孤儿检查）。');
