//! M0 技术卡点探针。
//!
//! 设计原则：
//! 1. **不 panic、不 unwrap**：每个卡点都记录「哪一步失败 + 原始错误」，因为探针的价值就是
//!    告诉我们失败在哪一步。
//! 2. **同步写 logcat + 内存日志**：真机上没有终端，日志同时进 logcat（tag `PROBE`）
//!    与内存（内存那份供前端 `read_log` 读取）。
//!    ⚠️ **不能靠 `eprintln!`**：Android 的 zygote 把应用进程的 stdout/stderr 接到
//!    `/dev/null`，`eprintln!` 根本不出现在 logcat 里。必须显式调 liblog 的
//!    `__android_log_write`（见 `android_log`）。
//! 3. **耗时的探针（放音、大文件拷贝）跑在独立线程**，命令立即返回，避免卡住 UI；
//!    而且 cpal 的 `Stream` 是 `!Send`，必须在创建它的线程里销毁。

use serde_json::{json, Value};
use std::sync::Mutex;

// ─────────────────────────────────────────────────────────────────────────────
// 日志
// ─────────────────────────────────────────────────────────────────────────────

static LOG: Mutex<Vec<String>> = Mutex::new(Vec::new());

/// 第 3 条日志通道：落盘。
///
/// **为什么必须有这条**（真机实测教训）：
/// ColorOS 上 `adb logcat -s PROBE:V` 拿到 **0 行**，连 `RustStdoutStderr` 都没有，
/// 而同一个 App 在模拟器上日志一切正常 —— 是 ROM 层面不把应用侧日志吐给 adb。
/// 只能靠 `adb exec-out screencap` 截图看界面，再靠人眼翻页（滑错位置还看不到）。
///
/// 落盘后：
///     adb exec-out run-as <pkg> cat files/probe.log
/// 一条命令取回全文，可 grep、可 diff，纯脚本化。
/// （`run-as` 对 debuggable 包有效，实测 ColorOS 上可用。）
static FILE_LOG: Mutex<Option<std::path::PathBuf>> = Mutex::new(None);

/// 由 `setup` 在拿到 `AppHandle` 之后调用一次。
pub fn init_file_log(path: std::path::PathBuf) {
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    // 每次启动截断：否则多次运行的内容会叠在一个文件里，读的时候容易误判。
    let _ = std::fs::write(&path, b"");
    if let Ok(mut g) = FILE_LOG.lock() {
        *g = Some(path);
    }
}

fn append_to_file(line: &str) {
    use std::io::Write;
    let guard = match FILE_LOG.lock() {
        Ok(g) => g,
        Err(_) => return,
    };
    let Some(path) = guard.as_ref() else { return };
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    {
        let _ = writeln!(f, "{line}");
    }
}

/// logcat 的 tag（也用于 `adb logcat -s PROBE:V` 过滤）。
pub const LOGCAT_TAG: &str = "PROBE";

pub fn log(msg: impl AsRef<str>) {
    let s = msg.as_ref().to_string();
    // 桌面：走 stderr 就够。Android：另走 liblog（见文件头注释）。
    eprintln!("[{}] {s}", LOGCAT_TAG);
    android_log(&s);
    // 第 3 通道：落盘（真机上唯一保证可读的通道）
    append_to_file(&s);
    if let Ok(mut g) = LOG.lock() {
        g.push(s);
    }
}

/// 写一行 INFO 级日志到 Android logcat（tag = `PROBE`）。
///
/// liblog 是 NDK sysroot 自带的系统库（`liblog.so`，两个 ABI 的 stub 都在
/// `sysroot/usr/lib/<triple>/<api>/`），所以直接声明 FFI 即可，
/// 不必引入 `android_logger` + `log` 这一对依赖。
#[cfg(target_os = "android")]
fn android_log(text: &str) {
    use std::ffi::{c_char, c_int, CString};

    #[link(name = "log")]
    extern "C" {
        fn __android_log_write(prio: c_int, tag: *const c_char, text: *const c_char) -> c_int;
    }

    const ANDROID_LOG_INFO: c_int = 4;

    if let (Ok(tag), Ok(text)) = (CString::new(LOGCAT_TAG), CString::new(text)) {
        // 返回值是写入长度，正常不会失败；真失败也无妨（内存日志兜底）。
        let _ = unsafe { __android_log_write(ANDROID_LOG_INFO, tag.as_ptr(), text.as_ptr()) };
    }
}

#[cfg(not(target_os = "android"))]
fn android_log(_text: &str) {}

pub fn snapshot() -> Vec<String> {
    LOG.lock().map(|g| g.clone()).unwrap_or_default()
}

pub fn clear() {
    if let Ok(mut g) = LOG.lock() {
        g.clear();
    }
}

fn section(title: &str) {
    log("");
    log(format!("══ {title} ══"));
}

// ─────────────────────────────────────────────────────────────────────────────
// 探针 0 · 环境与路径
//
// 目的：确认 Android 上 resource_dir() / app_data_dir() 到底返回什么。
// 这是 docs/02 §3 的核心假设（「resource_dir 返回 asset://localhost/ 而非路径」），
// 必须用实测替换文档里的推测。
// ─────────────────────────────────────────────────────────────────────────────

pub fn probe_env(app: &tauri::AppHandle) -> Value {
    use tauri::Manager;

    section("探针 0 · 环境与路径");

    log(format!("target_os      = {}", std::env::consts::OS));
    log(format!("target_arch    = {}", std::env::consts::ARCH));
    log(format!(
        "编译目标        = {}",
        option_env!("PROBE_TARGET").unwrap_or("<未注入>")
    ));
    log(format!("当前工作目录    = {:?}", std::env::current_dir()));
    log(format!("current_exe    = {:?}", std::env::current_exe()));

    let p = app.path();
    let entries: [(&str, Result<std::path::PathBuf, _>); 6] = [
        ("resource_dir", p.resource_dir()),
        ("app_data_dir", p.app_data_dir()),
        ("app_local_data_dir", p.app_local_data_dir()),
        ("app_cache_dir", p.app_cache_dir()),
        ("app_config_dir", p.app_config_dir()),
        ("temp_dir", p.temp_dir()),
    ];

    let mut paths = serde_json::Map::new();
    for (name, r) in entries {
        match r {
            Ok(path) => {
                let s = path.display().to_string();
                log(format!("{name:<19} = {s}"));
                // 关键判定：这个"路径"是不是真的能当文件系统路径用
                let looks_like_uri = s.contains("://");
                if looks_like_uri {
                    log(format!("  ↑ 注意：含 '://'，不是文件系统路径"));
                }
                paths.insert(name.to_string(), json!(s));
            }
            Err(e) => {
                log(format!("{name:<19} = <错误> {e}"));
                paths.insert(name.to_string(), json!(format!("ERR: {e}")));
            }
        }
    }

    json!({ "ok": true, "paths": paths })
}

