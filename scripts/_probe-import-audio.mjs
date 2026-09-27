#!/usr/bin/env node
/**
 * 造一个音频块（供音频块相关的手势验收用）。
 *
 * 为什么不用 `import_audio_item(路径)`：模拟器上无论是 `/sdcard/Download/` 还是
 * 应用自己的 `/sdcard/HiFiShifter/`，后端都返回
 * `media_has_no_audio_or_unsupported_codec`（路径解码这条路在模拟器上走不通）。
 * 改成 **`import_audio_bytes`**（base64）绕过文件路径，直接把 PCM wav 喂给导入流程。
 *
 * 用法：node scripts/_probe-import-audio.mjs --serial emulator-5554 [--wav <path>] [--at 0]
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
    const o = { serial: 'emulator-5554', port: 9222, wav: 'D:\\Temp\\hs-tone.wav', at: 0 };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--serial') o.serial = argv[++i];
        else if (a === '--port') o.port = Number(argv[++i]);
        else if (a === '--wav') o.wav = argv[++i];
        else if (a === '--at') o.at = Number(argv[++i]);
    }
    return o;
}

async function main() {
    const o = parseArgs(process.argv);
    const bytes = readFileSync(o.wav);
    const b64 = bytes.toString('base64');
    console.log(`▸ 素材 ${o.wav}（${bytes.length} 字节 → base64 ${b64.length} 字符）`);

    const pid = execSync(`adb -s ${o.serial} shell pidof com.arounder.hifishifter`).toString().trim().replace(/\r/g, '');
    if (!pid) throw new Error('应用没在跑');
    execSync(`adb -s ${o.serial} forward tcp:9222 localabstract:webview_devtools_remote_${pid}`).toString();

    const cdp = await Cdp.attach({ host: '127.0.0.1', port: o.port });
    await cdp.send('Runtime.enable');

    const res = await cdp.call(
        (fileName, base64Data, startSec) => {
            /* 优先走 **App 暴露的验收钩子**：它内部走前端同一条路径并 `fetchTimeline()`
               刷新 redux —— 直接调后端命令不会更新 redux，块不会渲染（实测踩过）。 */
            const hook = window.__hsImportAudioBase64;
            const p = hook
                ? hook(fileName, base64Data, startSec)
                : window.__TAURI_INTERNALS__.invoke('import_audio_bytes', {
                      fileName,
                      base64Data,
                      trackId: null,
                      startSec,
                  });
            return Promise.resolve(p)
                .then((r) => ({
                    via: hook ? 'hook' : 'tauri-raw',
                    ok: r && r.ok,
                    created: (r && r.created_clip_ids) || [],
                    clips: ((r && r.clips) || []).length,
                    missing: (r && r.missing_files) || [],
                }))
                .catch((e) => ({ error: String(e) }));
        },
        'hs-tone.wav',
        b64,
        o.at,
    );
    await sleep(600);
    console.log('▸ 导入结果：' + JSON.stringify(res));

    // 确认块真的进了工程：读一次 timeline 状态里的 clips 数
    const state = await cdp.call(() =>
        window.__TAURI_INTERNALS__
            .invoke('get_timeline_state')
            .then((r) => ({ clips: (r && r.clips || []).length }))
            .catch((e) => ({ error: String(e) })),
    );
    console.log('▸ 工程内 clips：' + JSON.stringify(state));
    cdp.close();
}

await main();
