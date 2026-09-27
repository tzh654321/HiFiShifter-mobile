fn main() {
    // 把编译目标三元组注入到二进制里，探针日志里会打印出来
    // （用于确认我们确实在编 aarch64-linux-android 而不是误编了桌面版本）
    let target = std::env::var("TARGET").unwrap_or_else(|_| "<unknown>".into());
    println!("cargo:rustc-env=PROBE_TARGET={target}");

    tauri_build::build()
}
