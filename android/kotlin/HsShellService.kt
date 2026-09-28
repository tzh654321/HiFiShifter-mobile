package com.arounder.hifishifter

import android.os.Binder
import android.os.Parcel
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * 常量：服务描述符与事务码（客户端 `HifishifterFs` 必须与这里逐字一致）。
 */
object HsShellProtocol {
    const val DESCRIPTOR = "com.arounder.hifishifter.HsShellService"
    const val TX_EXEC = 1
    const val TX_LIST_DIR = 2
    const val TX_COPY_TO_CACHE = 3
    const val TX_CAN_READ = 4
}

/**
 * Shizuku user service：**以 shell 身份运行**的辅助类。
 *
 * 🔴 **它必须直接继承 `Binder`（而不是 `Service`）** —— 真机日志实证：
 * ```
 * SuiUserServiceStarter: starting service …/HsShellService...
 * java.lang.ClassCastException: …HsShellService cannot be cast to android.os.IBinder
 * ```
 * Shizuku（这里是 Sui 实现）在 shell 进程里**直接 new 出这个类并强转成 IBinder**，
 * 所以类本身就是那个 binder；写成 `Service` + `onBind` 会绑定失败。
 * 清单里的 `<service>` 声明保留（Shizuku 文档要求该组件被声明；不写会按"未声明"处理）。
 *
 * ⚠️ 另外两点：
 *   · 跑在**独立进程** `android:process=":shizuku"`（清单已声明）；
 *   · 该进程**没有常规 Context** ⇒ 包名从 `/proc/self/cmdline` 反推。
 *
 * ⚠️ 刻意不用 AIDL：AIDL 生成物会把构建命令行塞进注释，而本项目路径含
 *   `\upstream-src` / `\universalDebug` ⇒ javac 报 illegal unicode escape。
 *   这里用手工 Binder 协议（协议码见 `HsShellProtocol`），零代码生成。
 */
class HsShellService : Binder() {

    companion object {
        private const val TAG = "HS-SHIZUKU-SVC"

        /** 中转目录（位于本应用**外部** files 下：shell 可写、应用可读）。 */
        private const val STAGING = "hs_shell"
    }

    override fun onTransact(code: Int, data: Parcel, reply: Parcel?, flags: Int): Boolean {
        return when (code) {
            HsShellProtocol.TX_EXEC,
            HsShellProtocol.TX_LIST_DIR,
            HsShellProtocol.TX_COPY_TO_CACHE,
            -> {
                data.enforceInterface(HsShellProtocol.DESCRIPTOR)
                val arg = data.readString() ?: ""
                val result = when (code) {
                    HsShellProtocol.TX_EXEC -> exec(arg)
                    HsShellProtocol.TX_LIST_DIR -> listDir(arg)
                    /* 中转目录由**客户端**给：服务进程（Sui 以 shell/root 启动）里
                       `/proc/self/cmdline` 不是包名，反推会算错目标路径（实测 copyToCache 因此失败）。 */
                    else -> copyToCache(arg, data.readString() ?: "")
                }
                if (reply != null) {
                    reply.writeNoException()
                    reply.writeString(result)
                }
                true
            }
            HsShellProtocol.TX_CAN_READ -> {
                data.enforceInterface(HsShellProtocol.DESCRIPTOR)
                val arg = data.readString() ?: ""
                if (reply != null) {
                    reply.writeNoException()
                    reply.writeInt(if (canRead(arg)) 1 else 0)
                }
                true
            }
            else -> super.onTransact(code, data, reply, flags)
        }
    }

    /** 跑命令并回收 stdout/stderr（先读流再 waitFor，避免管道写满死锁）。 */
    private fun exec(command: String): String = try {
        val proc = ProcessBuilder("sh", "-c", command).redirectErrorStream(false).start()
        val out = proc.inputStream.bufferedReader().use { it.readText() }
        val err = proc.errorStream.bufferedReader().use { it.readText() }
        val code = proc.waitFor()
        "exit=$code\n$out\n$err"
    } catch (t: Throwable) {
        Log.w(TAG, "exec 失败: $command", t)
        "exit=-1\nerror=${t.javaClass.simpleName}:${t.message}"
    }

    /** 列举目录；失败返回 `{"error":...}`（调用方据此报错，而不是静默空列表）。 */
    private fun listDir(path: String): String = try {
        val dir = File(path)
        if (!dir.isDirectory) {
            JSONObject().put("error", "not-a-directory:$path").toString()
        } else {
            val files = dir.listFiles()
            if (files == null) {
                JSONObject().put("error", "listFiles-null:$path").toString()
            } else {
                val arr = JSONArray()
                for (f in files) {
                    val name = f.name ?: continue
                    if (name.startsWith(".")) continue // 与 fs 版口径一致：隐藏项不计
                    arr.put(
                        JSONObject()
                            .put("name", name)
                            .put("isDir", f.isDirectory)
                            .put("size", if (f.isDirectory) -1L else f.length())
                            .put("modified", f.lastModified()),
                    )
                }
                arr.toString()
            }
        }
    } catch (t: Throwable) {
        Log.w(TAG, "listDir 失败: $path", t)
        JSONObject().put("error", "${t.javaClass.simpleName}:${t.message}").toString()
    }

    /** 把文件复制进应用中转目录，返回本地路径（失败空串）；Binder 事务 1MB 上限 ⇒ 必须落盘。
     *  ⚠️ 用**块体**函数：表达式体里不允许 `return`（Kotlin 会报
     *  `Returns are not allowed for functions with expression body`）。 */
    private fun copyToCache(path: String, destDir: String): String {
        return try {
            val src = File(path)
            if (!src.isFile) {
                Log.w(TAG, "copyToCache: 不是文件 $path")
                ""
            } else if (destDir.isEmpty()) {
                Log.w(TAG, "copyToCache: 客户端未给目标目录")
                ""
            } else {
                val appFiles = File(destDir, STAGING)
                if (!appFiles.exists() && !appFiles.mkdirs()) {
                    Log.w(TAG, "copyToCache: 无法创建中转目录 ${appFiles.absolutePath}")
                    ""
                } else {
                    val dst =
                        File(appFiles, "${System.currentTimeMillis()}_${src.name.replace('/', '_')}")
                    src.inputStream().use { ins ->
                        dst.outputStream().use { outs -> ins.copyTo(outs, 256 * 1024) }
                    }
                    Log.i(TAG, "copyToCache: $path -> ${dst.absolutePath} (${dst.length()} bytes)")
                    dst.absolutePath
                }
            }
        } catch (t: Throwable) {
            Log.w(TAG, "copyToCache 失败: $path", t)
            ""
        }
    }

    private fun canRead(path: String): Boolean = try {
        File(path).canRead()
    } catch (t: Throwable) {
        false
    }


}
