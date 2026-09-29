#!/usr/bin/env node
/**
 * F1 细诊断：派发 `hs-open-clip-context-menu` 后，右键菜单为什么没出现。
 *
 * 分四步取证：
 *   ① 时间线面板是否挂载（`[data-hs-surface="timeline"]`）—— 监听只在那时注册；
 *   ② 选中是否真的设上（后端 `get_timeline_state().selected_clip_id`）；
 *   ③ 派发事件后 DOM 里有没有"像右键菜单"的节点（含 重命名/删除/静音/规范化 等文本）；
 *   ④ 页面 console 有没有报错（Tauri/Console 会进 logcat）。
 *
 * 用法：node scripts\_dbg-f1-context-menu.mjs [serial]
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const serial = process.argv[2] ?? '221deeb';

const main = async () => {
    const adb = (c) => execSync(`adb -s ${serial} ${c}`, { stdio: 'pipe' }).toString();
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const pid = adb('shell pidof com.arounder.hifishifter').trim();
    if (!pid) {
        console.log('🔴 应用没在跑');
        return;
    }
    adb('forward tcp:9222 localabstract:webview_devtools_remote_' + pid);
    const cdp = await Cdp.attach({ host: '127.0.0.1', port: 9222 });
    await cdp.send('Runtime.enable');
    const inv = (c, a) =>
        cdp.call(
            (cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args).catch((e) => ({ err: String(e).slice(0, 120) })),
            c,
            a,
        );

    // ① 面板挂载
    const panels = await cdp.call(() => ({
        timeline: Boolean(document.querySelector('[data-hs-surface="timeline"]')),
        kernel: Boolean(document.querySelector('[data-hs-timeline-kernel="1"]')),
    }));
    console.log('① 面板挂载：' + JSON.stringify(panels));

    // ② 确保有块 + 选中
    let st = await inv('get_timeline_state', {});
    if (!(st.clips || []).length) {
        await inv('import_audio_item', {
            audioPath: '/sdcard/Download/test-rr.wav',
            trackId: null,
            startSec: 0,
            mediaAudioStreamIndex: null,
        });
        await sleep(2600);
        st = await inv('get_timeline_state', {});
    }
    const clip = (st.clips || [])[0];
    console.log('② 块：' + (clip ? clip.id : '（无）'));
    let selErr = null;
    if (clip) {
        const r = await inv('select_clip', { clipId: clip.id });
        selErr = r?.err ?? null;
        await sleep(900);
    }
    const st2 = await inv('get_timeline_state', {});
    console.log('   选中结果：selected_clip_id=' + st2.selected_clip_id + '  select_clip 错误=' + selErr);

    // ③ 派发事件并观察 DOM（带上 clipId —— 与浮条一致；后端 select_clip 不更新前端 store）
    await cdp.call((id) => { window.__f1ClipId = id; }, clip ? clip.id : null);
    const before = await cdp.call(() => document.querySelectorAll('div').length);
    await cdp.call(() => {
        window.dispatchEvent(new CustomEvent('hs-open-clip-context-menu', { detail: { x: 120, y: 240, clipId: window.__f1ClipId } }));
    });
    await sleep(1500);
    const after = await cdp.call(() => {
        const all = [...document.querySelectorAll('div')];
        const likeMenu = all.filter((el) => {
            const t = el.innerText || '';
            const r = el.getBoundingClientRect();
            return /重命名|删除|静音|规范化|反转|编组/.test(t) && r.width > 80 && r.height > 40 && r.height < 700;
        });
        return {
            divCount: all.length,
            menuLikeCount: likeMenu.length,
            sample: likeMenu[0] ? (likeMenu[0].innerText || '').replace(/\s+/g, ' ').slice(0, 120) : null,
            // 也看看有没有 portal 容器（ClipContextMenu 用 createPortal ⇒ 挂在 body 直接子级）
            bodyChildren: [...document.body.children].map((c) => c.tagName + '.' + String(c.className || '').slice(0, 24)).slice(0, 12),
        };
    });
    console.log('③ 派发前 div 数=' + before + '；派发后：' + JSON.stringify(after));

    // ④ logcat
    const log = adb('logcat -d -t 200');
    const errs = log
        .split('\n')
        .filter((l) => /Tauri\/Console|Uncaught|TypeError|Maximum update/.test(l))
        .slice(-8);
    console.log('④ console/异常：');
    errs.forEach((l) => console.log('   ' + l.trim().slice(0, 170)));
    if (!errs.length) console.log('   （无）');
    cdp.close();
};

await main();
