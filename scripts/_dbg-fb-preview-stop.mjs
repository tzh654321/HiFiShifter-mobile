#!/usr/bin/env node
/**
 * 验证 ③④：文件管理的试听 / 停止链路。
 *
 * ③「点停止又从头播了一遍」→ 期望：停止后 **声音停** 且 **`previewingFile` 清空**（标记不再亮）
 * ④「试听时按下工具栏播放键应停掉试听」→ 期望：只停试听，**不起播工程**
 *
 * 用法：node scripts/_dbg-fb-preview-stop.mjs 221deeb
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const serial = process.argv[2] ?? '221deeb';
const port = 9237;

const probe = () =>
    Promise.resolve(null); // 占位（真实读取在 inPage）

function inPage() {
    const api = window.__hsAudioPreview;
    const rows = [...document.querySelectorAll('[data-hs-file-entry], [role="button"], div')]
        .map((n) => (n.textContent || '').trim())
        .filter((t) => /\.(wav|mp3|flac|ogg|m4a)$/i.test(t) && t.length < 40);
    return {
        previewPlaying: api ? api.playing() : null,
        previewingFile:
            window.__hsPreviewingFile !== undefined ? window.__hsPreviewingFile : undefined,
        fileRows: [...new Set(rows)].slice(0, 6),
        playingFile: (() => {
            /* 文件项上"正在播放"标记的 DOM 真值 */
            const el = document.querySelector('[data-hs-previewing="1"]');
            return el ? (el.textContent || '').trim().slice(0, 30) : null;
        })(),
    };
}

async function main() {
    const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`).toString().trim().replace(/\r/g, '');
    execSync(`adb -s ${serial} forward tcp:${port} localabstract:webview_devtools_remote_${pid}`);
    const cdp = await Cdp.attach({ host: '127.0.0.1', port });
    await cdp.send('Runtime.enable');
    try { await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }); } catch { /* ignore */ }

    const touch = (type, pts) =>
        cdp.send('Input.dispatchTouchEvent', {
            type,
            touchPoints: pts.map((p) => ({ id: 0, x: Math.round(p.x), y: Math.round(p.y), radiusX: 8, radiusY: 8, force: 1 })),
        });
    const tap = async (x, y, hold = 80) => {
        await touch("touchStart", [{ x, y }]);
        await sleep(hold);
        await touch("touchEnd", []);
        await sleep(650);
    };
    const read = () => cdp.call(inPage);
    /* 试听要先把整段 PCM 读回来（`readAudioPreview`，大文件几百 ms）⇒ **必须轮询等它真响**，
       否则读数会"错位一拍"（上一版探针就栽在这里：点文件后读到 false、点停止后才变 true）。 */
    const waitPlaying = async (want = true, timeoutMs = 8000) => {
        const t0 = Date.now();
        while (Date.now() - t0 < timeoutMs) {
            const st = await read();
            if (st.previewPlaying === want) return st;
            await sleep(250);
        }
        return read();
    };

    /* 1) 打开文件管理面板。`#17` 之后面板显隐走 `session.mobilePanels`，
       底栏页签已删；App 侧的 `hs-mobile-close-panel`（toggle 语义）是最稳的入口。 */
    /* 判据用"列表里是否有音频项"（比 surface 属性可靠：面板在场 ≠ 有那个属性）。 */
    const panelOn = () =>
        cdp.call(() =>
            [...document.querySelectorAll("div,span,p")].some(
                (n) =>
                    n.children.length === 0 &&
                    /\.(wav|mp3|flac|ogg|m4a)$/i.test((n.textContent || "").trim()),
            ),
        );
    for (let i = 0; i < 3; i += 1) {
        if (await panelOn()) break;
        await cdp.call(() =>
            window.dispatchEvent(new CustomEvent("hs-mobile-close-panel", { detail: { key: "files" } })),
        );
        await sleep(900);
    }
    console.log("文件面板在场 =", await panelOn());
    let st = await read();
    console.log("打开后 文件行 =", JSON.stringify(st.fileRows));

    /* 2) 找 hs-tone.wav 并点击试听 */
    let target = await cdp.call(() => {
        for (const n of document.querySelectorAll("div,span,p")) {
            if (n.children.length !== 0) continue;
            const t = (n.textContent || "").trim();
            /* 用面板里**任意一个**音频文件即可验链路（用户的库里就有 mp3）。 */
            if (!/\.(wav|mp3|flac|ogg|m4a)$/i.test(t)) continue;
            const row = n.closest('div[role="button"], button, div');
            const r = (row ?? n).getBoundingClientRect();
            if (r.width < 20 || r.height < 10) continue;
            return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), text: t };
        }
        return null;
    });
    if (!target) {
        console.log("（列表里没有可点的音频项）");
        cdp.close();
        return;
    }
    console.log("点文件 =", JSON.stringify(target));
    await tap(target.x, target.y);
    st = await waitPlaying(true);
    console.log("① 点文件后（等它真响）：playing =", st.previewPlaying);

    /* 3) 点下工具栏「停止」 */
    const stopBtn = await cdp.call(() => {
        for (const b of document.querySelectorAll("button")) {
            const al = b.getAttribute("aria-label") || "";
            if (al === "停止" || al === "Stop") {
                const r = b.getBoundingClientRect();
                if (r.top > window.innerHeight * 0.6) return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
            }
        }
        return null;
    });
    console.log("停止键 =", JSON.stringify(stopBtn));
    if (stopBtn) {
        await tap(stopBtn.x, stopBtn.y);
        const imm = await read();
        await sleep(3000); // 观察窗：修前"停掉后又从头响"会在这段里复现
        st = await read();
        console.log("② 点停止后：立刻 playing =", imm.previewPlaying, " / 3 秒后 playing =", st.previewPlaying);
    }

    /* 4) 再试听 → 点下工具栏「播放」键 */
    await tap(target.x, target.y);
    st = await waitPlaying(true);
    console.log("③ 再试听（等它真响）：playing =", st.previewPlaying);
    const playBtn = await cdp.call(() => {
        for (const b of document.querySelectorAll("button")) {
            const al = b.getAttribute("aria-label") || "";
            if (al === "播放" || al === "暂停" || al === "Play" || al === "Pause") {
                const r = b.getBoundingClientRect();
                if (r.top > window.innerHeight * 0.6) return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), label: al };
            }
        }
        return null;
    });
    console.log("播放键 =", JSON.stringify(playBtn));
    if (playBtn) {
        await tap(playBtn.x, playBtn.y);
        st = await read();
        const engPlaying = await cdp.call(() =>
            window.__TAURI_INTERNALS__.invoke("get_playback_state").then((p) => p && (p.is_playing ?? p.playing)).catch(() => null),
        );
        console.log("④ 点播放键后：试听 playing =", st.previewPlaying, " 标记行 =", JSON.stringify(st.playingFile), " 工程播放 =", engPlaying);
    }
    console.log("\n期望：① true 且有标记；② **false 且标记清空**（③④ 的核心）；③ true；④ **false**（只停试听，不起播工程）");
    cdp.close();
}
main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
