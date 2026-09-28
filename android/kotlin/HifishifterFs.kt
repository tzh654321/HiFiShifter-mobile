package com.arounder.hifishifter

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.IBinder
import android.os.Parcel
import android.os.Looper
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import android.content.ComponentName
import android.content.Intent
import android.content.ServiceConnection
import android.provider.DocumentsContract
import org.json.JSONArray
import org.json.JSONObject
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Log
import rikka.shizuku.Shizuku
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

/*
 * ⚠️ HS-SAF-PATCH —— 本文件是**真源**，位于仓库 `android/kotlin/`，
 * 由 scripts/setup-gen-android.sh 拷进 gen/android 的 Java 源码目录。
 * gen/ 是 `tauri android init` 的生成物，直接改会被抹掉。
 *
 * ## 为什么需要它
 *
 * Android 不允许应用浏览文件系统路径，正确入口是 SAF（Storage Access Framework）：
 * 由系统选择器返回 `content://` URI。而上游是**路径驱动**的（几十处
 * `std::fs::File::open(path)`，工程文件里存的就是路径），把 `content://` 一路透传
 * 会破坏上游架构。所以走「**边界物化**」：在这里拿到 URI 后立刻把流拷进
 * `cacheDir/saf_import/`，把**真实路径**交回 Rust，上游 IO 一行不改。
 *
 * 位置选 cache 而不是 files：导入是一次性动作，上游会把音频解码进自己的缓存/内存，
 * 原始副本不必长期留存；放 cache 让系统在低存储时可回收。模型等长期资产走 app_data_dir。
 *
 * 完整设计与取舍见 `docs/11-SAF文件访问设计.md`。
 */
object HifishifterFs {
    const val KIND_OPEN = 0
    const val KIND_SAVE = 1
    const val KIND_TREE = 2

    private const val TAG = "HS-SAF"
    private const val IMPORT_DIR = "saf_import"

    /** 导出中转目录（保存方向）。与 `saf_import` 分开，便于各自清理。 */
    private const val EXPORT_DIR = "saf_export"
    private const val MAX_NAME_LEN = 96
    private const val PRUNE_AGE_MS = 24L * 60 * 60 * 1000

    /**
     * requestCode 基址。两个约束：
     *   · 必须 < 65536 —— `FragmentActivity.startActivityForResult` 会按 16 位校验；
     *   · 要避开 `ActivityResultRegistry` 自己分配的随机码（它从 >= 0x10000 起），
     *     否则会与 WebView 的文件选择器撞码。
     */
    // Shizuku 授权请求码：与 SAF 的保留区间错开，避免撞码。
private const val REQ_SHIZUKU = 0x5AF0 + 200
private const val RC_BASE = 0x5AF0
    private const val RC_SLOTS = 128

    @Volatile
    private var activity: Activity? = null

    /**
     * requestCode → (Rust 侧 requestId, kind)。
     *
     * ⚠️ 2026-09-22 起**必须连 kind 一起记**：`onActivityResult` 里要按 kind 分派 ——
     * 导入（KIND_OPEN）是把 `content://` 拷进 cacheDir（materialize），
     * 而**保存（KIND_SAVE）方向正好相反**：用户选的 URI 是"要写到哪儿"，
     * 那时 cacheDir 里还没有文件，materialize 只会失败或拷到空文件。
     */
    /** 一次 SAF 请求的上下文：结果回来时要用 mime / suggestedName 记住保存位置。 */
    private data class PendingReq(
        val requestId: Long,
        val kind: Int,
        val mime: String,
        val suggestedName: String?,
    )

    private val pending = ConcurrentHashMap<Int, PendingReq>()
    private val slot = AtomicInteger(0)

    /** 由 MainActivity.onCreate 调用（setup-gen-android.sh 注入这一行）。 */
    fun attach(a: Activity) {
        activity = a
        // 顺手清掉过期的导入副本（用户反复导入大文件时 cache 会涨）。
        runCatching { pruneOldImports(a) }
        /* N2-S：注册 Shizuku 授权结果监听（只注册一次）。
           用 try/catch 包住：没装 Shizuku 的设备上这个调用会抛（provider 找不到），
           绝不能让它把 attach 带崩 —— 那会连累 SAF 的初始化。 */
        if (!shizukuListenerAttached) {
            try {
                Shizuku.addRequestPermissionResultListener { requestCode, grantResult ->
                    if (requestCode == REQ_SHIZUKU) {
                        Log.i(TAG, "Shizuku 授权结果: grantResult=$grantResult")
                    }
                }
                shizukuListenerAttached = true
            } catch (t: Throwable) {
                Log.i(TAG, "Shizuku 不可用（未装/未运行），跳过监听注册: ${t.javaClass.simpleName}")
            }
        }
    }

    /** Shizuku 权限结果监听是否已注册（只注册一次）。 */
    @Volatile
    private var shizukuListenerAttached = false

    /** 把文本放进系统剪贴板（供"复制 Shizuku 命令"用）。 */
    @JvmStatic
    fun copyToClipboard(text: String): Boolean {
        return try {
            val act = activity ?: return false
            val cm =
                act.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
                    ?: return false
            cm.setPrimaryClip(ClipData.newPlainText("HiFiShifter", text))
            true
        } catch (t: Throwable) {
            Log.w(TAG, "copyToClipboard 失败", t)
            false
        }
    }

    // ── Shizuku user service（v13 唯一受支持的"以 shell 身份干活"入口）─────────
    //
    // 为什么走这条路：Android 11+ 把 `Android/data`/`Android/obb` 排除在
    // MANAGE_EXTERNAL_STORAGE 之外、SAF 也拒绝选它们 ⇒ 只有 shell 身份能读；
    // 而 v13 的 `Shizuku` 类没有 `newProcess`（javap 实证），必须用 bindUserService。
    // 服务实现见 `HsShellService.kt`（跑在 `:shizuku` 独立进程、由 Shizuku 以 shell 身份启动）。

