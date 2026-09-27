/**
 * 探针：本机 `fs.symlinkSync` 到底是「真链接」还是「静默退化成 0 字节文件」。
 *
 * 背景（docs/05 附录 / 2026-09-22）：tauri-cli 打包前会把 libbackend_lib.so 与
 * libc++_shared.so symlink 进 gen/android 的 jniLibs，本机上它们会变成 0 字节，
 * 于是 APK 里塞进 ZIP 头、dlopen 报 `bad ELF magic: 504b0304`。
 *
 * 用法：node scripts/_probe-symlink.mjs <src> <dst>
 * 输出一行 JSON，便于在沙箱内 / 沙箱外各跑一次做对照。
 */
import fs from "node:fs";
import path from "node:path";

const [, , src, dst] = process.argv;
if (!src || !dst) {
    console.log(JSON.stringify({ error: "usage: _probe-symlink.mjs <src> <dst>" }));
    process.exit(2);
}

const out = { src, dst, srcExists: fs.existsSync(src) };
try {
    out.srcSize = fs.statSync(src).size;
} catch (e) {
    out.srcStatError = String(e.code ?? e.message);
}

try {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
} catch {
    /* ignore */
}

try {
    fs.rmSync(dst, { force: true });
} catch (e) {
    out.rmError = String(e.code ?? e.message);
}

try {
    fs.symlinkSync(src, dst);
    out.symlinkSync = "ok";
} catch (e) {
    out.symlinkSync = `THREW ${e.code ?? ""} ${e.message}`;
}

try {
    const st = fs.lstatSync(dst);
    out.dstSize = st.size;
    out.dstIsSymlink = st.isSymbolicLink();
    out.dstIsFile = st.isFile();
    if (!st.isSymbolicLink()) {
        try {
            out.readlink = fs.readlinkSync(dst);
        } catch (e) {
            out.readlink = `ERR ${e.code ?? e.message}`;
        }
        try {
            const buf = fs.readFileSync(dst);
            out.head4 = [...buf.subarray(0, 4)].map((b) => b.toString(16).padStart(2, "0")).join(" ");
        } catch (e) {
            out.readError = String(e.code ?? e.message);
        }
    }
} catch (e) {
    out.lstatError = String(e.code ?? e.message);
}

console.log(JSON.stringify(out, null, 2));
