package com.antigravity.remote.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SessionListScreen(
    isConnected: Boolean,
    onConnectClicked: () -> Unit,
    onFetchSessionsClicked: () -> Unit,
    sessions: List<String>
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Antigravity Remote OS") },
                actions = {
                    Text(
                        text = if (isConnected) "● Connected" else "○ Disconnected",
                        color = if (isConnected) Color.Green else Color.Red,
                        modifier = Modifier.padding(end = 16.dp)
                    )
                }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                Button(
                    onClick = onConnectClicked,
                    modifier = Modifier.weight(1f)
                ) {
                    Text(if (isConnected) "Reconnect" else "Connect")
                }
                Button(
                    onClick = onFetchSessionsClicked,
                    enabled = isConnected,
                    modifier = Modifier.weight(1f)
                ) {
                    Text("Refresh Sessions")
                }
            }

            Spacer(modifier = Modifier.height(16.dp))

            if (sessions.isEmpty()) {
                Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center
                ) {
                    Text("No active Cascade sessions found.")
                }
            } else {
                sessions.forEach { session ->
                    Card(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 4.dp)
                    ) {
                        Text(
                            text = session,
                            modifier = Modifier.padding(16.dp)
                        )
                    }
                }
            }
        }
    )
}
