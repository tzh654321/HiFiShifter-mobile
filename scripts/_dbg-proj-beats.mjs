#!/usr/bin/env node
/**
 * 验证 ⑤：工程设置里「每小节拍数」分子是**输入框**、分母含 **1 与 32**。
 *
 * 用法：node scripts/_dbg-proj-beats.mjs 221deeb
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const serial = process.argv[2] ?? '221deeb';
const port = 9233;

function inPage() {
    const input = document.querySelector("[data-hs-project-beats-input]");
    const dialog = document.querySelector("[data-hs-modal]") ?? document.body;
    /* 找出"拍号"区块里的所有按钮文本（分母是按钮组，分子应为输入框）。 */
    const texts = [...dialog.querySelectorAll("button")]
        .map((b) => (b.textContent || "").trim())
        .filter((t) => /^\d+$/.test(t));
    const labels = [...dialog.querySelectorAll("p, span")]
        .map((n) => (n.textContent || "").trim())
        .filter((t) => t.length > 0 && t.length < 20);
    return {
        hasBeatsInput: Boolean(input),
        beatsValue: input ? input.value : null,
        numericButtonTexts: [...new Set(texts)],
        open: Boolean(document.querySelector("[data-hs-modal]")),
        labelHits: labels.filter((t) => /拍|分母|小节|beats|denominator/i.test(t)).slice(0, 6),
    };
}

async function main() {
    const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`).toString().trim().replace(/\r/g, '');
    execSync(`adb -s ${serial} forward tcp:${port} localabstract:webview_devtools_remote_${pid}`);
    const cdp = await Cdp.attach({ host: '127.0.0.1', port });
    await cdp.send('Runtime.enable');
    await sleep(300);

    await cdp.call(() =>
        window.dispatchEvent(new CustomEvent("hs-open-settings", { detail: { which: "project" } })),
    );
    await sleep(900);
    const out = await cdp.call(inPage);
    console.log(JSON.stringify(out, null, 1));
    /* 顺带确认：分子的旧按钮组（2/3/4/5/6/7/8/9/12 一整套）不该再出现 */
    const expectDen = ["1", "2", "4", "8", "16", "32"];
    const got = out.numericButtonTexts;
    const denOk = expectDen.every((d) => got.includes(d));
    console.log(
        `\n判据：输入框=${out.hasBeatsInput ? "✅" : "🔴"}  分母含 1/2/4/8/16/32=${denOk ? "✅" : "🔴"}  实得按钮=${JSON.stringify(got)}`,
    );
    cdp.close();
}
main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
