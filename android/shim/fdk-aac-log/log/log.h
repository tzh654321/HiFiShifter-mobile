/*
 * AOSP `log/log.h` 的 shim —— 仅用于交叉编译 fdk-aac-sys 到 Android。
 *
 * 为什么需要它
 * ------------
 * `fdk-aac-sys 0.5.0` 里 `aac/libSBRdec/src/lpp_tran.cpp` 第 121-123 行是：
 *
 *     #ifdef __ANDROID__
 *     #include "log/log.h"
 *     #endif
 *
 * 它假设 Android 平台上有 AOSP 源码树里的 `system/logging/liblog/include/log/log.h`。
 * 但 **NDK 的 sysroot 只提供 `android/log.h`**（`sysroot/usr/include/android/log.h`），
 * 没有任何 `log/` 目录。于是交叉编译时直接：
 *
 *     aac/libSBRdec/src/lpp_tran.cpp:122:10: fatal error: 'log/log.h' file not found
 *
 * 上游在 Linux / Windows / macOS 上不会碰到这条，因为只有 `__ANDROID__` 才进那个分支。
 *
 * 为什么这样修（而不是改 fdk-aac 源码或改 CFLAGS 去掉 __ANDROID__）
 * -------------------------------------------------------------------
 * 1. 改 fdk-aac 源码意味着要 patch 一个 registry 里的第三方 crate —— 不可复现、不可审计。
 * 2. 去掉 `__ANDROID__` 会连带关掉 fdk-aac 的另外两处 Android 分支
 *    （同文件的 339 与 937 行），那两处是真正的 Android 行为适配，不能关。
 * 3. 提供一个 include 目录让编译器找到这个头，改动**完全落在构建参数里**，
 *    不污染任何源码，且对上游零侵入。
 *
 * 用法：把 `android/shim/fdk-aac-log` 加进 `CFLAGS_<target>` 的 `-I` 即可
 * （见 `scripts/build-android.sh`）。
 *
 * `log/log.h` 在 AOSP 里对外暴露的核心就是这些日志宏；NDK 的 `android/log.h`
 * 提供了等价能力，所以这里直接转出去。
 */

#ifndef HIFISHIFTER_SHIM_LOG_LOG_H
#define HIFISHIFTER_SHIM_LOG_LOG_H

#include <android/log.h>

/* AOSP 的 log/log.h 在定义 LOG_TAG 后会自动展开出 ALOGx 系列宏；
 * fdk-aac 只用到 include 本身（它自己的日志走 FDK 的通用层），
 * 这里仍然把常用的几个补上，避免将来别的文件也 include 时缺符号。 */

#ifndef LOG_TAG
#define LOG_TAG "fdk-aac"
#endif

#ifndef ALOGV
#define ALOGV(...) __android_log_print(ANDROID_LOG_VERBOSE, LOG_TAG, __VA_ARGS__)
#endif
#ifndef ALOGD
#define ALOGD(...) __android_log_print(ANDROID_LOG_DEBUG, LOG_TAG, __VA_ARGS__)
#endif
#ifndef ALOGI
#define ALOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)
#endif
#ifndef ALOGW
#define ALOGW(...) __android_log_print(ANDROID_LOG_WARN, LOG_TAG, __VA_ARGS__)
#endif
#ifndef ALOGE
#define ALOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)
#endif
#ifndef ALOGF
#define ALOGF(...) __android_log_print(ANDROID_LOG_FATAL, LOG_TAG, __VA_ARGS__)
#endif

/* ---------------------------------------------------------------------------
 * android_errorWriteLog —— AOSP 私有 API，NDK 的稳定 ABI 里没有
 *
 * `lpp_tran.cpp` 在 `__ANDROID__` 下有两处纯标记性调用：
 *
 *     android_errorWriteLog(0x534e4554, "112160868");   // 第 342、940 行
 *
 * 它的作用是向 logd 登记一条安全事件（供 CTS 校验"这个 CVE 已修"），
 * **不参与任何音频计算**，返回值也没有调用方会读。
 *
 * AOSP 里它声明在 `log/log.h`、实现在 liblog；但那个符号**不在 NDK 的导出表里**
 * （NDK 的 `<android/log.h>` 只暴露 `__android_log_*` 系列），
 * 所以交叉编译时报：
 *
 *     aac/libSBRdec/src/lpp_tran.cpp:342:5: error: use of undeclared identifier
 *         'android_errorWriteLog'
 *     aac/libSBRdec/src/lpp_tran.cpp:940:5: error: use of undeclared identifier
 *         'android_errorWriteLog'
 *
 * 这里给一个签名一致的 no-op。用 no-op 而不是"转发到 __android_log_write"，
 * 是因为它的语义就是一次性标记，任何转发都只会污染日志且没有收益。
 * 对音频输出零影响。
 * ------------------------------------------------------------------------- */
static inline int android_errorWriteLog(int tag, const char *subTag) {
    (void)tag;
    (void)subTag;
    return 0;
}

#endif /* HIFISHIFTER_SHIM_LOG_LOG_H */
