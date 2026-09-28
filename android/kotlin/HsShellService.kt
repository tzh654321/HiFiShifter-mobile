package com.arounder.hifishifter

import android.app.Service
import android.content.Intent
import android.os.Binder
import android.os.IBinder
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
 * Shizuku user service：**以 shell 身份运行**的辅助服务。
 *
 * ⚠️ 为什么不用 AIDL（重要，别再改回去）：
 *   AIDL 生成的 Java 会把构建命令行整条塞进注释，而**本项目的路径里含
 *   `\upstream-src` / `\universalDebug`** —— javac 见到注释里的 `\u` 就报
 *   `illegal unicode escape`（`\u` 后面不是 4 位十六进制）。这条路在 Windows + 该路径下**走不通**。
 *   ⇒ 改成**手工 Binder 协议**：服务返回一个覆写了 `onTransact` 的 `Binder`，
 *   客户端用 `transact(code, data, reply, 0)` 直接调；零代码生成、零 aidl.exe。
 *
 * ⚠️ 另两个关键点：
 *   · 必须跑在**独立进程**（清单 `android:process=":shizuku"`）——Shizuku 要以 shell 身份
 *     启动这个进程；
 *   · 该进程**没有常规 Context** ⇒ 包名从 `/proc/self/cmdline` 反推。
 */
class HsShellService : Service() {

    companion object {
        private const val TAG = "HS-SHIZUKU-SVC"

        /** 中转目录（位于本应用**外部** files 下：shell 可写、应用可读）。 */
        private const val STAGING = "hs_shell"
    }

    private val shellBinder = object : Binder() {
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
                        else -> copyToCache(arg)
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
    }

    override fun onBind(intent: Intent?): IBinder = shellBinder

    override fun onDestroy() {
        Log.i(TAG, "HsShellService 销毁")
        super.onDestroy()
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

    /** 把文件复制进应用中转目录，返回本地路径（失败空串）；Binder 事务 1MB 上限 ⇒ 必须落盘。 */
    private fun copyToCache(path: String): String = try {
        val src = File(path)
        if (!src.isFile) {
            Log.w(TAG, "copyToCache: 不是文件 $path")
            ""
        } else {
            val appFiles = File("/sdcard/Android/data/${packageNameOfProcess()}/files", STAGING)
            if (!appFiles.exists() && !appFiles.mkdirs()) {
                Log.w(TAG, "copyToCache: 无法创建中转目录 ${appFiles.absolutePath}")
                ""
            } else {
                val dst = File(appFiles, "${System.currentTimeMillis()}_${src.name.replace('/', '_')}")
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

    private fun canRead(path: String): Boolean = try {
        File(path).canRead()
    } catch (t: Throwable) {
        false
    }

    private fun packageNameOfProcess(): String = try {
        File("/proc/self/cmdline").readText().trimEnd('\u0000').substringBefore(':')
    } catch (t: Throwable) {
        "com.arounder.hifishifter"
    }
}