    private var shellService: IBinder? = null

    private val shellConnection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, service: IBinder?) {
            shellService = service
            Log.i(TAG, "Shizuku user service 已连接")
        }

        override fun onServiceDisconnected(name: ComponentName?) {
            shellService = null
            Log.w(TAG, "Shizuku user service 断开")
        }
    }

    /**
     * 手工 Binder 事务（**刻意不用 AIDL**，见 `HsShellService` 的说明）：
     * AIDL 的生成物会把构建命令行整条塞进注释，而本项目路径含 `\upstream-src` /
     * `\universalDebug` —— javac 见到 `\u` 就报 illegal unicode escape，那条路在本机走不通。
     * 协议码定义在 `HsShellProtocol`（与服务端逐字一致）。
     */
    private fun shellTransact(code: Int, arg: String, arg2: String? = null): String {
        val binder = shellService ?: return ""
        val data = Parcel.obtain()
        val reply = Parcel.obtain()
        return try {
            data.writeInterfaceToken(HsShellProtocol.DESCRIPTOR)
            data.writeString(arg)
            if (arg2 != null) data.writeString(arg2)
            binder.transact(code, data, reply, 0)
            reply.readException()
            reply.readString() ?: ""
        } catch (t: Throwable) {
            Log.w(TAG, "shellTransact($code) 失败", t)
            ""
        } finally {
            data.recycle()
            reply.recycle()
        }
    }

    /** 绑定 shell 服务（幂等）。返回是否已发起绑定。 */
    @JvmStatic
    fun bindShellService(): Boolean {
        if (shellService != null) return true
        val act = activity ?: return false
        return try {
            if (!Shizuku.pingBinder()) return false
            val args = Shizuku.UserServiceArgs(ComponentName(act.packageName, HsShellService::class.java.name))
                .daemon(false)
                .processNameSuffix("shizuku")
                .debuggable(false)
                .version(1)
            Shizuku.bindUserService(args, shellConnection)
            Log.i(TAG, "已请求绑定 Shizuku user service")
            true
        } catch (t: Throwable) {
            Log.w(TAG, "bindUserService 失败", t)
            false
        }
    }

    /** shell 服务当前是否就绪（绑定是异步的 ⇒ 前端可轮询）。 */
    @JvmStatic
    fun shellServiceReady(): Boolean = shellService != null

    /** 以 shell 身份执行命令（未就绪时返回 `not-ready`，绝不阻塞）。 */
    @JvmStatic
    fun shellExec(command: String): String = try {
        if (shellService == null) "not-ready" else shellTransact(HsShellProtocol.TX_EXEC, command)
    } catch (t: Throwable) {
        Log.w(TAG, "shellExec 失败", t)
        "error:${t.javaClass.simpleName}:${t.message}"
    }

    /** 以 shell 身份列举目录（返回 JSON 数组；未就绪返回 `{"error":"not-ready"}`）。 */
    @JvmStatic
    fun shellListDir(path: String): String = try {
        if (shellService == null) "{\"error\":\"not-ready\"}" else shellTransact(HsShellProtocol.TX_LIST_DIR, path)
    } catch (t: Throwable) {
        Log.w(TAG, "shellListDir 失败", t)
        "{\"error\":\"${t.javaClass.simpleName}:${t.message}\"}"
    }

    /** 以 shell 身份把文件复制进应用中转目录，返回本地可读路径（未就绪返回空串）。 */
    @JvmStatic
    fun shellCopyToCache(path: String): String = try {
        if (shellService == null) {
            ""
        } else {
            /* 目标目录由这里给（服务进程没有 Context / 包名不可靠）：
               应用**外部** files 目录 —— shell 身份可写、本应用可读。 */
            val destDir = activity?.getExternalFilesDir(null)?.absolutePath ?: ""
            shellTransact(HsShellProtocol.TX_COPY_TO_CACHE, path, destDir)
        }
    } catch (t: Throwable) {
        Log.w(TAG, "shellCopyToCache 失败", t)
        ""
    }

    /** shell 身份下是否可读（用于给出明确提示）。 */
    @JvmStatic
    fun shellCanRead(path: String): Boolean = try {
        if (shellService == null) false else shellTransact(HsShellProtocol.TX_CAN_READ, path) == "1"
    } catch (t: Throwable) {
        false
    }

    /**
     * ⚠️ **已废弃、不再调用**（保留仅为记录教训，别再用它）：
     * ① `dev.rikka.shizuku:api:13.1.5` 的公开 API 里**根本没有** `newProcess`
     *    （`javap -public rikka.shizuku.Shizuku` 列到 `exit()` 为止），
     *    所以反射必然拿不到方法；
     * ② 真机上"用 Shizuku 开全盘访问"那条同步路径会**整进程原生 abort**（无 Java 栈），
     *    已排除同步线程、`V3_SUPPORT` meta-data 两个原因，栈只在 tombstone 里（需 root）。
     * ⇒ 现在改用 user service（见上）。
     */
    @Suppress("unused")
    private fun newShizukuProcess(cmd: Array<String>): Process? = try {
        val m = Shizuku::class.java.getDeclaredMethod(
            "newProcess",
            Array<String>::class.java,
            Array<String>::class.java,
            String::class.java,
        )
        m.isAccessible = true
        @Suppress("UNCHECKED_CAST")
        m.invoke(null, cmd, null, null) as? Process
    } catch (t: Throwable) {
        Log.w(TAG, "反射调用 Shizuku.newProcess 失败", t)
        null
    }

    /**
     * 由 Rust 经 JNI 调用。`@JvmStatic` ⇒ 生成静态方法，JNI 侧用
     * `CallStaticVoidMethod(cls, "request", "(JILjava/lang/String;Ljava/lang/String;)V", ...)`。
     *
     * ⚠️ 必须在**非 UI 线程**调用并由调用方主动等待结果 —— 本函数立刻返回。
     */
    @JvmStatic
    fun request(requestId: Long, kind: Int, mime: String, suggestedName: String?) {
        val act = activity
        if (act == null) {
            nativeOnResult(requestId, kind, null, null, "saf_no_activity")
            return
        }
        // 保存方向：同一个「用途」上次已经选过位置就直接复用，**不再弹框**
        //（用户口径：一个工程只有初次保存需要打开文件管理）。
        if (kind == KIND_SAVE) {
            // 这里在 `request` 里，mime / suggestedName 就是本函数的参数。
            val key = saveKey(mime, suggestedName)
            val saved = prefs(act).getString(key, null)
            if (saved != null && saved.isNotEmpty()) {
                Log.i(TAG, "复用已记住的保存位置 [$key] = $saved")
                nativeOnResult(requestId, kind, saved, suggestedName, null)
                return
            }
        }

        val requestCode = RC_BASE + slot.getAndIncrement() % RC_SLOTS
        pending[requestCode] = PendingReq(requestId, kind, mime, suggestedName)
        try {
            act.startActivityForResult(buildIntent(kind, mime, suggestedName), requestCode)
        } catch (t: Throwable) {
            pending.remove(requestCode)
            Log.w(TAG, "startActivityForResult 失败", t)
            nativeOnResult(requestId, kind, null, null, "saf_start_failed: ${t.message}")
        }
    }

    /** 由 MainActivity.onActivityResult 转发（setup-gen-android.sh 注入那个 override）。 */
    fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        val entry = pending.remove(requestCode) ?: return // 不是我们的码，放行
        val requestId = entry.requestId
        val kind = entry.kind
        // 🔴 2026-09-22：这里必须留下 resultCode —— 用户报「点保存却显示已取消」，
        //    而日志里只能看到 Rust 侧那句「→ 用户取消」，**看不出到底是谁判的取消**。
        //    两条来源截然不同：resultCode 不对（系统/我们误判）vs 用户真按了返回。
        Log.i(TAG, "onActivityResult rc=$requestCode kind=$kind resultCode=$resultCode " +
                "hasData=${data != null} uri=${data?.data}")
        // 🔴 2026-09-22 修复：**判定顺序反过来了 —— 先看有没有 URI，再看 resultCode。**
        //
        // 用户报「点保存却显示已取消保存、只留一个 0 B 文件」，实测日志里只剩我们那句
        // 「→ 用户取消」，说明是 Kotlin 这边回传了 saf_cancelled。
        //
        // 根因：**部分 ROM（ColorOS 实测）在用户正常选完位置、data 里带回 URI 的情况下，
        // 依然回 RESULT_CANCELED**。原来的  就把这次
        // 正常保存判成了取消。（那个 0 B 文件是系统按用户选择**预先创建**的占位，
        // 我们没上传，所以是空的。）
        //
        // 语义上也是「有 URI 才叫选定了」：data 为空才是真取消。
        val uri = data?.data
        val act = activity
        if (uri == null) {
            Log.i(TAG, "没有回传 URI，按用户取消处理（resultCode=$resultCode）")
            nativeOnResult(requestId, kind, null, null, "saf_cancelled")
            return
        }
        if (act == null) {
            nativeOnResult(requestId, kind, null, null, "saf_no_activity")
            return
        }
        if (resultCode != Activity.RESULT_OK) {
            // 只是留痕：URI 有效就继续往下走（见上面 ROM 的说明）。
            Log.w(TAG, "resultCode=$resultCode 但 data 里有 URI，按成功处理（ROM 行为）")
        }
        if (kind == KIND_SAVE) {
            // 把这次选的位置记下来：同一个用途下次直接用，不再弹框
            // （用户口径：一个工程只有初次保存需要打开文件管理）。
            // ⚠️ mime / suggestedName 取自 `entry`（发起请求时存下的），**不是**本函数的
            // 参数 —— `onActivityResult` 签名由 Activity 决定，加不了参数。
            val key = saveKey(entry.mime, entry.suggestedName)
            runCatching {
                act.contentResolver.takePersistableUriPermission(
                    uri, Intent.FLAG_GRANT_WRITE_URI_PERMISSION,
                )
            }.onFailure { Log.w(TAG, "takePersistableUriPermission 失败（下次仍会弹框）", it) }
            prefs(act).edit().putString(key, uri.toString()).apply()
            Log.i(TAG, "已记住保存位置 [$key] = $uri")
        }
        try {
            val name = queryDisplayName(act, uri)
            if (kind == KIND_SAVE) {
                // 保存方向：URI 是"写到哪里"，**不能** materialize（此时 cacheDir 里还没东西）。
                // 把 URI 原样回传，Rust 侧生成 cacheDir 临时路径给调用方写，写完再经
                // `writeToUri` 送回来。见 docs/11 §3.5。
                nativeOnResult(requestId, kind, uri.toString(), name, null)
            } else if (kind == KIND_TREE) {
                // 目录（#8）：把 tree URI 原样回传，并**持久化授权**，否则进程重启后失效。
                // 目录同样不能 materialize（里面可能成千上万个文件）。
                runCatching {
                    act.contentResolver.takePersistableUriPermission(
                        uri,
                        Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION,
                    )
                }.onFailure { Log.w(TAG, "tree 持久化授权失败（重启后要重新选目录）", it) }
                prefs(act).edit().putString(PREF_TREE_URI, uri.toString()).apply()
                Log.i(TAG, "已记住目录授权：$uri")
                nativeOnResult(requestId, kind, uri.toString(), name, null)
            } else {
                val path = materialize(act, uri, name)
                nativeOnResult(requestId, kind, path, name, null)
            }
        } catch (t: Throwable) {
            Log.w(TAG, "处理 $uri 失败", t)
            nativeOnResult(requestId, kind, null, null, "saf_materialize_failed: ${t.message}")
        }
    }

    /** 已授权的默认目录 tree URI（没授权过返回空串）。 */
    @JvmStatic
    fun savedTreeUri(): String {
        val act = activity ?: return ""
        return prefs(act).getString(PREF_TREE_URI, "") ?: ""
    }

    /**
     * N2：是否已具备「所有文件访问」（`MANAGE_EXTERNAL_STORAGE`）。
     *
     * 为什么需要它：Android 10+ 的分区存储下，无授权时 `readdir()` 会**静默隐藏**
     * 应用读不到的文件（目录还在、文件直接不出现、**系统不报错**）⇒ 文件浏览器只能
     * 显示一份"被截断但看起来正常"的列表。把它暴露给上层，UI 才能在列表不可信时
     * 提示用户去授权，而不是让用户以为"这个文件夹是空的"。
     *
     * 该权限的两种来源：系统设置里的「所有文件访问」，或 Shizuku 自助授权
     * （`appops set <pkg> MANAGE_EXTERNAL_STORAGE allow`，见 docs/18 §4）。
     * 两者都会让这个函数返回 true。
     */
    @JvmStatic
    fun isExternalStorageManager(): Boolean = try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            Environment.isExternalStorageManager()
        } else {
            false
        }
    } catch (t: Throwable) {
        Log.w(TAG, "isExternalStorageManager 查询失败", t)
        false
    }

    /** 共享存储根（通常 `/storage/emulated/0`）。取不到返回空串。 */
    @JvmStatic
    fun sharedStorageRoot(): String = try {
        Environment.getExternalStorageDirectory()?.absolutePath ?: ""
    } catch (t: Throwable) {
        Log.w(TAG, "sharedStorageRoot 查询失败", t)
        ""
    }

    /**
     * 应用**自有**外部目录（`/storage/emulated/0/Android/data/<pkg>/files`）。
     *
     * 为什么单列出来：这个目录**不需要任何授权就能按路径读写**（实测 44100/1ch/2s 读成功），
     * 所以它虽然物理上位于共享存储之内，却**不该**被判成"列表不可信"——
     * 否则用户浏览自己的导出目录时会看到一条误导性的"未授权"提示。
     */
    @JvmStatic
    fun ownExternalRoot(): String = try {
        activity?.getExternalFilesDir(null)?.absolutePath ?: ""
    } catch (t: Throwable) {
        Log.w(TAG, "ownExternalRoot 查询失败", t)
        ""
    }

    /**
     * N2-S：**通过 Shizuku 自助拿到「全部文件访问」**（非 root 机）。
     *
     * 原理：Shizuku 让普通应用借到 **shell(adb) 身份**，于是能执行系统自带的
     *   `appops set <pkg> MANAGE_EXTERNAL_STORAGE allow`
     * 之后 `Environment.isExternalStorageManager()` 为真 —— 与用户手动去系统设置打开
     * 「所有文件访问」**完全等效**，只是省掉那几步（详见 docs/18 §4）。
     *
     * 返回值约定（Rust 侧原样回给前端做提示）：
     *   `""`                     成功
     *   `"no-activity"`          Activity 未 attach
     *   `"shizuku-unavailable"`  Shizuku 未安装 / 未运行
     *   `"shizuku-no-permission"` 本应用尚未被 Shizuku 授权（先走 requestShizukuPermission）
     *   `"appops-failed:<code>:<stderr>"` 命令失败（部分 ROM 限制 appops）
     */
    @JvmStatic
    fun grantAllFilesViaShizuku(): String {
        /* 🔴 真机结论（2026-09-28，用户报「点用 Shizuku 授权时软件直接闪退」）：
           只要真正调用 Shizuku 客户端库的**功能型** API（`requestPermission` / 起进程），
           应用就会**整进程原生 abort** —— 没有 Java 栈、`dumpsys dropbox` 也查不到，
           栈只在 tombstone 里（需要 root 才能读）。
           已排除的：① 同步阻塞（改为主线程 + 异步后仍崩）；
                     ② provider 少 `moe.shizuku.client.V3_SUPPORT` meta-data（补上后仍崩）；
                     ③ `newProcess` 反射（13.1.5 的公开 API 里**根本没有**这个方法）。
           ⇒ 在拿到 tombstone 定位之前，**不再调用任何有崩溃风险的功能型 API**。
           改为对用户**安全且同样有效**的两条路：
             · 本函数：把 `appops` 命令**复制到剪贴板**（用户可在 Shizuku 的 rish 终端里粘贴执行）；
             · 前端那个「开启全盘访问（设置）」按钮：直接跳系统设置页（已验证可用）。
           状态查询（pingBinder / checkSelfPermission）是安全的，保留。 */
        val act = activity ?: return "no-activity"
        val cmd = "appops set ${act.packageName} MANAGE_EXTERNAL_STORAGE allow"
        val copied = copyToClipboard(cmd)
        shizukuGrantResult = if (copied) "manual-copied" else "manual"
        return "manual"
    }

    /** 上一次「用 Shizuku 开全盘访问」的结果：空串=没跑过；`"pending"`=进行中。 */
    @JvmStatic
    fun shizukuGrantResult(): String = shizukuGrantResult ?: ""

    /** 结果字段（主线程写、JNI 线程读）。 */
    @Volatile
    private var shizukuGrantResult: String? = null

    /** Shizuku 是否可用（已装且在跑）。 */
    @JvmStatic
    fun shizukuAvailable(): Boolean = try {
        Shizuku.pingBinder()
    } catch (t: Throwable) {
        false
    }

    /** Shizuku 是否已授权本应用。 */
    @JvmStatic
    fun shizukuPermissionGranted(): Boolean = try {
        Shizuku.pingBinder() && Shizuku.checkSelfPermission() == PackageManager.PERMISSION_GRANTED
    } catch (t: Throwable) {
        false
    }

    /** 发起 Shizuku 授权请求（弹系统对话框）；结果经 `attach()` 里注册的监听回来。 */
    @JvmStatic
    fun requestShizukuPermission(): Boolean = try {
        if (!Shizuku.pingBinder()) {
            false
        } else {
            /* 同 `grantAllFilesViaShizuku`：Shizuku 的 `requestPermission` 也要求主线程，
               从 JNI 线程直接调会整进程崩。这里改成 post 到主线程、立即返回。 */
            Handler(Looper.getMainLooper()).post {
                runCatching { Shizuku.requestPermission(REQ_SHIZUKU) }
                    .onFailure { t -> Log.w(TAG, "requestShizukuPermission 异常", t) }
            }
            true
        }
    } catch (t: Throwable) {
        Log.w(TAG, "requestShizukuPermission 异常", t)
        false
    }

    /**
     * N2-S：跳到系统设置里的「**所有文件访问**」页面（非 root 机获得全盘真路径直读的第二条路）。
     *
     * 与 SAF 的关系：SAF 是按目录逐个授权、且只给 `content://`（读前要物化）；
     * 打开这个开关后 `Environment.isExternalStorageManager()` 为真，
     * **普通路径读写全部可用**，导入/导出/另存为等路径驱动逻辑一并顺畅。
     *
     * 另一条等效路径是 Shizuku 自助执行
     * `appops set <pkg> MANAGE_EXTERNAL_STORAGE allow`（见 docs/18 §4）——
     * 效果相同，只是省去用户去设置里点的这几步。两条路都让本函数返回后
     * `isExternalStorageManager()` 为真。
     *
     * @return 是否成功拉起设置页（失败时调用方给文案提示）。
     */
    @JvmStatic
    fun openAllFilesAccessSettings(): Boolean {
        val act = activity ?: return false
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return false
        return try {
            val appIntent = Intent(
                "android.settings.MANAGE_APP_ALL_FILES_ACCESS_PERMISSION",
                Uri.parse("package:${act.packageName}"),
            ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            act.startActivity(appIntent)
            true
        } catch (t: Throwable) {
            // 部分 ROM 没有应用级页面 ⇒ 退回"所有文件访问"总列表
            try {
                act.startActivity(
                    Intent("android.settings.MANAGE_ALL_FILES_ACCESS_PERMISSION")
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                )
                true
            } catch (t2: Throwable) {
                Log.w(TAG, "打开「所有文件访问」设置页失败", t2)
                false
            }
        }
    }

    /** 当前应用是否已被授予某个**持久化**的 tree 权限（供 UI 判断"授权是否还在"）。 */
    @JvmStatic
    fun hasPersistedTreePermission(): Boolean {
        val act = activity ?: return false
        val uri = savedTreeUri()
        if (uri.isEmpty()) return false
        return try {
            val target = Uri.parse(uri)
            act.contentResolver.persistedUriPermissions.any { it.isReadPermission && it.uri == target }
        } catch (t: Throwable) {
            Log.w(TAG, "查询持久化 URI 权限失败", t)
            false
        }
    }

    /**
     * 列出 tree 下 `relPath` 的子项，返回 JSON 数组。
     *
     * 每项：`{name, docId, isDir, size, modified}`（size/modified 取不到时 -1）。
     * 用系统 `DocumentsContract` 而不是 `DocumentFile`，省掉一个 gradle 依赖。
     *
     * ⚠️ 必须在**非 UI 线程**调用（要走 ContentResolver）。
     */
    @JvmStatic
    fun listTreeChildren(treeUri: String, relPath: String): String {
        val act = activity ?: return "[]"
        return try {
            val tree = Uri.parse(treeUri)
            // 从 tree 根逐个下钻到 relPath
            var docUri = DocumentsContract.buildDocumentUriUsingTree(
                tree,
                DocumentsContract.getTreeDocumentId(tree),
            )
            for (seg in relPath.split('/').filter { it.isNotEmpty() }) {
                docUri = findChildByName(act, tree, docUri, seg) ?: return "[]"
            }
            val docId = DocumentsContract.getDocumentId(docUri)
            val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(tree, docId)
            val out = JSONArray()
            act.contentResolver.query(
                childrenUri,
                arrayOf(
                    DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                    DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                    DocumentsContract.Document.COLUMN_MIME_TYPE,
                    DocumentsContract.Document.COLUMN_SIZE,
                    DocumentsContract.Document.COLUMN_LAST_MODIFIED,
                ),
                null,
                null,
                null,
            )?.use { c ->
                while (c.moveToNext()) {
                    val mime = c.getString(2)
                    out.put(
                        JSONObject().apply {
                            put("name", c.getString(1) ?: "")
                            put("docId", c.getString(0) ?: "")
                            put("isDir", mime == DocumentsContract.Document.MIME_TYPE_DIR)
                            put("size", if (c.isNull(3)) -1L else c.getLong(3))
                            put("modified", if (c.isNull(4)) -1L else c.getLong(4))
                        },
                    )
                }
            }
            out.toString()
        } catch (t: Throwable) {
            Log.w(TAG, "listTreeChildren($treeUri, $relPath) 失败", t)
            "[]"
        }
    }

    /** 在 `parent` 下按显示名找子项，返回其 document URI。 */
    private fun findChildByName(
        act: Activity,
        tree: Uri,
        parent: Uri,
        name: String,
    ): Uri? = try {
        val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(
            tree,
            DocumentsContract.getDocumentId(parent),
        )
        var found: String? = null
        act.contentResolver.query(
            childrenUri,
            arrayOf(
                DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            ),
            null,
            null,
            null,
        )?.use { c ->
            while (c.moveToNext()) {
                if (c.getString(1) == name) {
                    found = c.getString(0)
                    break
                }
            }
        }
        found?.let { DocumentsContract.buildDocumentUriUsingTree(tree, it) }
    } catch (t: Throwable) {
        Log.w(TAG, "findChildByName($name) 失败", t)
        null
    }

    /**
     * 由 Rust 经 JNI 调用：给出导出中转目录的**绝对路径**（不存在则创建）。
     *
     * 为什么不硬编码在 Rust 侧：Android 的 `cacheDir` 只有 `Context` 知道
     * （`/data/user/0/<pkg>/cache`，还受多用户 / 工作资料影响），而 Rust 手里没有
     * `Context` 的 Java 引用 —— 借道 Kotlin 最省事也最准。
     * 返回 null 表示 Activity 还没 attach（调用方按"取消"处理）。
     */
    @JvmStatic
    fun stagingDir(): String? {
        val act = activity
        if (act == null) {
            Log.w(TAG, "stagingDir: Activity 尚未 attach —— Rust 侧会拿到空串并报错")
            return null
        }
        val dir = File(act.cacheDir, EXPORT_DIR)
        if (!dir.exists() && !dir.mkdirs()) {
            Log.w(TAG, "stagingDir: 创建中转目录失败 ${dir.absolutePath}")
        }
        val p = dir.absolutePath
        Log.i(TAG, "stagingDir: $p")
        return p
    }

    /**
     * 由 Rust 经 JNI 调用：把 `srcPath` 的内容写进之前 `ACTION_CREATE_DOCUMENT` 返回的 URI。
     *
     * ⚠️ 必须在**非 UI 线程**调用（会阻塞在 I/O 上）。这是"保存"方向的收尾动作 ——
     * 调用方是先往 cacheDir 的临时路径写、写完了才由这里上传。
     */
    @JvmStatic
    fun writeToUri(uriString: String, srcPath: String): Boolean {
        return try {
            val act = activity ?: return false
            val src = File(srcPath)
            if (!src.isFile) return false
            val written = act.contentResolver.openOutputStream(Uri.parse(uriString), "wt")?.use { out ->
                src.inputStream().use { it.copyTo(out) }
            }
            Log.i(TAG, "writeToUri: ${src.length()} B → $uriString（stream=${written != null}）")
            true
        } catch (t: Throwable) {
            Log.w(TAG, "writeToUri($uriString) 失败", t)
            false
        }
    }

    // ── 内部 ────────────────────────────────────────────────────────────────

    private const val PREFS = "hs_saf_save_targets"

    /** #8：默认音乐目录的授权（tree URI）存在这里。 */
    private const val PREF_TREE_URI = "tree_uri"

    private fun prefs(act: Activity) = act.getSharedPreferences(PREFS, Activity.MODE_PRIVATE)

    /**
     * 「用途」标识：同一个用途 = 同一个保存位置。
     *
     * 用 **MIME** 区分（`audio/*` = 导出音频、`audio/midi` = 导出 MIDI、`*/*` = 工程…），
     * 这样"导出 WAV 的位置"和"工程保存的位置"互不干扰 —— 与各家软件的直觉一致。
     * 文件名只作为兜底（有些调用会传更具体的 mime）。
     */
    private fun saveKey(mime: String, suggestedName: String?): String {
        val ext = suggestedName?.substringAfterLast('.', "")?.lowercase().orEmpty()
        return if (mime.isNotEmpty()) "mime:$mime|ext:$ext" else "ext:$ext"
    }

    private fun buildIntent(kind: Int, mime: String, suggestedName: String?): Intent =
        when (kind) {
            KIND_TREE -> Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                // 写权限 + 可持久化：默认目录要能**建目录/写录音/写工程**，且重启后仍有效。
                addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
                addFlags(Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
            }
            KIND_SAVE -> Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                // 🔴 `ACTION_CREATE_DOCUMENT` 的 type 必须是**具体** MIME：
                // `*/*` 在部分 ROM（ColorOS 实测）上会让创建流程异常、回传空 data，
                // 我们那边就判成「用户取消」—— 这正是「工程保存失败但 WAV 导出正常」的原因
                // （工程 exts 混了 json，在 Rust 侧落到 `*/*`；Rust 侧已改，这里再兜一层）。
                type = mime.takeIf { it.isNotEmpty() && it != "*/*" }
                    ?: "application/octet-stream"
                suggestedName?.takeIf { it.isNotEmpty() }?.let { putExtra(Intent.EXTRA_TITLE, it) }
                // ⚠️ 这两个 flag 是「记住上次位置」的前提：拿到 URI 后要
                // takePersistableUriPermission，才有跨会话的写权限。
                addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
                addFlags(Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
            }
            else -> Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = mime.ifEmpty { "*/*" }
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
        }

    /**
     * N2/D8：把**已授权 tree 内**的真实路径物化成 cacheDir 里的本地文件，返回本地路径。
     *
     * 【为什么必须这么做】2026-09-28 实测：
     * * 应用**自有**目录（`Android/data/<pkg>/files/…`）⇒ 按路径读**成功**；
     * * 已 SAF 授权的共享存储目录 ⇒ 按路径读**失败**（`Failed to read audio info`），
     *   因为 SAF 授权给的是 `content://` 访问权，**不是**文件系统权限，
     *   分区存储的 FUSE 依旧拦着 `open()`。
     * ⇒ 浏览可以走 SAF（`listTreeChildren`），但**读/导入**必须先物化到本地再读。
     * 补丁 `0003` 的注释里本来就写了这条设计（"落在 tree 内时由 SAF 物化"），
     * 只是从未接到读取路径上 —— 于是表现为"能看到文件、拖到轨道却导不进来"。
     *
     * 返回空串表示"不适用/失败"，调用方应回退到原路径逻辑。
     */
    @JvmStatic
    fun materializeTreePath(realPath: String): String {
        val act = activity ?: return ""
        val treeUri = savedTreeUri()
        if (treeUri.isEmpty()) return ""
        return try {
            val tree = Uri.parse(treeUri)
            val treeDocId = DocumentsContract.getTreeDocumentId(tree) // 形如 "primary:HiFiShifter"
            val vol = treeDocId.substringBefore(':', "")
            val rel0 = treeDocId.substringAfter(':', "")
            val base = when {
                vol == "primary" -> "/storage/emulated/0"
                vol.length >= 4 && vol.contains('-') -> "/storage/$vol"
                else -> return ""
            }
            val prefix = if (rel0.isEmpty()) base else "$base/$rel0"
            val norm = if (realPath.startsWith("/")) realPath else "/$realPath"
            if (!(norm == prefix || norm.startsWith("$prefix/"))) return ""
            val rel = norm.removePrefix(prefix).trimStart('/')
            if (rel.isEmpty()) return ""

            // 从 tree 根逐段下钻到目标文档
            var docUri: Uri = DocumentsContract.buildDocumentUriUsingTree(tree, treeDocId)
            for (seg in rel.split("/")) {
                if (seg.isEmpty()) continue
                docUri = findChildByName(act, tree, docUri, seg) ?: return ""
            }
            materialize(act, docUri, rel.substringAfterLast('/'))
        } catch (t: Throwable) {
            Log.w(TAG, "materializeTreePath 失败: $realPath", t)
            ""
        }
    }

    /** 把 `content://` 的流拷到 cacheDir，返回真实路径。 */
    private fun materialize(act: Activity, uri: Uri, displayName: String?): String {
        val raw = displayName?.takeIf { it.isNotBlank() } ?: "import_${System.currentTimeMillis()}"
        val dir = File(act.cacheDir, IMPORT_DIR)
        if (!dir.exists() && !dir.mkdirs()) {
            throw IllegalStateException("无法创建 ${dir.absolutePath}")
        }
        // 加时间戳前缀：不同目录的同名文件不会互相覆盖。
        val dst = File(dir, "${System.currentTimeMillis()}_${sanitize(raw)}")
        val input = act.contentResolver.openInputStream(uri)
            ?: throw IllegalStateException("openInputStream 返回 null")
        input.use { ins ->
            dst.outputStream().use { outs -> ins.copyTo(outs, 256 * 1024) }
        }
        Log.i(TAG, "物化 $uri → ${dst.absolutePath} (${dst.length()} bytes)")
        return dst.absolutePath
    }

    /**
     * 文件名净化：`content://` 的 display name 可能含 `/`、`:`、emoji，
     * 直接拼进路径会路径穿越或建文件失败。**保留中文**（用户素材名常是中文），
     * 顺手去掉 `..` 防止穿越。
     */
    private fun sanitize(name: String): String {
        val cleaned = name
            .replace(Regex("[^A-Za-z0-9._\\-\\u4e00-\\u9fa5]"), "_")
            .replace("..", "_")
            .trim('_', '.')
        val body = cleaned.ifEmpty { "unnamed" }
        return if (body.length <= MAX_NAME_LEN) body else body.takeLast(MAX_NAME_LEN)
    }

    private fun queryDisplayName(act: Activity, uri: Uri): String? = try {
        act.contentResolver
            .query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
            ?.use { c ->
                val idx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (idx >= 0 && c.moveToFirst()) c.getString(idx) else null
            }
    } catch (t: Throwable) {
        Log.w(TAG, "查询 display name 失败（将用时间戳兜底）", t)
        null
    }

    private fun pruneOldImports(act: Activity) {
        val dir = File(act.cacheDir, IMPORT_DIR)
        val files = dir.listFiles() ?: return
        val cutoff = System.currentTimeMillis() - PRUNE_AGE_MS
        var removed = 0
        for (f in files) {
            if (f.isFile && f.lastModified() < cutoff && f.delete()) removed++
        }
        if (removed > 0) Log.i(TAG, "清理过期导入副本 $removed 个")
    }

    /* ── HS-CLIPBOARD-PATCH：Android 系统剪贴板（#11）─────────────────────
     *
     * 用户口径：**不用做 REAPER/VocalShifter**（它们没有手机版），
     * 但「**两个 HiFiShifter 实例之间互相复制**」要做。
     *
     * Android 的剪贴板是**全局**资源（同一用户下所有实例共用，分身/平行空间也一样）
     * ⇒ 两边都读写系统剪贴板即可互传，不需要额外通道。
     *
     * ⚠️ 走**文本信封**（`HIFISHIFTER_CLIPBOARD_V1:<base64>`）而不是自定义 MIME：
     * ① `ClipData.newPlainText` 各 ROM 都稳，不用注册格式；
     * ② 上游 `system_clipboard.rs` 本来就读得懂这个信封（老版本兼容路径），
     *    编码解码**一行都不用新写**；
     * ③ 粘到普通文本框里是一串可识别的标记，不是乱码。
     */

    /** 写系统剪贴板。`text` 应当已是 `HIFISHIFTER_CLIPBOARD_V1:<base64>` 信封。 */
    @JvmStatic
    fun setClipboardText(text: String): Boolean {
        val act = activity ?: return false
        return runOnUiBlocking(act) {
            try {
                val cm = act.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
                    ?: return@runOnUiBlocking false
                cm.setPrimaryClip(ClipData.newPlainText("HiFiShifter", text))
                Log.i(TAG, "setClipboardText: 已写入 ${text.length} 字符")
                true
            } catch (t: Throwable) {
                Log.w(TAG, "setClipboardText 失败", t)
                false
            }
        }
    }

    /** 读系统剪贴板；没有文本或没有权限时返回 null。 */
    @JvmStatic
    fun getClipboardText(): String? {
        val act = activity ?: return null
        return runOnUiBlocking(act) {
            try {
                val cm = act.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
                    ?: return@runOnUiBlocking null
                val clip = cm.primaryClip ?: return@runOnUiBlocking null
                if (clip.itemCount <= 0) return@runOnUiBlocking null
                val cs = clip.getItemAt(0).coerceToText(act)?.toString()
                if (cs.isNullOrEmpty()) null else cs
            } catch (t: Throwable) {
                // Android 12+ 在应用不在前台时读剪贴板会抛或被系统记一条提示 ——
                // 这里当成"没有数据"，不往上冒错。
                Log.w(TAG, "getClipboardText 失败：${t.message}")
                null
            }
        }
    }

    /**
     * 在 **UI 线程**上同步跑一段代码并等它结束。
     *
     * 为什么必须转 UI 线程：部分 ROM 在非主线程访问剪贴板会直接返回空。
     * 调用方（Rust 经 JNI）本来就在非 UI 线程、并且要等返回值，所以同步等待没有副作用。
     */
    private fun <T> runOnUiBlocking(act: Activity, block: () -> T): T {
        if (Looper.myLooper() == Looper.getMainLooper()) return block()
        var result: T? = null
        val latch = CountDownLatch(1)
        act.runOnUiThread {
            try {
                result = block()
            } finally {
                latch.countDown()
            }
        }
        latch.await(2, TimeUnit.SECONDS)
        @Suppress("UNCHECKED_CAST")
        return result as T
    }

    /* ── HS-OPEN-WITH-PATCH：关联文件（其他应用「打开方式」）──────────────
     *
     * Manifest 早就注册了 `ACTION_VIEW`（其他应用能看到本软件），但**点了没反应**
     * —— 因为 `MainActivity` 从没读过 `intent.data`。这里补上接收端。
     *
     * 走与 SAF 相同的**边界物化**：URI 立刻拷进 `cacheDir/saf_import/`，把真实路径
     * 交回 Rust ⇒ 上游那几十处 `std::fs::File::open(path)` 一行不改。
     * 物化直接复用 `materialize()`（含时间戳前缀 + 文件名净化 + 保中文）。
     */

    /** 最近一次「用本应用打开」的文件（真实路径）。只留一个，后到覆盖先到。 */
    @Volatile
    private var pendingOpenPath: String? = null

    /**
     * 由 `MainActivity` 在冷启动与 `onNewIntent` 时调用。
     *
     * ⚠️ 不在这里同步等待：物化可能几十毫秒到几秒（大工程文件），而这两个
     * 调用点都跑在 UI 线程。所以**只记路径**，由前端稍后主动来取。
     */
    fun acceptOpenIntent(intent: Intent?) {
        val uri = intent?.data ?: return
        val act = activity
        if (act == null) {
            Log.w(TAG, "acceptOpenIntent: activity 尚未 attach，忽略 $uri")
            return
        }
        val scheme = uri.scheme?.lowercase()
        if (scheme != "content" && scheme != "file") {
            Log.w(TAG, "acceptOpenIntent: 不支持的 scheme=$scheme")
            return
        }
        try {
            val path = if (scheme == "file") {
                uri.path
            } else {
                materialize(act, uri, queryDisplayName(act, uri))
            }
            if (path.isNullOrBlank()) {
                Log.w(TAG, "acceptOpenIntent: 物化结果为空（$uri）")
                return
            }
            pendingOpenPath = path
            Log.i(TAG, "关联文件已接收 → $path")
        } catch (t: Throwable) {
            Log.w(TAG, "acceptOpenIntent: 物化失败（$uri）", t)
        }
    }

    /**
     * 由 Rust 经 JNI 调用（`CallStaticObjectMethod`，返回 `java.lang.String` 或 null）。
     * **取一次即清** —— 否则每次启动都会重复导入同一个文件。
     */
    @JvmStatic
    fun takePendingOpenPath(): String? {
        val p = pendingOpenPath
        pendingOpenPath = null
        return p
    }

    /**
     * 由 Rust 实现（`platform/saf.rs` 的 `#[no_mangle]`）。
     * 函数名必须与**包名逐字符对应**：`.` → `_`。
     * 改了包名就要同步改 Rust 侧的函数名与 `setup-gen-android.sh` 里的变量。
     */
    @JvmStatic
    external fun nativeOnResult(
        requestId: Long,
        kind: Int,
        localPath: String?,
        displayName: String?,
        error: String?,
    )
}
