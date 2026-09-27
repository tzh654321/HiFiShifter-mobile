#!/usr/bin/env node
/**
 * C4 诊断 + 验收：v 菜单（`body[data-hs-param-menu="open"]`）里各控件的**实际排布**。
 *
 * 逐项打印浮层的直接子元素：标签 / 尺寸 / `order` / 所在行（按 top 分组），
 * 用来把用户要的行结构（第一行 6 个按钮、第二行 算法+参考轨道组、第三行 平滑度）
 * 与现状逐行对齐。
 *
 * 用法：node scripts\_dbg-vmenu.mjs [serial]
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const serial = process.argv[2] ?? 'emulator-5554';

const main = async () => {
    const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`).toString().trim();
    execSync(`adb -s ${serial} forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
    const cdp = await Cdp.attach({ host: '127.0.0.1', port: 9222 });
    await cdp.send('Runtime.enable');

    /** ① 先确保**参数面板**打开（v 菜单与 `.hs-param-rows` 都在参数面板里）。 */
    const ensureParams = await cdp.call(async () => {
        const clickText = async (text) => {
            const el = [...document.querySelectorAll('button')].find(
                (b) => (b.textContent || '').trim() === text,
            );
            if (!el) return false;
            el.click();
            return true;
        };
        if (document.querySelector('.hs-param-rows')) return 'already';
        if (!(await clickText('视图'))) return 'no-view-menu';
        await new Promise((r) => setTimeout(r, 300));
        if (!(await clickText('参数面板'))) return 'no-params-item';
        await new Promise((r) => setTimeout(r, 1200));
        return document.querySelector('.hs-param-rows') ? 'opened' : 'still-missing';
    });
    console.log('▸ 参数面板：' + JSON.stringify(ensureParams));

    /** ② 打开 v 菜单（点参数工具行上那个 ∨；它的 aria-label 是 `mobile_param_menu`）。
     *  ⚠️ ∨ 是**开关**：上一轮跑完菜单可能还开着，直接点会把它关掉（实测踩过——
     *  第二次运行读到的 `menuOpen=null`，判定全空）。所以先看状态再点。 */
    const opened = await cdp.call(async () => {
        if (document.body.getAttribute('data-hs-param-menu') === 'open') return { ok: true, already: true };
        const btn = [...document.querySelectorAll('button')].find(
            (b) => (b.getAttribute('data-tooltip') || b.ariaLabel || '') === '参数菜单',
        );
        if (!btn) {
            const cands = [...document.querySelectorAll('button')]
                .map((b) => b.getAttribute('data-tooltip') || b.ariaLabel)
                .filter(Boolean)
                .slice(0, 40);
            return { ok: false, cands };
        }
        btn.click();
        await new Promise((r) => setTimeout(r, 500));
        return { ok: true, openedNow: document.body.getAttribute('data-hs-param-menu') };
    });
    await sleep(500);
    console.log('▸ 打开 v 菜单：' + JSON.stringify(opened));

    const dump = await cdp.call(() => {
        const panel = document.querySelector('.hs-param-rows');
        if (!panel) return { error: 'no-panel' };
        /* `display: contents` 的盒子自己不生成盒子模型（rect = 0x0），它的孩子才是
           浮层里"看得见的一项"⇒ 必须**下钻**，否则只能看到 head / toolbar 两个空壳。 */
        const collect = (root, depth = 0) => {
            const out = [];
            for (const el of [...root.children]) {
                const cs = getComputedStyle(el);
                if (cs.display === 'contents' || el.getBoundingClientRect().width === 0) {
                    if (depth < 3 && el.children.length > 0) {
                        out.push(...collect(el, depth + 1));
                        continue;
                    }
                }
                const r = el.getBoundingClientRect();
                const label =
                    (el.getAttribute('data-tooltip') || '') ||
                    (el.getAttribute('aria-label') || '') ||
                    (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 18);
                out.push({
                    tag: el.tagName,
                    cls: String(el.className).slice(0, 44),
                    html: el.outerHTML.slice(0, 110).replace(/\s+/g, ' '),
                    text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 26),
                    attrs: [...el.attributes]
                        .map((a) => a.name)
                        .filter((n) => n.startsWith('data-'))
                        .join(','),
                    label,
                    order: cs.order,
                    rect: `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`,
                    top: Math.round(r.top),
                    buttons: el.querySelectorAll('button').length,
                    display: cs.display,
                });
            }
            return out;
        };
        const kids = collect(panel).filter((k) => {
            // 0x0 的项（被其它规则隐藏的分组残留）不参与"行"的划分，否则会凭空多出
            // 一行 y=0 的幽灵行，把判定全带偏。
            const m = /^(-?\d+),(-?\d+) (\d+)x(\d+)$/.exec(k.rect);
            return m ? Number(m[3]) > 0 && Number(m[4]) > 0 : false;
        });
        // 行分组（top 容差 6px）
        const rows = [];
        for (const k of kids) {
            const row = rows.find((x) => Math.abs(x.top - k.top) <= 6);
            if (row) {
                row.items.push(`${k.label || k.tag}[o${k.order}]`);
            } else {
                rows.push({ top: k.top, items: [`${k.label || k.tag}[o${k.order}]`] });
            }
        }
        // 行分组（top 容差 6px），最后**按 y 排序**：kids 是按 DOM 顺序收集的，
        // 而 flex-wrap 会按 order 重排 —— 不排序的话"第一行/第二行"全对不上（踩过）。
        rows.sort((a, b) => a.top - b.top);
        return { menuOpen: document.body.getAttribute('data-hs-param-menu'), kids, rows };
    });
    console.log('▸ 浮层直接子元素：\n' + JSON.stringify(dump.kids, null, 1));
    console.log('\n▸ 行结构（menuOpen=' + dump.menuOpen + '）：');
    for (const r of dump.rows ?? []) {
        console.log(`  y=${r.top}：${r.items.join(' | ')}`);
    }
    console.log('\n▸ 无名项（排查多出来的行）：');
    for (const k of dump.kids ?? []) {
        if (!k.label) console.log(`  ${k.rect} order=${k.order} ${k.html}`);
    }
    // 判定：C4 的三行结构
    const rows = dump.rows ?? [];
    const rowLabels = rows.map((r) => r.items.join(' '));
    const row1Six = rowLabels.length > 0 && (rows[0]?.items.length ?? 0) >= 6;
    const row1NoAlgo = !/算法/.test(rowLabels[0] ?? '');
    const row2AlgoRef = /算法/.test(rowLabels[1] ?? '') && /参考轨道组/.test(rowLabels[1] ?? '');
    const row3Smooth = /平滑度/.test(rowLabels[2] ?? '');
    const noEditRow = !rowLabels.some((t) => (t.match(/svg\[o/g) || []).length >= 5 && !/平滑度/.test(t));
    console.log('\n════════ C4 判定 ════════');
    console.log(`${row1Six && row1NoAlgo ? '✅' : '🔴'} 第一行 = 六个按钮（含导入 MIDI）且不含「算法」：${rowLabels[0] ?? '(空)'}`);
    console.log(`${row2AlgoRef ? '✅' : '🔴'} 第二行 = 算法 + 参考轨道组：${rowLabels[1] ?? '(空)'}`);
    console.log(`${row3Smooth ? '✅' : '🔴'} 第三行 = 平滑度：${rowLabels[2] ?? '(空)'}`);
    console.log(`${noEditRow ? '✅' : '🔴'} 没有「五个编辑按钮」自成一行：共 ${rows.length} 行`);
    cdp.close();
};

await main();