// ─────────────────────────────────────────────────────────────────────────────
// Android · JavaVM 捕获与 ndk_context 初始化
//
// ⚠️⚠️ 这是本次移植**最重要的一个发现**（比 libc++_shared 那个坑严重）：
//
//   Tauri 这一整栈（tauri / tauri-runtime-wry / wry / tao）**没有任何一处**
//   调用 `ndk_context::initialize_android_context`。
//   而 cpal 0.15.3 的 Oboe 后端**直接依赖**它：
//     · cpal/src/host/oboe/android_media.rs:18   let android_context = ndk_context::android_context();
//     · cpal/src/host/oboe/mod.rs:65             oboe::AudioDeviceInfo::request(...)
//     · cpal/src/host/oboe/mod.rs:112            default_supported_configs() → getMinBufferSize
//   oboe-rs 0.6.1 的 java_interface 亦然（StreamDefaults / AudioFeature / AudioDeviceInfo）。
//
//   而 `ndk_context::android_context()` 在未初始化时**直接 panic**
//   （ndk-context 0.1.1 src/lib.rs:72 `ANDROID_CONTEXT.expect("android context was not initialized")`）。
//
//   实测触发路径（都会 panic）：
//     · `host.devices()`                      → AudioDeviceInfo::request → java_interface
//     · `device.default_output_config()`      → supported_output_configs
//                                               → default_supported_configs → getMinBufferSize
//   也就是说：**cpal 在 Tauri Android 上查询设备能力必定崩**，
//   而 HiFiShifter 的 audio_engine 一定要查设备能力，所以这一条是硬阻塞。
//
// 解法：自己拿 JavaVM（`JNI_OnLoad`，tao/wry/jni 都没占用这个符号），
//       再用 `ActivityThread.currentApplication()` 取一个 Context，喂给 `ndk_context`。
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(target_os = "android")]
mod jvm {
    use std::ffi::c_void;
    use std::sync::atomic::{AtomicPtr, Ordering};

    static JVM: AtomicPtr<c_void> = AtomicPtr::new(std::ptr::null_mut());

    /// Android 在 `System.loadLibrary` 时回调，是拿到 `JavaVM*` 最可靠的入口。
    ///
    /// 签名对应 `jint JNI_OnLoad(JavaVM *vm, void *reserved)`。
    /// 返回 `JNI_VERSION_1_6`（= 0x00010006）；不返回版本号会被 JVM 认为加载失败。
    #[no_mangle]
    pub extern "system" fn JNI_OnLoad(vm: *mut c_void, _reserved: *mut c_void) -> i32 {
        JVM.store(vm, Ordering::SeqCst);
        0x0001_0006
    }

    pub fn raw_vm() -> *mut c_void {
        JVM.load(Ordering::SeqCst)
    }

    /// 是否已经能取到 ndk_context（用 catch_unwind 探测，避免被 panic 打死）。
    pub fn ndk_context_ready() -> bool {
        std::panic::catch_unwind(|| {
            let ctx = ndk_context::android_context();
            !ctx.vm().is_null() && !ctx.context().is_null()
        })
        .unwrap_or(false)
    }

    /// 尝试初始化 `ndk_context`。成功返回一句人类可读的说明，失败返回原因。
    pub fn init_ndk_context() -> Result<String, String> {
        if ndk_context_ready() {
            return Ok("此前已初始化".to_string());
        }

        let vm_raw = raw_vm();
        if vm_raw.is_null() {
            return Err("JNI_OnLoad 尚未被调用（JavaVM 指针为空）".to_string());
        }
        let vm = unsafe { jni::JavaVM::from_raw(vm_raw.cast()) }
            .map_err(|e| format!("JavaVM::from_raw 失败: {e}"))?;
        let mut env = vm
            .attach_current_thread()
            .map_err(|e| format!("attach_current_thread 失败: {e}"))?;

        // `ActivityThread` 属于 Android 隐藏 API；targetSdk 高时可能被 non-SDK 接口限制拦截，
        // 表现为调用抛 NoSuchMethodError。真被拦的话退路是走 Kotlin 侧把 Activity 传进来。
        let activity_thread = env
            .find_class("android/app/ActivityThread")
            .map_err(|e| {
                let _ = env.exception_clear();
                format!("find_class(\"android/app/ActivityThread\") 失败（隐藏 API 被拦？）: {e}")
            })?;

        let app = env
            .call_static_method(
                activity_thread,
                "currentApplication",
                "()Landroid/app/Application;",
                &[],
            )
            .map_err(|e| {
                let _ = env.exception_clear();
                format!("ActivityThread.currentApplication() 失败（隐藏 API 被拦？）: {e}")
            })?
            .l()
            .map_err(|e| format!("取 Application 对象失败: {e}"))?;

        if app.is_null() {
            return Err("currentApplication() 返回 null".to_string());
        }

        // 关键：必须用**全局引用**。ndk_context 会长期持有这个 jobject，
        // 而本地引用会随 `attach_current_thread` 的 guard 析构（DetachCurrentThread）一起失效。
        let app_global = env
            .new_global_ref(&app)
            .map_err(|e| format!("new_global_ref 失败: {e}"))?;
        let ctx_ptr: *mut c_void = app_global.as_obj().as_raw().cast();
        std::mem::forget(app_global); // 故意泄漏：ndk_context 持有它直到进程结束

        unsafe { ndk_context::initialize_android_context(vm_raw, ctx_ptr) };

        if ndk_context_ready() {
            Ok("通过 ActivityThread.currentApplication() 初始化成功".to_string())
        } else {
            Err("调用了 initialize_android_context 但取回来仍为空".to_string())
        }
    }
}

