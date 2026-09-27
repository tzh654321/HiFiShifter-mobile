//! M0 探针 · Tauri 外壳
//!
//! 前端只做两件事：调 `run_probe` 触发，调 `read_log` 轮询结果。
//! 所有耗时探针都在独立线程里跑，命令立即返回（避免卡 UI，也让 `!Send` 的
//! cpal `Stream` 能在创建它的线程里销毁）。

mod probes;

use tauri::Manager;

/// 触发一个探针（立即返回，结果用 `read_log` 轮询）。
///
/// name 取值：
/// - `env`        环境与路径
/// - `ndk`        ndk_context 可用性
/// - `cpal`       cpal / Oboe 出声（arg = 秒数，默认 3）
/// - `ort_init`   ort 运行时初始化（arg = 指定 so 路径，可空）
/// - `ort_model`  ort 加载模型 + 推理（arg = 模型绝对路径）
/// - `assets`     APK assets → app_data_dir 拷贝计时
/// - `all`        按 env → ndk → cpal → assets → ort_init 顺序跑一遍
#[tauri::command]
fn run_probe(app: tauri::AppHandle, name: String, arg: Option<String>) -> Result<(), String> {
    let arg = arg.filter(|s| !s.trim().is_empty());
    std::thread::spawn(move || { run_one(&app, &name, arg.as_deref()) });
    Ok(())
}

/// 跑一个探针。每一项都独立兜底 panic —— 否则一项崩溃会带走整条链路。
fn run_one(app: &tauri::AppHandle, name: &str, arg: Option<&str>) {
    match name {
        "env" => probes::guarded("env", || {
            probes::probe_env(app);
        }),
        "ndk" => probes::guarded("ndk", || {
            probes::probe_ndk_context();
        }),
        "cpal" => {
            let secs = arg.and_then(|s| s.parse::<f32>().ok()).unwrap_or(3.0);
            probes::guarded("cpal", || {
                probes::probe_cpal_start(secs);
            });
        }
        "ort_init" => probes::guarded("ort_init", || {
            probes::probe_ort_init(arg.map(str::to_string));
        }),
        "ort_model" => {
            let p = arg.unwrap_or_default().to_string();
            probes::guarded("ort_model", || {
                probes::probe_ort_model(p);
            });
        }
        "assets" => probes::guarded("assets", || {
            probes::probe_assets_copy(app);
        }),
        "all" => run_all(app),
        other => probes::log(format!("未知探针：{other}")),
    }
}

/// 全量探针。顺序有讲究：**ndk_context 必须最先补**，
/// 否则后面的 assets(AssetManager) 与 cpal(Oboe) 都会因它没初始化而挂。
fn run_all(app: &tauri::AppHandle) {
    probes::guarded("env", || {
        probes::probe_env(app);
    });
    probes::guarded("ndk", || {
            probes::probe_ndk_context();
        });
    probes::guarded("assets", || {
        probes::probe_assets_copy(app);
    });
    probes::guarded("ort_init", || {
        probes::probe_ort_init(None);
    });

    // 3b：只要设备上有真实模型（adb push 到 /data/local/tmp 即可），就顺手跑一遍加载 + 推理
    let models = probes::model_candidates(app);
    if models.is_empty() {
        probes::log("");
        probes::log("（未发现真实模型，跳过探针 3b。放一个到 /data/local/tmp/ 即可，见 probes/README）");
    } else {
        for m in models {
            let m2 = m.clone();
            probes::guarded("ort_model", move || {
                probes::probe_ort_model(m2);
            });
        }
    }
    // cpal 会放音 3 秒，放最后，免得住塞其他日志的时序
    probes::guarded("cpal", || {
        probes::probe_cpal_start(3.0);
    });
}

#[tauri::command]
fn read_log() -> Vec<String> {
    probes::snapshot()
}

#[tauri::command]
fn clear_log() {
    probes::clear();
}

/// 让前端能问出「模型应该拷到哪」而不必自己拼路径。
#[tauri::command]
fn app_data_dir(app: tauri::AppHandle) -> Result<String, String> {
    app.path()
        .app_data_dir()
        .map(|p| p.display().to_string())
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            run_probe,
            read_log,
            clear_log,
            app_data_dir
        ])
        .setup(|app| {
            // 落盘日志：真机（尤其 ColorOS）上 logcat 拿不到应用日志，
            // 这条路才能用 `run-as cat` 把全文取回来。
            if let Ok(dir) = app.path().app_data_dir() {
                probes::init_file_log(dir.join("probe.log"));
            }
            probes::log("M0 探针启动。日志三通道：logcat(tag PROBE) / 落盘 / 界面。");
            probes::log("真机上取全文：adb exec-out run-as com.hifishifter.m0probe cat files/probe.log");

            // 自动跑一遍全量探针：这样整条链路可以纯脚本化
            // （install → launch → 等 N 秒 → 读 logcat），不必用 adb 去点界面按钮。
            // 界面上那排按钮仍然保留，用于单独复跑某一项。
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(1500));
                probes::log("");
                probes::log("═══ 自动执行：全量探针 ═══");
                run_all(&handle);
                probes::log("");
                probes::log("═══ 自动探针已全部触发；cpal 正在放音 3 秒 ═══");
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
