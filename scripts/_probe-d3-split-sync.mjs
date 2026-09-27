#!/usr/bin/env node
/**
 * D3 验收：打开「同步参数编辑器水平位置与缩放」且**两块面板同屏**时，
 * 界面上只应留**一个顶部拍数栏**与**一个底部滑动条**。
 *
 * 实现口径（见 `index.css` 末尾与 `App.tsx` 的 `data-hs-paramsync`）：
 *   · 顶部：留**时间线**的拍数栏（屏幕上最上面那条），隐藏参数面板那条；
 *   · 底部：留**参数面板**的滑动条（屏幕上最下面那条），隐藏时间线那条。
 *
 * 判据（只看**可见性**，不看 DOM 是否存在 —— 两条都是 `display:none` 掉而不是卸载）：
 *   D3-a 同屏 + 同步 ON ⇒ 可见拍数栏恰好 1 个且是 `timeline`；可见水平滑动条恰好 1 个且是 `params`
 *   D3-b 同屏 + 同步 OFF（尽力切换，切不动就跳过并标注）⇒ 各 2 个
 *
 * 本探针会**自己切到平板视口**（两个面板才能同屏），并负责重启应用 + 重建 CDP forward。
 * ⚠️ 手机端底部 tab 已被 E 组规格移除；面板入口在顶栏「视图」→「参数面板」。
 *
 * 用法：node scripts\_probe-d3-split-sync.mjs [serial]
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const serial = process.argv[2] ?? 'emulator-5554';
const adb = (cmd) => execSync(`adb -s ${serial} ${cmd}`, { stdio: 'pipe' });

/** 页面里：读「可见的」拍数栏与水平滑动条。 */
const READ_VISIBLE = () => {
    const vis = (el) => {
        if (!el) return false;
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return false;
        const st = getComputedStyle(el);
        return st.display !== 'none' && st.visibility !== 'hidden';
    };
    const rulers = [...document.querySelectorAll('[data-hs-time-ruler]')].map((e) => ({
        v: e.getAttribute('data-hs-time-ruler'),
        visible: vis(e),
        w: Math.round(e.getBoundingClientRect().width),
    }));
    const sbs = [...document.querySelectorAll('.hs-sb-h')].map((e) => ({
        v: e.getAttribute('data-hs-sb') || '(无钩子)',
        visible: vis(e),
    }));
    return {
        vw: innerWidth,
        vh: innerHeight,
        syncFlag: document.body.dataset.hsParamsync || '(未设)',
        rulers,
        sbs,
    };
};

/** 页面里：开「视图」菜单 → 点「参数面板」。 */
const OPEN_PARAMS_PANEL = async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const menus = () => [
        ...document.querySelectorAll(
            '[role=menu],[data-radix-popper-content-wrapper],.rt-DropdownMenuContent',
        ),
    ];
    const findItem = () =>
        menus()
            .map((p) =>
                [...p.querySelectorAll('[role=menuitem],[role=menuitemcheckbox]')].find(
                    (e) => (e.innerText || '').trim().replace(/\s+/g, ' ') === '参数面板',
                ),
            )
            .find(Boolean) ?? null;
    let item = findItem();
    if (!item) {
        const trigger = [...document.querySelectorAll('button')].find(
            (x) => (x.innerText || '').trim() === '视图',
        );
        if (!trigger) return { error: 'no-view-menu' };
        const r = trigger.getBoundingClientRect();
        for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
            trigger.dispatchEvent(
                new MouseEvent(t, {
                    bubbles: true,
                    cancelable: true,
                    clientX: r.left + r.width / 2,
                    clientY: r.top + r.height / 2,
                }),
            );
        }
        for (let i = 0; i < 4 && !item; i++) {
            await wait(700);
            item = findItem();
        }
    }
    if (!item) return { error: 'no-params-item' };
    const wasChecked = item.getAttribute('aria-checked') === 'true';
    if (!wasChecked) {
        item.click();
        await wait(2000);
    }
    return { ok: true, wasChecked };
};