/// 跑一个探针，**捕获 panic**。
///
/// 设计教训：第一版探针在 ndk_context 那一项 panic 了，直接带走了整个线程，
/// 后面 4 个探针一个都没跑 —— 而"不 panic、失败也要记录"正是探针的全部价值。
/// 所以每一项都必须独立兜底。
pub fn guarded(name: &str, f: impl FnOnce()) {
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(f));
    if let Err(e) = r {
        let msg = if let Some(s) = e.downcast_ref::<&str>() {
            (*s).to_string()
        } else if let Some(s) = e.downcast_ref::<String>() {
            s.clone()
        } else {
            "<非字符串 panic>".to_string()
        };
        log(format!("❌ 【{name}】panic 已捕获（后续探针继续跑）：{msg}"));
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 探针 1 · NDK 上下文可用性
//
// 目的：cpal 的 Oboe 后端与 AssetManager 都**强依赖** ndk_context，
// 而 Tauri 栈不初始化它（见文件头 jvm 模块的说明）。本探针：
//   ① 报出当前是否已初始化
//   ② 若未初始化，用 JNI_OnLoad + ActivityThread.currentApplication() 现场补上
//   ③ 补完后复验
// ─────────────────────────────────────────────────────────────────────────────

pub fn probe_ndk_context() -> Value {
    section("探针 1 · NDK 上下文（ndk_context 全局）");
    log("背景：Tauri/tao/wry **都不初始化 ndk_context**，而 cpal 的 Oboe 后端强依赖它；");
    log("      它的 android_context() 在未初始化时会 panic，所以这是硬阻塞项。");

    #[cfg(target_os = "android")]
    {
        let before = jvm::ndk_context_ready();
        log(format!("初始化前可用性 = {before}"));

        match jvm::init_ndk_context() {
            Ok(how) => {
                let ctx = ndk_context::android_context();
                log(format!("✅ ndk_context 已初始化（{how}）"));
                log(format!("   vm()      = {:p}", ctx.vm()));
                log(format!("   context() = {:p}", ctx.context()));
                return json!({ "ok": true, "was_ready": before, "how": how });
            }
            Err(e) => {
                log(format!("❌ 初始化失败: {e}"));
                log("   → 退路：在 gen/android 的 Kotlin 侧（MainActivity）");
                log("     调用一个 #[no_mangle] 的 Rust 函数，把 Activity 直接传进来。");
                log("   → 在修好之前，cpal 的 host.devices() / default_output_config() 会 panic。");
                return json!({ "ok": false, "was_ready": before, "reason": e });
            }
        }
    }

    #[cfg(not(target_os = "android"))]
    {
        log("（非 Android 平台，跳过）");
        json!({ "ok": true, "skipped": true })
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 探针 2 · cpal / Oboe 出声
//
// 卡点 R1（docs/06）：失败信号是 dlopen failed: library "libc++_shared.so" not found。
// 这里不仅验证"能不能出声"，还把设备能力完整打出来（采样率/声道/样本格式），
// 因为上游 audio_engine 需要与真实设备能力协商。
// ─────────────────────────────────────────────────────────────────────────────

pub fn probe_cpal_start(secs: f32) -> Value {
    section("探针 2 · cpal / Oboe 输出");

    std::thread::spawn(move || {
        use cpal::traits::{DeviceTrait, HostTrait};
        use std::sync::atomic::{AtomicU64, Ordering};
        use std::sync::Arc;

        // ⚠️ 必须在碰 cpal 之前把 ndk_context 补上。
        // cpal 的 Oboe 后端走 ndk_context::android_context()，未初始化时**直接 panic**：
        //   host.devices()                 → AudioDeviceInfo::request
        //   device.default_output_config() → supported_output_configs → getMinBufferSize
        #[cfg(target_os = "android")]
        {
            let _ = jvm::init_ndk_context();
        }

        let host = cpal::default_host();
        log(format!("host.id = {:?}", host.id()));

        let device = match host.default_output_device() {
            Some(d) => d,
            None => {
                log("❌ default_output_device() = None");
                log("   → 真机上通常意味着 Oboe 初始化失败（看 logcat 的 Oboe/AAudio 行）");
                return;
            }
        };
        log(format!("default_output_device 的名称 = {:?}", device.name()));

        let cfg = match device.default_output_config() {
            Ok(c) => c,
            Err(e) => {
                log(format!("❌ default_output_config() 失败: {e}"));
                return;
            }
        };
        log(format!(
            "default_output_config = {} Hz / {} 声道 / {:?}",
            cfg.sample_rate().0,
            cfg.channels(),
            cfg.sample_format()
        ));

        // 设备能力全量枚举（上游需要据此协商）
        match device.supported_output_configs() {
            Ok(list) => {
                let mut n = 0;
                for c in list {
                    if n >= 12 {
                        log("  ...（截断）");
                        break;
                    }
                    log(format!(
                        "  支持: {} 声道 / {:?} / {}..{} Hz",
                        c.channels(),
                        c.sample_format(),
                        c.min_sample_rate().0,
                        c.max_sample_rate().0
                    ));
                    n += 1;
                }
                log(format!("supported_output_configs 共 {n} 项（最多显示 12）"));
            }
            Err(e) => log(format!("supported_output_configs() 失败: {e}")),
        }

        // 记录 nativeLibraryDir（探针 3 需要一个绝对路径候选）
        #[cfg(target_os = "android")]
        {
            let _ = android_native_lib_dir();
        }

        // ── 真的放音 3 秒 440 Hz + 660 Hz ────────────────────────────────
        let sample_rate = cfg.sample_rate().0 as f32;
        let channels = cfg.channels() as usize;
        let frames = (sample_rate * secs) as usize;
        log(format!(
            "开始生成 {frames} 帧 / {channels} 声道 / {secs} 秒的双音（440→660 Hz 交替）"
        ));

        let mut mono = Vec::<f32>::with_capacity(frames);
        for n in 0..frames {
            let t = n as f32 / sample_rate;
            let freq = if (t as usize) % 2 == 0 { 440.0 } else { 660.0 };
            mono.push((2.0 * std::f32::consts::PI * freq * t).sin() * 0.3);
        }

        let counter = Arc::new(AtomicU64::new(0));
        let counter_cb = counter.clone();
        let stream_cfg: cpal::StreamConfig = cfg.clone().into();
        // stream 需要在播放期间保持存活（drop 即停），所以把等待时长一起传下去
        let hold = std::time::Duration::from_secs_f32(secs);

        let err_log = |e: cpal::StreamError| log(format!("cpal 流错误: {e}"));
        let result = match cfg.sample_format() {
            cpal::SampleFormat::F32 => {
                let data: Vec<f32> = mono.clone();
                build_and_play(
                    &device, &stream_cfg, data, counter_cb, hold, err_log,
                )
            }
            cpal::SampleFormat::I16 => {
                let data: Vec<i16> = mono
                    .iter()
                    .map(|&s| (s.clamp(-1.0, 1.0) * 32767.0) as i16)
                    .collect();
                build_and_play(
                    &device, &stream_cfg, data, counter_cb, hold, err_log,
                )
            }
            cpal::SampleFormat::U16 => {
                let data: Vec<u16> = mono
                    .iter()
                    .map(|&s| ((s.clamp(-1.0, 1.0) * 0.5 + 0.5) * 65535.0) as u16)
                    .collect();
                build_and_play(
                    &device, &stream_cfg, data, counter_cb, hold, err_log,
                )
            }
            other => {
                log(format!("⚠️ 设备默认格式是 {other:?}，探针只实现了 F32/I16/U16"));
                log("   → 上游 engine.rs 也只实现这三种，遇到别的格式需要补分支");
                return;
            }
        };

        match result {
            Ok(()) => {
                // 注意：真正播放的等待发生在 build_and_play 内部
                // （stream 必须在等待期间保持存活，否则会被 drop 掉、回调不触发）
                let got = counter.load(Ordering::Relaxed);
                log(format!(
                    "✅ 流建立并播放 {secs} 秒；回调共输出 {got} 个样本（期望约 {}）",
                    frames * channels
                ));
                if got == 0 {
                    log("⚠️ 回调从未触发 → 流建立了但没跑起来（Oboe 常见于未 attach JVM 线程）");
                } else {
                    log("👉 请确认真机扬声器/耳机里**听到了交替的高低音**");
                }
            }
            Err(e) => {
                log(format!("❌ build_output_stream / play 失败: {e}"));
                log("   → 若错误含 libc++_shared，检查 Cargo.toml 是否开了 oboe-shared-stdcxx");
            }
        }
    });

    json!({ "ok": true, "started": true, "secs": secs })
}

/// 建立一个只播放一遍的流并等它放完。
fn build_and_play<T>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    data: Vec<T>,
    counter: std::sync::Arc<std::sync::atomic::AtomicU64>,
    hold: std::time::Duration,
    err_fn: impl FnMut(cpal::StreamError) + Send + 'static,
) -> Result<(), String>
where
    T: cpal::SizedSample + Send + 'static,
{
    use cpal::traits::{DeviceTrait, StreamTrait};
    use std::sync::atomic::Ordering;

    let len = data.len();
    let mut pos = 0usize;
    let stream = device
        .build_output_stream(
            config,
            move |out: &mut [T], _| {
                for o in out.iter_mut() {
                    if pos < len {
                        *o = data[pos];
                        pos += 1;
                    } else {
                        *o = T::EQUILIBRIUM;
                    }
                }
                counter.fetch_add(out.len() as u64, Ordering::Relaxed);
            },
            err_fn,
            None,
        )
        .map_err(|e| e.to_string())?;

    stream.play().map_err(|e| e.to_string())?;

    // ⚠️ 关键：cpal 的 `Stream` 一旦 drop 就会停止并关闭。
    // 第一版在这里直接 `Ok(())` 返回，stream 当场被 drop，
    // 表现为「流建立成功 + 回调 0 次触发」—— 看起来像平台问题，其实是探针自己的 bug。
    std::thread::sleep(hold);
    drop(stream);
    Ok(())
}


// ─────────────────────────────────────────────────────────────────────────────
// 探针 3 · ort / ONNX Runtime 加载
//
// 卡点 R2（docs/06）。分两级：
//   3a 只验证运行时能用（dlopen + OrtGetApiBase + 版本检查通过）—— 不需要模型
//   3b 加载真实 .onnx 并跑一次推理 —— 需要模型已在 app_data_dir
// ─────────────────────────────────────────────────────────────────────────────

/// 3a：探测 libonnxruntime.so 的可用路径并初始化运行时。
pub fn probe_ort_init(explicit: Option<String>) -> Value {
    section("探针 3a · ort 运行时初始化（load-dynamic）");

    let mut candidates: Vec<String> = Vec::new();
    if let Some(p) = explicit.filter(|s| !s.trim().is_empty()) {
        candidates.push(p);
    } else {
        // 策略 A：裸 soname —— Android 的 linker 会在 nativeLibraryDir 里找
        candidates.push("libonnxruntime.so".to_string());
        // 策略 B：应用私有目录（若我们自己拷了一份）
        if let Some(dir) = dirs_like_app_data() {
            candidates.push(format!("{dir}/libonnxruntime.so"));
        }
        // 策略 C：nativeLibraryDir（JNI 取）
        if let Some(dir) = android_native_lib_dir() {
            candidates.push(format!("{dir}/libonnxruntime.so"));
        }
    }

    log(format!("候选路径 {} 条：", candidates.len()));
    for c in &candidates {
        log(format!("  · {c}"));
    }

    for c in &candidates {
        if let Ok(p) = std::fs::metadata(c) {
            log(format!("  {c} 存在，{} 字节", p.len()));
        }
        match ort::init_from(c) {
            Ok(builder) => {
                // ⚠️ 千万不要直接写 `ort::sys::OrtGetApiBase()`！
                // `load-dynamic` 下这会往我们的 .so 里塞一个**未定义符号**，
                // 结果是 dlopen 直接失败，App 在我们的代码跑起来之前就崩：
                //   dlopen failed: cannot locate symbol "OrtGetApiBase" referenced by "libm0_probe_lib.so"
                //                      → java.lang.UnsatisfiedLinkError
                // 正确做法：走 `ort::info()`（内部用 ortsys! 宏做运行时解析）。
                // 它返回 ORT 的 build info 字符串，里面有 git-branch=rel-1.28.0。
                let info = ort::info();
                log("ONNX Runtime build info：");
                log(format!("   {info}"));
                let rel = info
                    .split(',')
                    .find_map(|kv| kv.trim().strip_prefix("git-branch="));
                if let Some(rel) = rel {
                    log(format!(
                        "   → 版本 = {rel}（ort-sys rc.13 期望 1.28.x；主次版本不一致会有算子级兼容问题）"
                    ));
                }

                // 注意：rc.13 里 EnvironmentBuilder::commit() 返回 **bool** 而不是 Result。
                // true  = 本次成功提交环境配置
                // false = 此前已配置过（例如重复尝试），仍说明运行时可用
                let first = builder.commit();
                if first {
                    log(format!("✅ ort::init_from(\"{c}\") + commit() 成功"));
                } else {
                    log(format!(
                        "✅ ort::init_from(\"{c}\") 成功；commit() 返回 false（环境此前已配置）"
                    ));
                }
                return json!({ "ok": true, "used": c, "first_commit": first });
            }
            Err(e) => log(format!("  init_from 失败: {e}")),
        }
    }

    log("❌ 所有候选都失败");
    log("   → 检查：libonnxruntime.so 是否在 jniLibs/arm64-v8a/ 且 ABI 匹配");
    log("   → 检查：app 的 build.gradle.kts 是否设了 abiFilters 只留 arm64-v8a");
    json!({ "ok": false, "tried": candidates })
}

/// 3b：加载模型并跑一次推理（同步，会阻塞；模型小或已缓存时很快）。
pub fn probe_ort_model(model_path: String) -> Value {
    section("探针 3b · ort 模型加载与推理");

    if !std::path::Path::new(&model_path).exists() {
        log(format!("❌ 模型不存在: {model_path}"));
        log("   → 先跑探针 4 把模型从 APK assets 拷到 app_data_dir");
        return json!({ "ok": false, "reason": "model_missing" });
    }
    let size = std::fs::metadata(&model_path).map(|m| m.len()).unwrap_or(0);
    log(format!("模型 = {model_path}（{} MB）", size / 1024 / 1024));

    let t0 = std::time::Instant::now();

    // SessionBuilder::commit_from_file(&mut self, ..) 取 &mut self，
    // 所以必须先绑定成可变局部变量，不能直接挂在 and_then 的闭包里。
    let mut builder = match ort::session::Session::builder() {
        Ok(b) => b,
        Err(e) => {
            log(format!("❌ Session::builder() 失败: {e}"));
            return json!({ "ok": false, "reason": e.to_string() });
        }
    };

    // 这一轮刻意**不追加任何执行提供者**，先量出「默认 CPU」的基线。
    // NNAPI / XNNPACK 的取舍等基线出来再定（docs/06 风险 R2）。
    let mut session = match builder.commit_from_file(&model_path) {
        Ok(s) => s,
        Err(e) => {
            log(format!("❌ commit_from_file 失败: {e}"));
            return json!({ "ok": false, "reason": e.to_string() });
        }
    };
    log(format!(
        "✅ Session 就绪，耗时 {} ms",
        t0.elapsed().as_millis()
    ));

    log("输入：");
    for i in session.inputs() {
        log(format!("  · {}  ({:?})", i.name(), i.dtype()));
    }
    log("输出：");
    for o in session.outputs() {
        log(format!("  · {}  ({:?})", o.name(), o.dtype()));
    }

    log("执行提供者 = 默认（CPU）");
    log("   → 要上 NNAPI 得在 SessionBuilder 上调 with_execution_providers(...)，");
    log("     且需接受它的算子支持范围与精度差异；是否启用等 CPU 基线出来再定。");

    let load_ms = t0.elapsed().as_millis() as u64;
    let rss_after_load = rss_mb();

    // ── 真实推理：多长度扫描 ────────────────────────────────────────────────
    // 为什么要扫多个长度：`nsf_hifigan` 的 `time` 维是动态的（-1），
    // 上游实际会喂不同长度的块。我们需要的是 **RTF 随块长的变化曲线**，
    // 它决定两件事：① 能否「边播边合成」 ② 长块下内存会不会失控。
    // 单测一个长度会给出误导性结论（可能把首次图优化的开销当成稳态开销）。
    let lengths: [i64; 5] = [64, 256, 1024, 4096, 16384];

    log("");
    log("── 推理长度扫描（同一 Session；每档冷跑 1 次 + 热跑 3 次取中位）──");
    log("   mel.time = f0.time = 填充长度；batch 维固定填 1。");
    log("   冷跑包含 ORT 针对新 shape 的图优化，热跑才是稳态。");

    let mut rows: Vec<Value> = Vec::new();
    let mut budget_exceeded = false;
    // 单档冷跑超过这个毫秒数就不再往更长测（避免探针自己把用户手机占住几分钟）
    const COLD_BUDGET_MS: u128 = 8000;

    for &fill in lengths.iter() {
        if budget_exceeded {
            log(format!("   mel.time={fill:>6}  → 跳过（上一档已超预算）"));
            continue;
        }

        let rss_before = rss_mb();
        let cold = match run_once(&mut session, fill) {
            Ok(v) => v,
            Err(e) => {
                log(format!("   mel.time={fill:>6}  → ❌ {e}"));
                rows.push(json!({ "fill": fill, "ok": false, "err": e }));
                continue;
            }
        };
        let (cold_ms, specs) = cold;

        // 找出音频输出：优先名字里含 audio，否则取元素最多的那个
        let mut audio_shape: Vec<i64> = Vec::new();
        let mut audio_name = String::new();
        let mut best_elems = 0i64;
        for (n, shp) in &specs {
            let elems: i64 = shp.iter().product();
            if n.contains("audio") || elems > best_elems {
                if n.contains("audio") || audio_shape.is_empty() {
                    audio_shape = shp.clone();
                    audio_name = n.clone();
                }
                best_elems = best_elems.max(elems);
            }
        }
        let out_samples: i64 = audio_shape.last().copied().unwrap_or(0);
        let audio_secs = out_samples as f64 / 44100.0;

        // 热跑 3 次
        let mut hot: Vec<u128> = Vec::new();
        let mut hot_err: Option<String> = None;
        for _ in 0..3 {
            match run_once(&mut session, fill) {
                Ok((ms, _)) => hot.push(ms),
                Err(e) => {
                    hot_err = Some(e);
                    break;
                }
            }
        }
        let rss_after = rss_mb();

        if let Some(e) = hot_err {
            log(format!("   mel.time={fill:>6}  → 冷 {cold_ms} ms，热跑失败: {e}"));
            rows.push(json!({ "fill": fill, "ok": false, "err": e, "cold_ms": cold_ms as u64 }));
            continue;
        }
        hot.sort_unstable();
        let med = hot[hot.len() / 2];
        let rtf = if audio_secs > 0.0 { med as f64 / 1000.0 / audio_secs } else { f64::NAN };

        log(format!(
            "   mel.time={fill:>6} | {audio_name} {audio_shape:?} = {audio_secs:.2}s 音频 \
             | 冷 {cold_ms:>5} ms | 热 {}/{}/{} (中位 {med:>4}) ms | RTF {rtf:.3} | RSS {} MB",
            hot[0], hot[1], hot[2],
            rss_after.map_or("<未知>".into(), |v| format!("{v}"))
        ));

        rows.push(json!({
            "fill": fill,
            "ok": true,
            "cold_ms": cold_ms as u64,
            "hot_ms": hot.iter().map(|v| *v as u64).collect::<Vec<u64>>(),
            "hot_median_ms": med as u64,
            "out_samples": out_samples,
            "audio_secs": (audio_secs * 1000.0).round() / 1000.0,
            "rtf": (rtf * 1000.0).round() / 1000.0,
            "rss_before_mb": rss_before,
            "rss_after_mb": rss_after,
        }));

        if cold_ms > COLD_BUDGET_MS {
            budget_exceeded = true;
            log(format!("   ⚠️ 冷跑 {cold_ms} ms 超过 {COLD_BUDGET_MS} ms 预算，不再往更长的块测"));
        }
    }

    // ── 结论 ────────────────────────────────────────────────────────────────
    log("");
    log("── 结论 ──");
    let good: Vec<(i64, f64)> = rows
        .iter()
        .filter(|r| r["ok"] == json!(true))
        .filter_map(|r| {
            let f = r["fill"].as_i64()?;
            let rtf = r["rtf"].as_f64()?;
            Some((f, rtf))
        })
        .collect();
    if good.is_empty() {
        log("❌ 没有任何一档推理成功。");
    } else {
        for (f, rtf) in &good {
            log(format!("   mel.time={f:>6}  RTF = {rtf:.3}  → 比实时快 {:.1} 倍", 1.0 / rtf));
        }
        let (f_min, rtf_min) = good[0];
        let (f_max, rtf_max) = good[good.len() - 1];
        if rtf_max <= rtf_min * 1.15 {
            log("   → RTF 基本不随块长变化 ⇒ 开销主要是**线性卷积**，稳定可预测。");
        } else if rtf_max < rtf_min {
            log(format!(
                "   → RTF 随块长**下降**（{rtf_min:.3} @ {f_min} 帧 → {rtf_max:.3} @ {f_max} 帧）\
                 ⇒ 长块更省，固定开销占比高，**建议长块合成**。"
            ));
        } else {
            log(format!(
                "   → ⚠️ RTF 随块长**上升**（{rtf_min:.3} @ {f_min} 帧 → {rtf_max:.3} @ {f_max} 帧）\
                 ⇒ 长块存在非线性膨胀，**建议短块流式**。"
            ));
        }
        if good.iter().all(|(_, r)| *r < 0.5) {
            log("   → 所有测试档 RTF < 0.5 ⇒ **这台机器上声码器不是瓶颈，可以边播边合成**。");
        }
        let mem_growth = rows
            .iter()
            .filter(|r| r["ok"] == json!(true))
            .filter_map(|r| {
                let a = r["rss_before_mb"].as_u64()?;
                let b = r["rss_after_mb"].as_u64()?;
                Some(b.saturating_sub(a))
            })
            .max()
            .unwrap_or(0);
        log(format!("   → 扫描全程 RSS 增量峰值 {mem_growth} MB（docs/06 风险 R3 的基线）"));
    }

    json!({
        "ok": true,
        "load_ms": load_ms,
        "rss_after_load_mb": rss_after_load,
        "rows": rows,
    })
}

/// 单个输入超过这么多元素就不喂（避免探针自己 OOM）。
const ELEM_LIMIT: usize = 8 * 1024 * 1024;

/// 按 `fill` 填充动态维（第 0 维视作 batch，固定填 1），为所有 f32 输入造零张量。
///
/// 只处理 f32 —— 我们不为一个探针去猜上游的语义，也要防止拿 f64/int64 张量喂错。
fn build_feeds(
    session: &ort::session::Session,
    fill: i64,
) -> Vec<(String, ort::value::DynValue)> {
    let mut feeds = Vec::new();
    for input in session.inputs() {
        let is_f32 = matches!(
            input.dtype(),
            ort::value::ValueType::Tensor {
                ty: ort::value::TensorElementType::Float32,
                ..
            }
        );
        if !is_f32 {
            continue;
        }
        let Some(sh) = input.dtype().tensor_shape() else {
            continue;
        };
        // ⚠️ 必须先按有符号 i64 判断动态维再转 usize。
        // 踩过的坑：直接 `*d as usize`，动态维 `-1` 会变成 0xFFFF_FFFF_FFFF_FFFF，
        // 后面 `product()` 直接 `attempt to multiply with overflow` panic。
        let raw: Vec<i64> = sh.iter().copied().collect();
        if raw.iter().any(|d| *d == 0) {
            continue;
        }
        let dims: Vec<usize> = raw
            .iter()
            .enumerate()
            .map(|(i, d)| {
                if *d < 0 {
                    if i == 0 {
                        1
                    } else {
                        fill as usize
                    }
                } else {
                    *d as usize
                }
            })
            .collect();
        let elems: usize = dims.iter().product();
        if elems == 0 || elems > ELEM_LIMIT {
            continue;
        }
        if let Ok(t) = ort::value::Tensor::from_array((dims, vec![0f32; elems])) {
            feeds.push((input.name().to_string(), t.into_dyn()));
        }
    }
    feeds
}

/// 跑一次推理，返回 (耗时 ms, 每个输出的 (名字, shape))。
///
/// 之所以单独成函数：`session.run()` 返回的 `SessionOutputs<'s>` 借用了 `&mut session`，
/// 放在函数尾表达式位置会触发 E0597（"borrowed value does not live long enough"）。
/// 独立成函数后，借用随函数返回自然收束。
fn run_once(
    session: &mut ort::session::Session,
    fill: i64,
) -> Result<(u128, Vec<(String, Vec<i64>)>), String> {
    let feeds = build_feeds(session, fill);
    if feeds.is_empty() {
        return Err("没有可造的 f32 输入（shape 拿到失败或超元素上限）".into());
    }
    let t = std::time::Instant::now();
    let outputs = session.run(feeds).map_err(|e| e.to_string())?;
    let ms = t.elapsed().as_millis();
    let specs: Vec<(String, Vec<i64>)> = outputs
        .iter()
        .map(|(name, v)| {
            let shp = v
                .dtype()
                .tensor_shape()
                .map(|s| s.iter().copied().collect::<Vec<i64>>())
                .unwrap_or_default();
            (name.to_string(), shp)
        })
        .collect();
    drop(outputs);
    Ok((ms, specs))
}

/// 当前进程的 RSS（MB）。Android 是 Linux，读 /proc 即可。
fn rss_mb() -> Option<u64> {
    let txt = std::fs::read_to_string("/proc/self/status").ok()?;
    for line in txt.lines() {
        if let Some(rest) = line.strip_prefix("VmRSS:") {
            let kb: u64 = rest.split_whitespace().next()?.parse().ok()?;
            return Some(kb / 1024);
        }
    }
    None
}

/// 探针该试哪些模型路径。
///
/// 设计取舍：**不把 54 MB 模型塞进探针的 APK**（会拖慢每次安装），
/// 而是让探针去几个「adb push 就能到」的位置找。
/// `/data/local/tmp` 下的文件是 0644，应用进程可以直接打开。
pub fn model_candidates(app: &tauri::AppHandle) -> Vec<String> {
    use tauri::Manager;
    let mut out: Vec<String> = Vec::new();

    // ① 外部显式指定（adb push 一个文本文件即可换模型，不用重新构建）
    for hint in ["/data/local/tmp/m0probe-model-path.txt"] {
        if let Ok(txt) = std::fs::read_to_string(hint) {
            let p = txt.trim().to_string();
            if !p.is_empty() {
                out.push(p);
            }
        }
    }

    // ② /data/local/tmp 下的常见命名
    for n in ["pc_nsf_hifigan.onnx", "nsf_hifigan.onnx", "model.onnx"] {
        out.push(format!("/data/local/tmp/{n}"));
    }

    // ③ 应用私有目录（若某次已经拷进去过）
    if let Ok(dir) = app.path().app_data_dir() {
        for n in [
            "pc_nsf_hifigan.onnx",
            "nsf_hifigan/pc_nsf_hifigan.onnx",
            "models/nsf_hifigan/pc_nsf_hifigan.onnx",
        ] {
            out.push(dir.join(n).display().to_string());
        }
    }

    out.retain(|p| std::path::Path::new(p).exists());
    out.dedup();
    out
}

#[cfg(not(target_os = "android"))]
fn dirs_like_app_data() -> Option<String> {
    std::env::var("ORT_PROBE_DIR").ok()
}

#[cfg(target_os = "android")]
fn dirs_like_app_data() -> Option<String> {
    None
}

// ─────────────────────────────────────────────────────────────────────────────
// 探针 4 · APK assets → 私有目录 拷贝（184 MB 模型的加载方案）
//
// 卡点 R4（docs/06）：resource_dir() 在 Android 返回 asset://localhost/ 而非路径，
// 而 ort 需要真实文件路径。本探针验证「用 AssetManager 把模型流式拷到 app_data_dir」
// 这条路线，并给出真实吞吐以推算 184 MB 的首次启动耗时。
// ─────────────────────────────────────────────────────────────────────────────

pub fn probe_assets_copy(app: &tauri::AppHandle) -> Value {
    use tauri::Manager;

    section("探针 4 · APK assets → app_data_dir 拷贝");

    let app_data = match app.path().app_data_dir() {
        Ok(p) => p,
        Err(e) => {
            log(format!("❌ app_data_dir 不可用: {e}"));
            return json!({ "ok": false, "reason": "app_data_dir" });
        }
    };
    log(format!("目标目录 = {}", app_data.display()));
    if let Err(e) = std::fs::create_dir_all(&app_data) {
        log(format!("❌ 创建目标目录失败: {e}"));
        return json!({ "ok": false, "reason": "mkdir" });
    }

    #[cfg(target_os = "android")]
    {
        // AssetManager 与 cpal 一样依赖 ndk_context，先确保它可用（幂等）
        if let Err(e) = jvm::init_ndk_context() {
            log(format!("⚠️ ndk_context 初始化失败: {e}"));
        }

        // Tauri 把 bundle.resources 放进 APK 时到底加不加前缀，是个未知数；
        // 三个候选路径逐个试，并把命中者报出来（顺便回答 "Tauri 的 assets 前缀是什么"）。
        let candidates = ["probe.bin", "resources/probe.bin", "assets/probe.bin"];
        let mut hit: Option<(&str, u64)> = None;
        for name in candidates {
            match asset_len(name) {
                Some(len) => {
                    log(format!("✅ assets/{name} 存在，声明长度 {len} 字节"));
                    hit = Some((name, len));
                    break;
                }
                None => log(format!("  assets/{name} 打不开（不存在或不可读）")),
            }
        }
        let Some((name, declared)) = hit else {
            log("❌ 三个候选路径都打不开");
            log("   → 需确认 Tauri 把 bundle.resources 放进 APK 的前缀：");
            log("     unzip -l app-x86_64-debug.apk | grep probe.bin");
            return json!({ "ok": false, "reason": "asset_not_found" });
        };

        let dst = app_data.join("probe.bin");
        let (total, elapsed) = match copy_asset_to_file(name, &dst) {
            Ok(v) => v,
            Err(e) => {
                log(format!("❌ 拷贝失败: {e}"));
                return json!({ "ok": false, "reason": e });
            }
        };

        let mb = total as f64 / 1024.0 / 1024.0;
        let mbps = mb / elapsed.as_secs_f64().max(1e-6);
        log(format!(
            "✅ 拷贝完成：{mb:.1} MB，耗时 {} ms，吞吐 {mbps:.1} MB/s",
            elapsed.as_millis()
        ));
        log(format!(
            "   来源 assets/{name}（声明 {declared} 字节）→ {}",
            dst.display()
        ));

        // 外推到真实的 184 MB 模型（nsf_hifigan 54 + hnsep 88 + fcpe 41）
        let est_184 = 184.0 / mbps.max(1e-6);
        log(format!("   按此吞吐推算 184 MB 模型拷贝约需 {est_184:.1} 秒"));
        if est_184 > 15.0 {
            log("   ⚠️ 超过 15 秒 → 首次启动必须有进度条 + 可取消（docs/01 §5 卡点 1）");
        }

        // 看一眼落在哪个真实路径上：确认 app_data_dir 是否真是可写文件系统路径
        match std::fs::metadata(&dst) {
            Ok(m) => log(format!("   落盘校验：{} 字节 ✓", m.len())),
            Err(e) => log(format!("   ⚠️ 落盘后 stat 失败: {e}")),
        }

        return json!({
            "ok": true,
            "asset": name,
            "bytes": total,
            "declared": declared,
            "ms": elapsed.as_millis() as u64,
            "mbps": mbps,
        });
    }

    #[cfg(not(target_os = "android"))]
    {
        log("（非 Android 平台，跳过。桌面请直接用 cargo run）");
        json!({ "ok": true, "skipped": true })
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Android · APK assets 读取
//
// 为什么不用 `ndk::asset::AssetManager`（试过，编译不过）：
//   ndk 0.9.0 的 `AssetManager` 只有 `from_ptr(NonNull<ndk_sys::AAssetManager>)`，
//   **没有 `from_java`**；而 ndk 0.9 又没有把 `ndk_sys` 公开重导出
//   （`src/lib.rs` 里没有 `pub use ndk_sys`，`asset.rs` 用的是私有 `ffi` 别名），
//   所以我们没法在不额外声明 `ndk-sys = "0.6.0+11769913"` 的情况下命名那个指针类型
//   —— 那会把我们的代码和 ndk 的内部依赖版本绑死，ndk 一升级就类型不匹配。
//
//   改用：直接声明 `AAsset*` 的 C FFI。这是稳定的公开 NDK API，
//   对应的符号在 **libandroid.so**（不是 libc），NDK sysroot 里两个 ABI 都有 stub。
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(target_os = "android")]
mod aasset {
    use std::ffi::{c_char, c_int, c_void, CString};

    #[link(name = "android")]
    extern "C" {
        fn AAssetManager_fromJava(env: *mut c_void, asset_manager: *mut c_void) -> *mut c_void;
        fn AAssetManager_open(
            mgr: *mut c_void,
            filename: *const c_char,
            mode: c_int,
        ) -> *mut c_void;
        fn AAsset_getLength64(asset: *mut c_void) -> i64;
        fn AAsset_read(asset: *mut c_void, buf: *mut c_void, count: usize) -> c_int;
        fn AAsset_close(asset: *mut c_void);
    }

    /// `AASSET_MODE_STREAMING` —— 顺序读整个资产，内部走解压流。
    /// （enum：UNKNOWN=0, RANDOM=1, STREAMING=2, BUFFER=3）
    const MODE_STREAMING: c_int = 2;

    /// 取原生 `AAssetManager*`。返回的指针由 Java 侧持有，**不可释放**。
    ///
    /// # Safety
    /// `env` 必须是当前线程有效的 `JNIEnv*`。
    pub unsafe fn manager_from_java(env: *mut c_void, java_am: *mut c_void) -> *mut c_void {
        unsafe { AAssetManager_fromJava(env, java_am) }
    }

    /// 持有 `AAsset*` 的 RAII 包装，`Drop` 时 `AAsset_close`。
    pub struct RawAsset {
        ptr: *mut c_void,
    }

    impl RawAsset {
        /// # Safety
        /// `mgr` 必须来自 `manager_from_java`。
        pub unsafe fn open(mgr: *mut c_void, name: &str) -> Option<Self> {
            let cname = CString::new(name).ok()?;
            let ptr = unsafe { AAssetManager_open(mgr, cname.as_ptr(), MODE_STREAMING) };
            (!ptr.is_null()).then_some(Self { ptr })
        }

        /// 资产声明长度（用于和实际拷贝字节数交叉验证）。
        pub fn len(&self) -> u64 {
            unsafe { AAsset_getLength64(self.ptr).max(0) as u64 }
        }

        /// 读一段。返回 0 表示 EOF，负数转成 `io::Error`。
        pub fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
            let n = unsafe { AAsset_read(self.ptr, buf.as_mut_ptr().cast(), buf.len()) };
            if n < 0 {
                Err(std::io::Error::last_os_error())
            } else {
                Ok(n as usize)
            }
        }
    }

    impl Drop for RawAsset {
        fn drop(&mut self) {
            unsafe { AAsset_close(self.ptr) }
        }
    }
}

/// 在一个作用域内拿到原生 `AAssetManager*` 并执行 `f`。
///
/// 要点：`attach_current_thread` 返回的 guard 在 drop 时 detach，而
/// `AAssetManager_fromJava` 要求**调用时**线程是 attached 的；把 guard 留在本函数
/// 作用域内（`f` 执行期间仍然存活）即可，无需把 `JNIEnv` 往上层传。
/// 拿到 `AAssetManager*` 之后所有读取都是纯原生调用，不再需要 JNI。
#[cfg(target_os = "android")]
fn with_assets<R>(f: impl FnOnce(*mut std::ffi::c_void) -> R) -> Option<R> {
    let ctx = ndk_context::android_context();
    if ctx.vm().is_null() || ctx.context().is_null() {
        log("❌ ndk_context 未初始化（JavaVM / Activity 为空指针），拿不到 AssetManager");
        return None;
    }
    let vm = unsafe { jni::JavaVM::from_raw(ctx.vm().cast()) }.ok()?;
    let mut env = vm.attach_current_thread().ok()?;
    let activity = unsafe { jni::objects::JObject::from_raw(ctx.context().cast()) };
    let java_am = env
        .call_method(
            &activity,
            "getAssets",
            "()Landroid/content/res/AssetManager;",
            &[],
        )
        .ok()?
        .l()
        .ok()?;

    let raw_env: *mut std::ffi::c_void = env.get_native_interface().cast();
    let raw_am: *mut std::ffi::c_void = java_am.as_raw().cast();
    let mgr = unsafe { aasset::manager_from_java(raw_env, raw_am) };
    if mgr.is_null() {
        log("❌ AAssetManager_fromJava 返回空指针");
        return None;
    }

    Some(f(mgr))
}

/// 打开资产并返回其声明长度；打不开返回 `None`。
#[cfg(target_os = "android")]
fn asset_len(name: &str) -> Option<u64> {
    with_assets(|mgr| unsafe { aasset::RawAsset::open(mgr, name) }.map(|a| a.len()))?
}

/// 把 APK 里的资产流式拷到 `dst`，返回 (字节数, 耗时)。
#[cfg(target_os = "android")]
fn copy_asset_to_file(
    name: &str,
    dst: &std::path::Path,
) -> Result<(u64, std::time::Duration), String> {
    use std::io::Write;

    let outcome = with_assets(|mgr| -> Result<(u64, std::time::Duration), String> {
        let Some(mut asset) = (unsafe { aasset::RawAsset::open(mgr, name) }) else {
            return Err(format!("AAssetManager_open(\"{name}\") 返回空"));
        };
        let declared = asset.len();
        let mut file = std::fs::File::create(dst)
            .map_err(|e| format!("创建 {} 失败: {e}", dst.display()))?;

        let t0 = std::time::Instant::now();
        let mut buf = vec![0u8; 256 * 1024];
        let mut total: u64 = 0;
        loop {
            let n = asset
                .read(&mut buf)
                .map_err(|e| format!("AAsset_read 在 {total} 字节处失败: {e}"))?;
            if n == 0 {
                break;
            }
            file.write_all(&buf[..n])
                .map_err(|e| format!("写入在 {total} 字节处失败: {e}"))?;
            total += n as u64;
        }
        let elapsed = t0.elapsed();
        let _ = file.flush();
        if declared != total {
            log(format!(
                "⚠️ AAsset_getLength64 报 {declared} 字节，实际读到 {total} 字节（资产可能被压缩）"
            ));
        }
        Ok((total, elapsed))
    });

    outcome.ok_or_else(|| "ndk_context 未初始化 / AssetManager 构造失败".to_string())?
}

#[cfg(target_os = "android")]
fn android_native_lib_dir() -> Option<String> {
    let ctx = ndk_context::android_context();
    if ctx.vm().is_null() || ctx.context().is_null() {
        return None;
    }
    let vm = unsafe { jni::JavaVM::from_raw(ctx.vm().cast()) }.ok()?;
    let mut env = vm.attach_current_thread().ok()?;
    let activity = unsafe { jni::objects::JObject::from_raw(ctx.context().cast()) };
    let app_info = env
        .call_method(&activity, "getApplicationInfo", "()Landroid/content/pm/ApplicationInfo;", &[])
        .ok()?
        .l()
        .ok()?;
    let dir = env
        .get_field(&app_info, "nativeLibraryDir", "Ljava/lang/String;")
        .ok()?
        .l()
        .ok()?;
    let js = jni::objects::JString::from(dir);
    let s: String = env.get_string(&js).ok()?.into();
    log(format!("nativeLibraryDir = {s}"));
    Some(s)
}

#[cfg(not(target_os = "android"))]
fn android_native_lib_dir() -> Option<String> {
    None
}
