/**
 * ws.js — WebSocket connection with auto-reconnect.
 *
 * Exports:
 *   send(msg)            — queue a JSON command to the server
 *   onMessage(handler)   — register a handler for incoming state frames
 *   onConnect(handler)   — called when WS connects / reconnects
 *   onDisconnect(handler)— called when WS drops
 */

const RECONNECT_DELAY_MS = 2000;
const WS_URL = `ws://${location.host}/ws`;

let _socket = null;
let _connected = false;
let _reconnectTimer = null;

const _messageHandlers  = [];
const _connectHandlers  = [];
const _disconnectHandlers = [];

// Commands that must NEVER be buffered or replayed.
// If the socket is closed when these are sent, they are silently dropped —
// the server-side watchdog is responsible for making the machine safe.
const _NO_BUFFER = new Set([
  "jog_start", "jog_stop", "jog_increment",
  "mdi", "program_run", "program_pause", "program_resume", "program_step",
  "spindle_on", "spindle_off",
  "flood_on", "flood_off", "mist_on", "mist_off",
]);

// Outgoing queue — only safe/idempotent commands are buffered across reconnects
// (e.g. feed_override, rapid_override, estop_reset, machine_on/off).
const _sendQueue = [];

// ---- Public API ----

export function send(msg) {
  const text = JSON.stringify(msg);
  if (_socket && _socket.readyState === WebSocket.OPEN) {
    _socket.send(text);
  } else if (!_NO_BUFFER.has(msg.cmd)) {
    // Only buffer idempotent, non-motion commands
    _sendQueue.push(text);
  }
  // Motion commands are dropped — jog.js onDisconnect clears UI state;
  // the server-side watchdog stops the machine.
}

export function onMessage(handler) {
  _messageHandlers.push(handler);
}

export function onConnect(handler) {
  _connectHandlers.push(handler);
}

export function onDisconnect(handler) {
  _disconnectHandlers.push(handler);
}

// ---- Internal ----

function _connect() {
  if (_socket) {
    _socket.onopen = _socket.onclose = _socket.onerror = _socket.onmessage = null;
    _socket.close();
  }

  _socket = new WebSocket(WS_URL);

  _socket.onopen = () => {
    _connected = true;
    clearTimeout(_reconnectTimer);

    // Flush queued messages
    while (_sendQueue.length) {
      _socket.send(_sendQueue.shift());
    }

    _connectHandlers.forEach(h => h());
  };

  _socket.onclose = () => {
    if (_connected) {
      _connected = false;
      // Discard buffered commands — never replay them on the next reconnect.
      // Replaying motion or state-change commands after a disconnect is unsafe.
      _sendQueue.length = 0;
      _disconnectHandlers.forEach(h => h());
    }
    _reconnectTimer = setTimeout(_connect, RECONNECT_DELAY_MS);
  };

  _socket.onerror = () => {
    // onclose fires after onerror, so let onclose handle reconnect
    _socket.close();
  };

  _socket.onmessage = (event) => {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch {
      console.warn("ws: bad JSON", event.data);
      return;
    }
    _messageHandlers.forEach(h => h(data));
  };
}

// Start on module load
_connect();
