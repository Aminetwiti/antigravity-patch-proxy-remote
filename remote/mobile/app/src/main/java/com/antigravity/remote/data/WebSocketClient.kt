package com.antigravity.remote.data

import okhttp3.*
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class RemoteWebSocketClient(
    private val host: String = "10.0.2.2", // Default for Android Emulator to localhost
    private val port: Int = 8090,
    private val onMessageReceived: (JSONObject) -> Unit,
    private val onStatusChanged: (Boolean) -> Unit
) {
    private val client = OkHttpClient.Builder()
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .build()

    private var webSocket: WebSocket? = null

    fun connect() {
        val request = Request.Builder()
            .url("ws://$host:$port/ws")
            .build()

        webSocket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                onStatusChanged(true)
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                try {
                    val json = JSONObject(text)
                    onMessageReceived(json)
                } catch (e: Exception) {
                    e.printStackTrace()
                }
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                onStatusChanged(false)
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                onStatusChanged(false)
            }
        })
    }

    fun sendAction(type: String, requestId: String, payload: JSONObject = JSONObject()) {
        val msg = JSONObject().apply {
            put("type", type)
            put("requestId", requestId)
            put("payload", payload)
        }
        webSocket?.send(msg.toString())
    }

    fun submitToolApproval(requestId: String, cascadeId: String, callId: String, decision: String) {
        val msg = JSONObject().apply {
            put("type", "submit_approval")
            put("requestId", requestId)
            put("cascadeId", cascadeId)
            put("callId", callId)
            put("decision", decision)
        }
        webSocket?.send(msg.toString())
    }

    fun disconnect() {
        webSocket?.close(1000, "App closed")
    }
}

