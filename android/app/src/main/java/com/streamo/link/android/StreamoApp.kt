package com.streamo.link.android

import android.app.Application
import android.util.Log
import com.streamo.link.android.data.StreamoStore
import com.streamo.link.android.defense.Defense

/**
 * Streamo application.
 *  - loads the defense lists (HaGeZi + custom) off the main thread,
 *  - installs a crash handler that writes the crash flag (next boot restores every tab asleep).
 */
class StreamoApp : Application() {

    override fun onCreate() {
        super.onCreate()
        // The crash flag: written before the process dies abnormally; consumed once at next boot.
        val previousHandler = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            try {
                StreamoStore(this).writeCrashFlag()
                Log.e("Streamo", "crash on thread ${thread.name}", throwable)
            } catch (e: Exception) {}
            // let the system finish the death as usual (dialog + process teardown)
            try { previousHandler?.uncaughtException(thread, throwable) } catch (e: Exception) {}
            try { android.os.Process.killProcess(android.os.Process.myPid()) } catch (e: Exception) {}
            System.exit(2)
        }

        // defense lists — background load; decide() works with the core list in the meantime
        val appContext = this
        Thread {
            try { Defense.loadLists(appContext) } catch (e: Exception) {
                Log.e("Streamo", "defense load failed", e)
            }
            // drop caches from previous installs if the apk changed — kept off the main thread (cold start)
            try { cacheDir.listFiles()?.forEach { if (it.name.startsWith("com.android.")) it.deleteRecursively() } } catch (e: Exception) {}
        }.apply { isDaemon = true; name = "streamo-defense-init"; start() }
    }
}
