package com.antigravity.remote

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import com.antigravity.remote.data.RemoteWebSocketClient
import com.antigravity.remote.ui.SessionListScreen
import java.util.UUID

class MainActivity : ComponentActivity() {

    private var isConnected by mutableStateOf(false)
    private val sessions = mutableStateListOf<String>()

    private lateinit var wsClient: RemoteWebSocketClient

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        wsClient = RemoteWebSocketClient(
            host = "10.0.2.2",
            port = 8090,
            onMessageReceived = { json ->
                val type = json.optString("type")
                if (type == "response") {
                    val data = json.optJSONObject("data")
                    if (data != null) {
                        sessions.clear()
                        sessions.add(data.toString())
                    }
                }
            },
            onStatusChanged = { connected ->
                isConnected = connected
            }
        )

        setContent {
            MaterialTheme {
                Surface {
                    SessionListScreen(
                        isConnected = isConnected,
                        onConnectClicked = { wsClient.connect() },
                        onFetchSessionsClicked = {
                            wsClient.sendAction("list_sessions", UUID.randomUUID().toString())
                        },
                        sessions = sessions
                    )
                }
            }
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        wsClient.disconnect()
    }
}

