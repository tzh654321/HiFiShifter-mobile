#!/usr/bin/env node
/**
 * N2-S 验收（模拟器可验的部分）：提示条上的两条"拿到全盘访问"入口，以及
 * 「应用自有目录不该误报未授权」这条准确性修正。
 *
 * 判据：
 *   ① `pm clear` 清掉授权后，共享存储目录 ⇒ `needsAuth=true`，面板出现提示条，
 *      且提示条上有**两个**按钮：`fb_all_files_access`（跳系统设置）与 `fb_grant_dir_access`（SAF 授权）；
 *   ② 点「开启全盘访问」⇒ **前台 Activity 变成系统设置**（证明 intent 真的拉起来了）；
 *   ③ 应用自有目录（`Android/data/<pkg>/files`）⇒ `needsAuth=false`（本来就能读，不该误报）。
 *
 * ⚠️ Shizuku 那条路（`appops set <pkg> MANAGE_EXTERNAL_STORAGE allow`）**在模拟器上无法验收**
 *    （没有 Shizuku 服务），本探针只验"未装 Shizuku 时也有可用替代入口且不崩"。
 *
 * 用法：node scripts\_probe-n2s-allfiles.mjs [serial]
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const serial = process.argv[2] ?? 'emulator-5554';
const PKG = 'com.arounder.hifishifter';

const main = async () => {
    const adb = (c) => execSync(`adb -s ${serial} ${c}`, { stdio: 'pipe' }).toString();
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    // 清掉授权（也让前端回到"未授权"初始态）
    adb(`shell pm clear ${PKG}`);
    await sleep(1500);
    adb(`shell monkey -p ${PKG} -c android.intent.category.LAUNCHER 1`);
    await sleep(12000);

    const pid = adb(`shell pidof ${PKG}`).trim();
    adb('forward tcp:9222 localabstract:webview_devtools_remote_' + pid);
    const cdp = await Cdp.attach({ host: '127.0.0.1', port: 9222 });
    await cdp.send('Runtime.enable');

    const results = [];
    const check = (name, ok, detail) => {
        results.push({ name, ok });
        console.log(`${ok ? '✅' : '🔴'} ${name}\n     ${detail}`);
    };

    // 打开文件浏览器
    const opened = await cdp.call(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const trig = [...document.querySelectorAll('button')].find(
            (x) => (x.textContent || '').trim() === '视图',
        );
        trig && trig.click();
        await wait(900);
        const it = [...document.querySelectorAll('[role=menuitem],[role=menuitemcheckbox],button,div')].find(
            (x) =>
                ((x.getAttribute('aria-label') || '').trim() === '文件浏览器' ||
                    (x.textContent || '').trim() === '文件浏览器') &&
                x.children.length <= 3,
        );
        if (!it) return 'no-menu-item';
        it.click();
        await wait(2600);
        return 'opened';
    });
    console.log('▸ 打开文件浏览器：' + opened);

    const ui = await cdp.call(async () => {
        const inv = (cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args).catch((e) => ({ err: String(e) }));
        const dir = document.querySelector('[data-tooltip*="emulated"]')?.getAttribute('data-tooltip') || '/storage/emulated/0/HiFiShifter';
        const st = await inv('storage_access_state', { dirPath: dir });
        const own = await inv('storage_access_state', { dirPath: '/storage/emulated/0/Android/data/com.arounder.hifishifter/files' });
        const hint = document.querySelector('[data-hs-needs-auth="1"]');
        return {
            dir,
            state: st,
            ownState: own,
            hintPresent: Boolean(hint),
            hintButtons: hint ? [...hint.querySelectorAll('button')].map((b) => (b.textContent || '').trim()) : [],
        };
    });
    console.log('▸ UI 与状态：' + JSON.stringify(ui));

    check(
        'N2-S1 未授权（清数据后）⇒ 提示条出现，且带**两个**入口',
        ui.hintPresent === true &&
            ui.hintButtons.some((x) => /全盘|all files|すべて|모든/i.test(x)) &&
            ui.hintButtons.some((x) => /授权访问目录|Grant folder|許可|권한 부여/i.test(x)),
        `提示条=${ui.hintPresent}；按钮=${JSON.stringify(ui.hintButtons)}`,
    );
    check(
        'N2-S2 应用自有目录**不**误报未授权（本来就能按路径读写）',
        ui.ownState && ui.ownState.needsAuth === false,
        `自有目录状态=${JSON.stringify(ui.ownState)}`,
    );

    // 点「开启全盘访问」⇒ 前台应变成系统设置
    const clicked = await cdp.call(async () => {
        const hint = document.querySelector('[data-hs-needs-auth="1"]');
        if (!hint) return 'no-hint';
        const btn = [...hint.querySelectorAll('button')].find((b) => /全盘|all files|すべて|모든/i.test(b.textContent || ''));
        if (!btn) return 'no-button';
        btn.click();
        return 'clicked';
    });
    await sleep(2500);
    const win = adb('shell dumpsys window');
    const focus = (win.match(/mCurrentFocus=\S+ \S+ ([^\s}]+)/) || [])[1] || '(未解析)';
    console.log('▸ 点击后前台：' + focus);
    check(
        'N2-S3 点「开启全盘访问」⇒ 系统设置页被拉起',
        /settings|Settings/i.test(focus),
        `前台=${focus}（点击结果=${clicked}）`,
    );

    // 收拾：回到应用
    adb('shell input keyevent 4');
    await sleep(1200);

    console.log('\n════════ 汇总 ════════');
    const fails = results.filter((x) => !x.ok);
    console.log(`通过 ${results.length - fails.length} / ${results.length}`);
    if (fails.length) console.log('未通过：' + fails.map((f) => f.name).join(' · '));
    cdp.close();
};

await main();
