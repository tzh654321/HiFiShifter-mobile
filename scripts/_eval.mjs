/**
 * 通用求值：把 argv[2] 当表达式送进 WebView 执行，打印 JSON 结果。
 *
 *   node scripts/_eval.mjs "localStorage.getItem('hifishifter.splitRatio')"
 *   node scripts/_eval.mjs "document.querySelectorAll('.hs-param-toolbar').length"
 *
 * 只为排查方便，不参与验收（验收用 probe-ui.mjs / layout-audit.mjs）。
 */
import { Cdp } from './lib/cdp.mjs';

const port = Number(process.env.PORT || 9222);
const expr = process.argv[2];
if (!expr) {
    console.error('用法: node scripts/_eval.mjs "<表达式>"');
    process.exit(2);
}

const cdp = await Cdp.attach({ port });
await cdp.send('Runtime.enable');
/**
 * 🔴 2026-09-27 修：原来外层是**同步 IIFE** + `awaitPromise: false`。
 *
 * 后果：传 `async () => { await sleep(800); … }` 这类表达式时，
 * **返回值是个 Promise 被直接丢掉，只打印空 `{}`**；
 * 而且 `catch` 也抓不到里面的异步异常。
 *
 * 表现极具误导性 —— 脚本没报错、CDP 也没报错，就是**什么都不输出**，
 * 让人以为"连不上 CDP"或"元素不存在"，于是反复重建 forward、怀疑 app 崩了。
 * （我为此多花了好几轮。）
 *
 * 现在：外层改 `async IIFE` + `await (表达式)` + `awaitPromise: true`。
 * `await` 一个非 Promise 值会原样返回，所以**同步表达式行为不变**；
 * 异步表达式则等它 resolve。写探针时可以直接在里面 sleep / 等 React 重渲染。
 */
const res = await cdp.send('Runtime.evaluate', {
    expression: `(async () => { try { return JSON.parse(JSON.stringify(await (${expr}))); } catch (e) { return 'ERR: ' + e.message; } })()`,
    returnByValue: true,
    awaitPromise: true,
});
if (res.exceptionDetails) {
    console.error('异常:', JSON.stringify(res.exceptionDetails.exception?.description || res.exceptionDetails));
} else {
    console.log(JSON.stringify(res.result.value, null, 1));
}
cdp.close();
