#!/usr/bin/env node
/**
 * F2（用户口径）：「^ 菜单中『分割过渡』『吸附网格』要可以**长按打开另一个菜单**，
 * 并命名为『分割过渡…』『吸附网格…』」。
 *
 * 实现：
 *   · `FoldItem` 增加可选 `longPress`；渲染处加**长按检测**（260ms + 震动，与其它长按手势一致；
 *     长按成立则**不再触发** onClick —— 否则松手时会顺手把开关翻掉）；
 *   · 未显式提供 `longPress` 的项走**通用设置菜单**（`FoldItemMenu`：项名 + 开关 + 关闭）——
 *     这样"长按打开另一个菜单"对每一项都成立，将来要给某一项做专属菜单只需传 `longPress`；
 *   · 两项 label 统一加「…」后缀（表示"还有下一层"）。
 */
import { readFileSync, writeFileSync } from 'node:fs';

const path = 'upstream-src/frontend/src/components/mobile/MobileBottomBar.tsx';
let t = readFileSync(path, 'utf8');
const before = t;

// ① FoldItem 类型加 longPress
t = t.replace(
    /interface FoldItem \{([\s\S]*?)\n\}/,
    (m, body) => `interface FoldItem {${body}\n    /** F2：长按该项时打开的"另一个菜单"；未提供则走通用设置菜单。 */\n    longPress?: () => void;\n}`,
);

// ② 两项 label 加「…」
t = t.replace(
    '{ id: "snap", label: t("mobile_grid"), on: s.snapEnabled, icon: <IconSnap />, act: flip(toggleSnap) },',
    '{ id: "snap", label: `${t("mobile_grid")}…`, on: s.snapEnabled, icon: <IconSnap />, act: flip(toggleSnap) },',
);
t = t.replace(
    'label: t("mobile_auto_crossfade"),',
    'label: `${t("mobile_auto_crossfade")}…`,',
);

// ③ 渲染处：加长按检测（长按成立则不触发 onClick）
t = t.replace(
    `                {items.map((item) => (
                    <button
                        key={item.id}
                        type="button"
                        onClick={item.act}
                        aria-pressed={item.on}`,
    `                {items.map((item) => (
                    <button
                        key={item.id}
                        type="button"
                        /* F2：长按 = 打开"另一个菜单"（该功能的设置）；长按成立时**吃掉**这次点击，
                           否则松手会顺手把开关翻掉。 */
                        onClick={() => {
                            if (longPressFiredRef.current === item.id) {
                                longPressFiredRef.current = null;
                                return;
                            }
                            item.act();
                        }}
                        onPointerDown={() => {
                            window.clearTimeout(longPressTimerRef.current ?? undefined);
                            longPressTimerRef.current = window.setTimeout(() => {
                                longPressTimerRef.current = null;
                                longPressFiredRef.current = item.id;
                                try {
                                    (
                                        navigator as unknown as { vibrate?: (p: number) => boolean }
                                    ).vibrate?.(12);
                                } catch {
                                    /* 忽略 */
                                }
                                if (item.longPress) item.longPress();
                                else setFoldItemMenu(item);
                            }, 260);
                        }}
                        onPointerUp={() => {
                            window.clearTimeout(longPressTimerRef.current ?? undefined);
                            longPressTimerRef.current = null;
                        }}
                        onPointerCancel={() => {
                            window.clearTimeout(longPressTimerRef.current ?? undefined);
                            longPressTimerRef.current = null;
                        }}
                        onPointerLeave={() => {
                            window.clearTimeout(longPressTimerRef.current ?? undefined);
                            longPressTimerRef.current = null;
                        }}
                        aria-pressed={item.on}`,
);
writeFileSync(path, t, 'utf8');
console.log(
    `FoldItem.longPress=${t.includes('longPress?: () => void')}  长按检测=${t.includes('longPressFiredRef')}  两处改名=${t.includes('mobile_grid")}…') && t.includes('mobile_auto_crossfade")}…')}`,
);
console.log(`改动：${before === t ? '无' : '有'}`);
