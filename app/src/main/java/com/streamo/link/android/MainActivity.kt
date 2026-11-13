package com.streamo.link.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import com.streamo.link.android.state.BrowserViewModel
import com.streamo.link.android.ui.BrowserScreen
import com.streamo.link.android.ui.StreamoTheme

/**
 * The single-activity host. Everything lives in Compose:
 * toolbar + webviews + panels + player + notifications.
 */
class MainActivity : ComponentActivity() {

    private val viewModel: BrowserViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        // Must be called before super.onCreate — draws the branded splash the instant
        // the tap is registered and keeps it until the first frame is ready.
        installSplashScreen()
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            StreamoTheme {
                BrowserScreen(viewModel = viewModel)
            }
        }
    }

    override fun onStop() {
        super.onStop()
        // flush the tab session synchronously on the way out (like before-quit)
        viewModel.saveSessionNow()
    }

    override fun onTrimMemory(level: Int) {
        super.onTrimMemory(level)
        viewModel.onTrimMemory(level)
    }

    override fun onDestroy() {
        super.onDestroy()
        if (isFinishing) {
            viewModel.disposeAll()
        }
    }
}
