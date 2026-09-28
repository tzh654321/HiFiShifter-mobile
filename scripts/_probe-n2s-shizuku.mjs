#!/usr/bin/env node
/**
 * N2-S 真机验收：**通过 Shizuku 在非 root 机上拿到「全部文件访问」**。
 *
 * 原理（docs/18 §4）：Shizuku 让普通应用借到 shell(adb) 身份 ⇒ 执行系统自带的
 *   `appops set <pkg> MANAGE_EXTERNAL_STORAGE allow`
 * 之后 `Environment.isExternalStorageManager()` 为真 ⇒ 全盘**真路径直读**，
 * 既不用逐目录 SAF 授权，读文件也不必先物化。
 *
 * 判据：
 *   ① 前置：Shizuku 在跑（真机已装 13.5.x；用 adb 拉起 start.sh）
 *   ② `shizuku_state` = `need-permission`（本应用尚未被 Shizuku 授权）
 *   ③ 提示条上出现 Shizuku 按钮（`[data-hs-shizuku]`）
 *   ④ 点「授权 Shizuku」⇒ 系统对话框弹出并允许 ⇒ 状态变 `ready`
 *   ⑤ 点「用 Shizuku 开启全盘访问」⇒ `allFiles=true`、提示条消失
 *   ⑥ **全盘真路径直读**：`get_audio_file_info(<共享存储里的音频>)` 成功
 *
 * 用法：node scripts\_probe-n2s-shizuku.mjs [serial]
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const serial = process.argv[2] ?? '221deeb';
const PKG = 'com.arounder.hifishifter';
const TEST_AUDIO = '/sdcard/Download/test-rr.wav';

const main = async () => {
    const adb = (c) => execSync(`adb -s ${serial} ${c}`, { stdio: 'pipe' }).toString();
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const results = [];
    const check = (name, ok, detail) => {
        results.push({ name, ok });
        console.log(`${ok ? '✅' : '🔴'} ${name}\n     ${detail}`);
    };

    // ① 拉起 Shizuku（adb 启动模式）
    try {
        adb('shell sh /sdcard/Android/data/moe.shizuku.privileged.api/start.sh');
    } catch (e) {
        console.log('⚠️ start.sh 调用异常（可能已在运行）：' + String(e.message).slice(0, 60));
    }
    await sleep(2500);
    const running = adb('shell ps -A').split('\n').filter((l) => /shizuku/i.test(l)).length;
    console.log(`▸ Shizuku 进程数：${running}`);

    const pid = adb(`shell pidof ${PKG}`).trim();
    adb('forward tcp:9222 localabstract:webview_devtools_remote_' + pid);
    const cdp = await Cdp.attach({ host: '127.0.0.1', port: 9222 });
    await cdp.send('Runtime.enable');

    // 打开文件浏览器（提示条只在 needsAuth 时出现）
    await cdp.call(async () => {
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
        it && it.click();
        await wait(2600);
        return true;
    });

    const st1 = await cdp.call(() =>
        window.__TAURI_INTERNALS__.invoke('shizuku_state').catch((e) => ({ err: String(e) })),
    );
    console.log('▸ Shizuku 状态：' + JSON.stringify(st1));
    check(
        'N2-S1 Shizuku 已被检测到（state = ready 或 need-permission）',
        st1 && (st1.state === 'need-permission' || st1.state === 'ready'),
        JSON.stringify(st1),
    );

    const ui1 = await cdp.call(() => {
        const btn = document.querySelector('[data-hs-shizuku]');
        const hint = document.querySelector('[data-hs-needs-auth="1"]');
        return {
            hintPresent: Boolean(hint),
            shizukuButton: btn ? { state: btn.getAttribute('data-hs-shizuku'), text: (btn.textContent || '').trim() } : null,
        };
    });
    console.log('▸ 面板：' + JSON.stringify(ui1));
    check(
        'N2-S2 未授权时提示条上出现 Shizuku 入口',
        ui1.shizukuButton !== null,
        JSON.stringify(ui1),
    );

    // ④ 需要授权时先走授权请求
    if (st1 && st1.state === 'need-permission') {
        const clicked = await cdp.call(() => {
            const btn = document.querySelector('[data-hs-shizuku]');
            if (!btn) return 'no-button';
            btn.click();
            return 'clicked';
        });
        await sleep(2500);
        // 系统授权对话框：找「允许」并点
        let allowed = 'no-dialog';
        try {
            adb('shell uiautomator dump /sdcard/ui.xml');
            const xml = adb('shell cat /sdcard/ui.xml');
            const nodes = [...xml.matchAll(/<node[^>]*>/g)].map((m) => m[0]);
            const target = nodes.find((n) => /text="(允许|ALLOW|Allow|允许一次)"/.test(n));
            if (target) {
                const b = (target.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/) || []).slice(1).map(Number);
                if (b.length === 4) {
                    adb(`shell input tap ${Math.round((b[0] + b[2]) / 2)} ${Math.round((b[1] + b[3]) / 2)}`);
                    allowed = 'tapped';
                }
            }
        } catch (e) {
            allowed = 'dump-failed:' + String(e.message).slice(0, 40);
        }
        await sleep(2500);
        const st2 = await cdp.call(() =>
            window.__TAURI_INTERNALS__.invoke('shizuku_state').catch((e) => ({ err: String(e) })),
        );
        console.log(`▸ 授权对话框处理：${allowed}；之后状态=${JSON.stringify(st2)}`);
        check(
            'N2-S3 授权后状态变为 ready',
            st2 && st2.state === 'ready',
            `点击=${clicked}；对话框=${allowed}；状态=${JSON.stringify(st2)}`,
        );
    }

    // ⑤ 执行 appops 授权
    const granted = await cdp.call(() =>
        window.__TAURI_INTERNALS__
            .invoke('grant_all_files_via_shizuku')
            .catch((e) => ({ err: String(e) })),
    );
    console.log('▸ 授权结果：' + JSON.stringify(granted));
    await sleep(1500);

    const st3 = await cdp.call(async () => {
        const inv = (c, a) => window.__TAURI_INTERNALS__.invoke(c, a).catch((e) => ({ err: String(e) }));
        const state = await inv('storage_access_state', { dirPath: '/sdcard/Download' });
        const hint = document.querySelector('[data-hs-needs-auth="1"]');
        return { state, hintPresent: Boolean(hint) };
    });
    console.log('▸ 授权后：' + JSON.stringify(st3));
    check(
        'N2-S4 授权后 allFiles=true、提示条消失（不再需要逐目录授权）',
        st3.state && st3.state.allFiles === true && st3.hintPresent === false,
        JSON.stringify(st3),
    );

    // ⑥ 全盘真路径直读
    const read = await cdp.call(
        (p) => window.__TAURI_INTERNALS__.invoke('get_audio_file_info', { filePath: p }).catch((e) => ({ err: String(e) })),
        TEST_AUDIO,
    );
    console.log('▸ 直读共享存储音频：' + JSON.stringify(read));
    check(
        'N2-S5 全盘真路径直读成功（未走 SAF、未物化）',
        read && typeof read.sampleRate === 'number',
        `${TEST_AUDIO} ⇒ ${JSON.stringify(read)}`,
    );

    console.log('\n════════ 汇总 ════════');
    const fails = results.filter((x) => !x.ok);
    console.log(`通过 ${results.length - fails.length} / ${results.length}`);
    if (fails.length) console.log('未通过：' + fails.map((f) => f.name).join(' · '));
    cdp.close();
};

await main();