const main = async () => {
    // ── ① 切平板视口 → 重启应用 → 重建 forward（`wm density` 会杀掉应用）────────
    console.log('▸ 切平板视口 1600x2560 / 320dpi …');
    adb('shell wm size 1600x2560');
    adb('shell wm density 320');
    await sleep(2500);
    adb('shell am force-stop com.arounder.hifishifter');
    await sleep(1500);
    adb('shell svc power stayon true');
    adb('shell input keyevent 224');
    adb('shell monkey -p com.arounder.hifishifter -c android.intent.category.LAUNCHER 1');
    await sleep(13000);

    const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`).toString().trim();
    adb('forward --remove-all');
    adb(`forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
    const cdp = await Cdp.attach({ host: '127.0.0.1', port: 9222 });
    await cdp.send('Runtime.enable');

    const results = [];
    const check = (name, ok, detail, skipped = false) => {
        results.push({ name, ok: ok || skipped, skipped });
        console.log(`${skipped ? '⚪' : ok ? '✅' : '🔴'} ${name}\n     ${detail}`);
    };

    // ── ② 确保参数面板可见 ────────────────────────────────────────────────────
    await sleep(1000);
    console.log('▸ 打开「参数面板」：' + JSON.stringify(await cdp.call(OPEN_PARAMS_PANEL)));
    const on = await cdp.call(READ_VISIBLE);
    console.log('▸ 同步 ON 状态：' + JSON.stringify(on));

    const visRulers = on.rulers.filter((r) => r.visible).map((r) => r.v);
    const visSb = on.sbs.filter((s) => s.visible).map((s) => s.v);

    check(
        'D3-a 同屏 + 同步 ON：可见拍数栏恰好 1 个且是 timeline',
        on.syncFlag === 'on' && visRulers.length === 1 && visRulers[0] === 'timeline',
        `body 标记=${on.syncFlag}；可见拍数栏=${JSON.stringify(visRulers)}；全部=${JSON.stringify(on.rulers)}`,
    );
    check(
        'D3-a2 同屏 + 同步 ON：可见水平滑动条恰好 1 个且是 params',
        visSb.length === 1 && visSb[0] === 'params',
        `可见滑动条=${JSON.stringify(visSb)}；全部=${JSON.stringify(on.sbs)}`,
    );

    // ── ③ 关掉同步，验"两份都该在"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const off = await cdp.call(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        // 同步开关是 `.hs-param-head` 里的**第一个 IconButton**
        // （`PianoRollPanel` 里 `aria-label={t("sync_timeline_view")}` 那个，
        //  onClick = `setParamEditorSyncTimeline(!s.paramEditorSyncTimeline)`）。
        // 它**不在 ∨ 菜单里** —— 别再找 `∨` 触发按钮（会得到 no-v-trigger）。
        const head = document.querySelector('.hs-param-head');
        if (!head) return { error: 'no-param-head' };
        const toggle = head.querySelector('button');
        if (!toggle) return { error: 'no-sync-button' };
        const before = toggle.getAttribute('aria-pressed') ?? toggle.getAttribute('data-state') ?? '?';
        toggle.click();
        await wait(1800);
        return { ok: true, before, label: toggle.getAttribute('aria-label') || '' };
    });
    console.log('▸ 关同步：' + JSON.stringify(off));

    if (off?.ok) {
        const after = await cdp.call(READ_VISIBLE);
        console.log('▸ 同步 OFF 状态：' + JSON.stringify(after));
        const r2 = after.rulers.filter((r) => r.visible).length;
        const s2 = after.sbs.filter((s) => s.visible).length;
        check(
            'D3-b 同步 OFF：两份拍数栏与两条滑动条都回来（各 2）',
            r2 === 2 && s2 === 2,
            `可见拍数栏=${r2}；可见滑动条=${s2}；body 标记=${after.syncFlag}`,
        );
    } else {
        check('D3-b 同步 OFF 分支', false, `切不动同步开关（${JSON.stringify(off)}）⇒ 未验证`, true);
    }

    // ── ④ 复原：手机视口 ─────────────────────────────────────────────────────
    adb('shell wm size reset');
    adb('shell wm density reset');
    console.log('▸ 已把视口复位为手机档（应用需重启才生效）');

    console.log('\n════════ 汇总 ════════');
    const fails = results.filter((r) => !r.ok);
    console.log(`通过 ${results.length - fails.length} / ${results.length}`);
    if (fails.length) console.log('未通过：' + fails.map((f) => f.name).join(' · '));
    cdp.close();
};

await main();
