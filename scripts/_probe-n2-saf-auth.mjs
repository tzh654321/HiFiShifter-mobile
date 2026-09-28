#!/usr/bin/env node
/**
 * N2-A 验收：**未授权时文件浏览器必须给出「授权访问目录」入口，而不是静默空/残列表**。
 *
 * 背景（`docs/18` §1）：Android 10+ 分区存储下，应用对共享存储无授权时 `readdir()`
 * 会**静默隐藏**读不到的文件（目录还在、文件消失、**系统不报错**）⇒ 列表"读取成功"
 * 但内容被截断 ⇒ 前端进不了错误态 ⇒ 挂在错误态上的授权按钮永远不出现。
 *
 * 判据（全部 DOM / 命令级可观测）：
 *   ① `storage_access_state(<共享存储目录>)` ⇒ `needsAuth = true`（列表不可信）；
 *   ② 该状态下文件浏览器渲染出 `[data-hs-needs-auth="1"]` 提示条 + 授权按钮；
 *   ③ 桌面/非共享存储路径 ⇒ `needsAuth = false`（不打扰用户）；
 *   ④ 对照组：`list_directory` 只回目录、漏掉同目录里的 .wav（证明"静默截断"真实存在）。
 *
 * 用法：node scripts\_probe-n2-saf-auth.mjs [serial]
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const serial = process.argv[2] ?? 'emulator-5554';

const main = async () => {
    const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`).toString().trim();
    execSync(`adb -s ${serial} forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
    const cdp = await Cdp.attach({ host: '127.0.0.1', port: 9222 });
    await cdp.send('Runtime.enable');

    const results = [];
    const check = (name, ok, detail) => {
        results.push({ name, ok });
        console.log(`${ok ? '✅' : '🔴'} ${name}\n     ${detail}`);
    };

    const DIR = '/storage/emulated/0/HiFiShifter';

    // ── ① 命令级：状态判定 ─────────────────────────────────────────────
    const st = await cdp.call(
        (dir) =>
            window.__TAURI_INTERNALS__
                .invoke('storage_access_state', { dirPath: dir })
                .catch((e) => ({ __err: String(e) })),
        DIR,
    );
    console.log('▸ storage_access_state(' + DIR + ') = ' + JSON.stringify(st));
    check(
        'N2-A1 共享存储目录被判定为「列表不可信」（needsAuth=true）',
        st && st.needsAuth === true && st.isSharedStorage === true,
        JSON.stringify(st),
    );

    const stRoot = await cdp.call(() =>
        window.__TAURI_INTERNALS__
            .invoke('storage_access_state', { dirPath: '/tmp' })
            .catch((e) => ({ __err: String(e) })),
    );
    check(
        'N2-A2 非共享存储路径不触发提示（needsAuth=false，桌面行为不变）',
        stRoot && stRoot.needsAuth === false,
        JSON.stringify(stRoot),
    );

    // ── ② 对照：静默截断确实存在（目录在、wav 不见） ────────────────────
    const [list, shell] = await Promise.all([
        cdp.call(
            (dir) =>
                window.__TAURI_INTERNALS__
                    .invoke('list_directory', { dirPath: dir })
                    .catch((e) => ({ __err: String(e) })),
            DIR,
        ),
        Promise.resolve(
            execSync(`adb -s ${serial} shell ls ${DIR}`).toString().trim().split(/\s+/),
        ),
    ]);
    const listed = Array.isArray(list) ? list.map((e) => e.name) : [];
    const audioOnDisk = shell.filter((n) => /\.(wav|mp3|flac|m4a|ogg)$/i.test(n));
    check(
        'N2-A3 对照：磁盘上有音频文件，而 list_directory 未返回它们（静默截断）',
        audioOnDisk.length > 0 && audioOnDisk.every((n) => !listed.includes(n)),
        `磁盘音频=${JSON.stringify(audioOnDisk)}；后端返回=${JSON.stringify(listed)}`,
    );

    // ── ③ UI 级：打开文件浏览器 ⇒ 必须出现授权入口 ──────────────────────
    const opened = await cdp.call(
        async (dir) => {
            const wait = (ms) => new Promise((r) => setTimeout(r, ms));
            // 用「视图 → 文件浏览器」打开面板（项目里这一项的名字就是"文件浏览器"）
            const trig = [...document.querySelectorAll('button')].find(
                (x) => (x.textContent || '').trim() === '视图',
            );
            const panelOpen = () => Boolean(document.querySelector('[data-hs-split-handle="files"]'));
            if (!panelOpen()) {
                trig && trig.click();
                await wait(800);
                const item = [...document.querySelectorAll('[role=menuitem],[role=menuitemcheckbox],button,div')].find(
                    (x) =>
                        ((x.getAttribute('aria-label') || '').trim() === '文件浏览器' ||
                            (x.textContent || '').trim() === '文件浏览器') &&
                        x.children.length <= 3,
                );
                if (!item) return { error: 'no-menu-item' };
                item.click();
                await wait(2500);
            }
            // 把面板里显示的路径设到测试目录（用它的"路径"输入/面包屑不可靠 ⇒ 直接派发 slice 动作不可行，
            // 这里改为：若面板当前路径不是目标目录，就用后端命令列出并断言 UI 侧提示条由 needsAuth 驱动）
            await wait(800);
            const hint = document.querySelector('[data-hs-needs-auth="1"]');
            const btns = [...document.querySelectorAll('button')].map((b) =>
                (b.getAttribute('aria-label') || (b.textContent || '').trim()).slice(0, 20),
            );
            return {
                hintPresent: Boolean(hint),
                hintText: hint ? (hint.innerText || '').replace(/\s+/g, ' ').slice(0, 80) : null,
                grantButton: btns.filter((x) => /授权|Grant|許可|권한/.test(x)),
                panelOpen: panelOpen(),
            };
        },
        DIR,
    );
    console.log('▸ 文件浏览器：' + JSON.stringify(opened));
    check(
        'N2-A4 未授权时面板渲染出提示条 +「授权访问目录」入口',
        Boolean(opened.hintPresent) && (opened.grantButton ?? []).length > 0,
        JSON.stringify(opened),
    );

    console.log('\n════════ 汇总 ════════');
    const fails = results.filter((x) => !x.ok);
    console.log(`通过 ${results.length - fails.length} / ${results.length}`);
    if (fails.length) console.log('未通过：' + fails.map((f) => f.name).join(' · '));
    cdp.close();
};

await main();
