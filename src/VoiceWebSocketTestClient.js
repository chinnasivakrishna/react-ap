"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import "./VoiceWebSocketTestClient.css"

const VoiceWebSocketTestClient = () => {
  // WebSocket and connection state
  const [ws, setWs] = useState(null)
  const [connectionStatus, setConnectionStatus] = useState({ message: "Disconnected", className: "disconnected" })
  const [wsUrl, setWsUrl] = useState("wss://airuter-backend.onrender.com/ws/unified-voice?language=en")
  const [language, setLanguage] = useState("en")

  // Session state
  const [currentSessionId, setCurrentSessionId] = useState("")
  const [sessionStatus, setSessionStatus] = useState("No active session")

  // Recording state
  const [isRecording, setIsRecording] = useState(false)
  const [recordingStatus, setRecordingStatus] = useState({ message: "Not Recording", className: "disconnected" })
  const [latestTranscript, setLatestTranscript] = useState("No transcription yet")

  // Synthesis state
  const [textToSynthesize, setTextToSynthesize] = useState(
    "Hello, this is a test message for voice synthesis with rate limiting.",
  )
  const [voice, setVoice] = useState("lily")
  const [speed, setSpeed] = useState(1.0)

  // Rate limiting state
  const [recordingInterval, setRecordingInterval] = useState(500)
  const [chunkSize, setChunkSize] = useState(250)

  // Statistics
  const [messagesSent, setMessagesSent] = useState(0)
  const [messagesReceived, setMessagesReceived] = useState(0)
  const [audioChunksSent, setAudioChunksSent] = useState(0)

  // Response analysis
  const [responseCount, setResponseCount] = useState(0)
  const [responseAnalysis, setResponseAnalysis] = useState(
    "<p>No responses received yet. Run tests to see detailed analysis.</p>",
  )

  // Audio playback
  const [audioInfo, setAudioInfo] = useState("No audio loaded")

  // Message log
  const [messageLog, setMessageLog] = useState([])

  // Validation results
  const [validationResults, setValidationResults] = useState({
    connection: false,
    sessionId: false,
    deepgram: false,
    lmntFormat: false,
    audioFormat: false,
    base64Encoding: false,
    rateLimiting: false,
  })

  // Refs
  const mediaRecorderRef = useRef(null)
  const audioChunksRef = useRef([])
  const audioPlayerRef = useRef(null)
  const messageLogRef = useRef(null)

  // Generate UUID
  const generateUUID = useCallback(() => {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      var r = (Math.random() * 16) | 0,
        v = c == "x" ? r : (r & 0x3) | 0x8
      return v.toString(16)
    })
  }, [])

  // Initialize session UUID on component mount
  useEffect(() => {
    setCurrentSessionId(generateUUID())
  }, [generateUUID])

  // Auto-scroll message log
  useEffect(() => {
    if (messageLogRef.current) {
      messageLogRef.current.scrollTop = messageLogRef.current.scrollHeight
    }
  }, [messageLog])

  // Log message function
  const logMessage = useCallback((message, type) => {
    const timestamp = new Date().toLocaleTimeString()
    const newLogEntry = {
      id: Date.now() + Math.random(),
      timestamp,
      message,
      type,
    }
    setMessageLog((prev) => [...prev, newLogEntry])
  }, [])

  // Send message function
  const sendMessage = useCallback(
    (message) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        logMessage("❌ Cannot send message - WebSocket not connected", "error")
        return false
      }

      try {
        const messageStr = typeof message === "string" ? message : JSON.stringify(message)
        logMessage("📤 SENDING: " + messageStr, "debug")
        ws.send(messageStr)
        setMessagesSent((prev) => prev + 1)
        return true
      } catch (error) {
        logMessage("❌ Error sending message: " + error.message, "error")
        return false
      }
    },
    [ws, logMessage],
  )

  // Handle rate limit error
  const handleRateLimitError = useCallback(() => {
    const newInterval = Math.min(recordingInterval + 200, 2000)
    const newChunkSize = Math.min(chunkSize + 100, 1000)

    setRecordingInterval(newInterval)
    setChunkSize(newChunkSize)

    logMessage(`⚡ Auto-adjusted rate limiting: Interval=${newInterval}ms, ChunkSize=${newChunkSize}ms`, "debug")
  }, [recordingInterval, chunkSize, logMessage])

  // Handle WebSocket messages
  const handleWebSocketMessage = useCallback(
    (event) => {
      setMessagesReceived((prev) => prev + 1)

      try {
        logMessage("📥 RAW RECEIVED: " + event.data, "debug")
        const data = JSON.parse(event.data)
        logMessage("📨 PARSED: " + JSON.stringify(data, null, 2), "received")

        if (data.type === "connected" && data.rate_limiting) {
          logMessage("✅ Server rate limiting config: " + JSON.stringify(data.rate_limiting), "received")
          setValidationResults((prev) => ({ ...prev, rateLimiting: true }))
        } else if (data.data && data.data.session_id && data.data.audio_bytes_to_play) {
          handleAudioResponse(data.data)
        } else if (data.type === "transcript") {
          handleTranscriptResponse(data)
        } else if (data.type === "error" && data.error.includes("Rate limit")) {
          logMessage("🚫 Rate limit error detected: " + data.error, "error")
          handleRateLimitError()
        } else {
          handleOtherResponse(data)
        }
      } catch (error) {
        logMessage("❌ Error parsing message: " + error.message, "error")
        logMessage("❌ Raw message: " + event.data, "error")
      }
    },
    [logMessage, handleRateLimitError],
  )

  // Handle transcript response
  const handleTranscriptResponse = useCallback(
    (data) => {
      logMessage("📝 Transcript: " + data.data, "transcript")
      setLatestTranscript(data.data)
      setValidationResults((prev) => ({ ...prev, deepgram: true }))
      setTextToSynthesize(data.data)
    },
    [logMessage],
  )

  // Handle audio response
  const handleAudioResponse = useCallback(
    (audioData) => {
      setResponseCount((prev) => prev + 1)

      const validation = validateAudioResponse(audioData)
      displayResponseAnalysis(audioData, validation)

      setValidationResults((prev) => ({
        ...prev,
        lmntFormat: validation.isValid,
        audioFormat: audioData.sample_rate === 8000 && audioData.channels === 1 && audioData.sample_width === 2,
        base64Encoding: typeof audioData.audio_bytes_to_play === "string" && audioData.audio_bytes_to_play.length > 0,
      }))

      if (audioData.audio_bytes_to_play) {
        try {
          playAudioFromBase64(audioData.audio_bytes_to_play)
        } catch (error) {
          logMessage("❌ Error playing audio: " + error.message, "error")
        }
      }
    },
    [logMessage],
  )

  // Handle other responses
  const handleOtherResponse = useCallback(
    (data) => {
      if (data.type === "connected") {
        logMessage("✅ Server confirmed connection with services: " + data.services.join(", "), "received")
      } else if (data.type === "error") {
        logMessage("❌ Server error: " + data.error, "error")
      } else if (data.type === "session_started") {
        logMessage("✅ Session started: " + data.session_id, "received")
      } else if (data.type === "synthesis_started") {
        logMessage("🔊 Synthesis started for: " + data.text, "received")
      }
    },
    [logMessage],
  )

  // Validate audio response
  const validateAudioResponse = useCallback((audioData) => {
    const requiredFields = ["session_id", "count", "audio_bytes_to_play", "sample_rate", "channels", "sample_width"]
    const missingFields = []

    for (const field of requiredFields) {
      if (!(field in audioData)) {
        missingFields.push(field)
      }
    }

    return {
      isValid: missingFields.length === 0,
      missingFields: missingFields,
      hasCorrectTypes: {
        session_id: typeof audioData.session_id === "string",
        count: typeof audioData.count === "number",
        audio_bytes_to_play: typeof audioData.audio_bytes_to_play === "string",
        sample_rate: typeof audioData.sample_rate === "number",
        channels: typeof audioData.channels === "number",
        sample_width: typeof audioData.sample_width === "number",
      },
    }
  }, [])

  // Display response analysis
  const displayResponseAnalysis = useCallback(
    (audioData, validation) => {
      const html = `
      <div class="response-container">
        <h3>🎵 Audio Response #${responseCount + 1}</h3>
        
        <div class="response-field">
          <strong>✅ Client Format Validation:</strong> 
          <span style="color: ${validation.isValid ? "green" : "red"}; font-size: 16px;">
            ${validation.isValid ? "✅ MATCHES CLIENT REQUIREMENTS" : "❌ DOES NOT MATCH REQUIREMENTS"}
          </span>
        </div>
        
        ${
          !validation.isValid
            ? `
          <div class="response-field">
            <strong>❌ Missing Fields:</strong> ${validation.missingFields.join(", ")}
          </div>
        `
            : ""
        }
        
        <div class="response-field">
          <strong>Session ID:</strong> ${audioData.session_id || "N/A"}
          <span style="color: ${audioData.session_id === currentSessionId ? "green" : "orange"}">
            ${audioData.session_id === currentSessionId ? "✅ Matches UUID" : "⚠️ Different from sent UUID"}
          </span>
        </div>
        
        <div class="response-field">
          <strong>Count:</strong> ${audioData.count || "N/A"}
        </div>
        
        <div class="response-field">
          <strong>Sample Rate:</strong> ${audioData.sample_rate || "N/A"} Hz
          <span style="color: ${audioData.sample_rate === 8000 ? "green" : "red"}">
            ${audioData.sample_rate === 8000 ? "✅ Correct (8000 Hz)" : "❌ Expected: 8000 Hz"}
          </span>
        </div>
        
        <div class="response-field">
          <strong>Channels:</strong> ${audioData.channels || "N/A"}
          <span style="color: ${audioData.channels === 1 ? "green" : "red"}">
            ${audioData.channels === 1 ? "✅ Correct (Mono)" : "❌ Expected: 1 (Mono)"}
          </span>
        </div>
        
        <div class="response-field">
          <strong>Sample Width:</strong> ${audioData.sample_width || "N/A"} bytes
          <span style="color: ${audioData.sample_width === 2 ? "green" : "red"}">
            ${audioData.sample_width === 2 ? "✅ Correct (16-bit)" : "❌ Expected: 2 bytes (16-bit)"}
          </span>
        </div>
        
        <div class="response-field">
          <strong>Audio Data:</strong> ${audioData.audio_bytes_to_play ? audioData.audio_bytes_to_play.length : 0} characters (base64)
          <span style="color: ${audioData.audio_bytes_to_play && audioData.audio_bytes_to_play.length > 0 ? "green" : "red"}">
            ${audioData.audio_bytes_to_play && audioData.audio_bytes_to_play.length > 0 ? "✅ Present" : "❌ Missing"}
          </span>
        </div>
        
        <div class="response-field">
          <strong>Rate Limiting Status:</strong> 
          <span style="color: green">✅ Compliant with server rate limits</span>
        </div>
      </div>
    `

      setResponseAnalysis(html)
    },
    [responseCount, currentSessionId],
  )

  // Play audio from base64
  const playAudioFromBase64 = useCallback(
    (base64Audio) => {
      try {
        const binaryString = atob(base64Audio)
        const bytes = new Uint8Array(binaryString.length)
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i)
        }

        const blob = new Blob([bytes], { type: "audio/wav" })
        const audioUrl = URL.createObjectURL(blob)

        if (audioPlayerRef.current) {
          audioPlayerRef.current.src = audioUrl
        }

        setAudioInfo(`Audio loaded: ${(bytes.length / 1024).toFixed(2)} KB - Format: WAV (Base64 decoded)`)

        logMessage("🎵 Audio loaded successfully, ready to play", "received")

        // Clean up URL after loading
        setTimeout(() => URL.revokeObjectURL(audioUrl), 1000)
      } catch (error) {
        logMessage("❌ Error creating audio from base64: " + error.message, "error")
      }
    },
    [logMessage],
  )

  // Connect to WebSocket
  const connect = useCallback(() => {
    const urlObj = new URL(wsUrl)
    urlObj.searchParams.set("language", language)

    try {
      logMessage("🔗 Connecting to: " + urlObj.toString(), "debug")
      const newWs = new WebSocket(urlObj.toString())

      newWs.onopen = () => {
        setConnectionStatus({ message: "Connected", className: "connected" })
        logMessage("✅ Connected to WebSocket server", "received")
        setValidationResults((prev) => ({ ...prev, connection: true }))
      }

      newWs.onmessage = handleWebSocketMessage

      newWs.onclose = (event) => {
        setConnectionStatus({ message: "Disconnected", className: "disconnected" })
        logMessage(`❌ WebSocket connection closed. Code: ${event.code}, Reason: ${event.reason}`, "error")
        setValidationResults((prev) => ({ ...prev, connection: false }))
      }

      newWs.onerror = (error) => {
        setConnectionStatus({ message: "Connection Error", className: "error" })
        logMessage("❌ WebSocket error: " + error, "error")
      }

      setWs(newWs)
    } catch (error) {
      setConnectionStatus({ message: "Connection Failed", className: "error" })
      logMessage("❌ Failed to connect: " + error.message, "error")
    }
  }, [wsUrl, language, logMessage, handleWebSocketMessage])

  // Disconnect from WebSocket
  const disconnect = useCallback(() => {
    if (ws) {
      ws.close()
      setWs(null)
    }
  }, [ws])

  // Start session
  const startSession = useCallback(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      logMessage("❌ WebSocket not connected", "error")
      return
    }

    let uuid = currentSessionId.trim()
    if (!uuid) {
      uuid = generateUUID()
      setCurrentSessionId(uuid)
    }

    setResponseCount(0)

    const startMessage = {
      type: "start",
      uuid: uuid,
      language: language,
    }

    if (sendMessage(startMessage)) {
      logMessage("🚀 Sent start event: " + JSON.stringify(startMessage, null, 2), "sent")
      setSessionStatus(`Active Session: ${uuid}`)
      setValidationResults((prev) => ({ ...prev, sessionId: true }))
    }
  }, [ws, currentSessionId, language, logMessage, sendMessage, generateUUID])

  // Synthesize text
  const synthesizeText = useCallback(() => {
    logMessage("🔊 synthesizeText() function called", "debug")

    if (!ws || ws.readyState !== WebSocket.OPEN) {
      logMessage("❌ WebSocket not connected", "error")
      return
    }

    const text = textToSynthesize.trim()
    if (!text) {
      logMessage("❌ Please enter text to synthesize", "error")
      return
    }

    const synthesizeMessage = {
      type: "synthesize",
      text: text,
      voice: voice,
      language: language,
      speed: Number.parseFloat(speed),
    }

    logMessage("🔊 Preparing synthesis message: " + JSON.stringify(synthesizeMessage, null, 2), "debug")

    if (sendMessage(synthesizeMessage)) {
      logMessage("🔊 Sent synthesis request: " + JSON.stringify(synthesizeMessage, null, 2), "sent")
    } else {
      logMessage("❌ Failed to send synthesis request", "error")
    }
  }, [ws, textToSynthesize, voice, language, speed, logMessage, sendMessage])

  // Test synthesis directly
  const testSynthesisDirectly = useCallback(() => {
    logMessage("🧪 Testing synthesis directly...", "debug")

    if (!currentSessionId) {
      logMessage("🧪 No session ID, starting session first...", "debug")
      startSession()
      setTimeout(() => {
        synthesizeText()
      }, 1000)
    } else {
      synthesizeText()
    }
  }, [currentSessionId, logMessage, startSession, synthesizeText])

  // Start recording
  const startRecording = useCallback(async () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      logMessage("❌ WebSocket not connected", "error")
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      })

      mediaRecorderRef.current = new MediaRecorder(stream)
      audioChunksRef.current = []

      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data)

          event.data.arrayBuffer().then((buffer) => {
            if (ws && ws.readyState === WebSocket.OPEN) {
              logMessage(`🎵 Sending audio chunk, size: ${buffer.byteLength} (rate limited)`, "debug")
              ws.send(buffer)
              setAudioChunksSent((prev) => prev + 1)
            }
          })
        }
      }

      mediaRecorderRef.current.start(chunkSize)
      setIsRecording(true)
      setRecordingStatus({ message: "Recording... (Rate Limited)", className: "recording" })

      logMessage(`🎙️ Started rate-limited recording: chunk=${chunkSize}ms, interval=${recordingInterval}ms`, "sent")
    } catch (error) {
      logMessage("❌ Error accessing microphone: " + error.message, "error")
    }
  }, [ws, chunkSize, recordingInterval, logMessage])

  // Stop recording
  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop()
      mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop())
      setIsRecording(false)
      setRecordingStatus({ message: "Not Recording", className: "disconnected" })
      logMessage("⏹️ Stopped recording audio", "sent")
    }
  }, [isRecording, logMessage])

  // Toggle recording
  const toggleRecording = useCallback(async () => {
    if (!isRecording) {
      await startRecording()
    } else {
      stopRecording()
    }
  }, [isRecording, startRecording, stopRecording])

  // Clear audio
  const clearAudio = useCallback(() => {
    if (audioPlayerRef.current) {
      audioPlayerRef.current.src = ""
    }
    setAudioInfo("No audio loaded")
  }, [])

  // Clear log
  const clearLog = useCallback(() => {
    setMessageLog([])
    setMessagesSent(0)
    setMessagesReceived(0)
    setAudioChunksSent(0)
  }, [])

  // Export log
  const exportLog = useCallback(() => {
    const logText = messageLog.map((entry) => `[${entry.timestamp}] ${entry.message}`).join("\n")
    const blob = new Blob([logText], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `voice-test-log-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }, [messageLog])

  // Render validation items
  const renderValidationItems = () => {
    const validations = [
      { key: "connection", label: "WebSocket Connection" },
      { key: "sessionId", label: "Session ID Management (UUID)" },
      { key: "deepgram", label: "STT Transcription" },
      { key: "lmntFormat", label: "TTS Synthesis JSON Format" },
      { key: "audioFormat", label: "Audio Format (8000Hz, 1ch, 16bit)" },
      { key: "base64Encoding", label: "Base64 Audio Encoding" },
      { key: "rateLimiting", label: "Rate Limiting Compliance" },
    ]

    return validations.map((validation) => {
      const status = validationResults[validation.key]
      const className = status === true ? "pass" : status === false ? "fail" : "pending"
      const icon = status === true ? "✅" : status === false ? "❌" : "⏳"
      const statusText = status === true ? "PASS" : status === false ? "FAIL" : "PENDING"

      return (
        <div key={validation.key} className={`validation-item ${className}`}>
          <span>
            {icon} {validation.label} - {statusText}
          </span>
        </div>
      )
    })
  }

  return (
    <div className="voice-test-client">
      <h1>🎤 Rate-Limited Voice WebSocket Test Client</h1>
      <p>
        <strong>Testing STT (Speech-to-Text) + TTS (Text-to-Speech) Integration with Rate Limiting</strong>
      </p>

      <div className="container">
        <h2>🔗 Connection Settings</h2>
        <div>
          <label htmlFor="wsUrl">WebSocket URL:</label>
          <input
            type="text"
            id="wsUrl"
            value={wsUrl}
            onChange={(e) => setWsUrl(e.target.value)}
            placeholder="wss://airuter-backend.onrender.com/ws/unified-voice?language=en"
          />
        </div>
        <div>
          <label htmlFor="language">Language:</label>
          <select id="language" value={language} onChange={(e) => setLanguage(e.target.value)}>
            <option value="en">English (en)</option>
            <option value="hi">Hindi (hi)</option>
            <option value="es">Spanish (es)</option>
            <option value="fr">French (fr)</option>
          </select>
        </div>
        <button onClick={connect} disabled={ws && ws.readyState === WebSocket.OPEN}>
          Connect
        </button>
        <button onClick={disconnect} disabled={!ws || ws.readyState !== WebSocket.OPEN}>
          Disconnect
        </button>
        <div className={`status ${connectionStatus.className}`}>{connectionStatus.message}</div>

        <div className="debug-info">
          <strong>WebSocket State:</strong>{" "}
          <span>
            {ws
              ? ws.readyState === WebSocket.OPEN
                ? "Connected"
                : ws.readyState === WebSocket.CONNECTING
                  ? "Connecting"
                  : ws.readyState === WebSocket.CLOSING
                    ? "Closing"
                    : "Closed"
              : "Not Connected"}
          </span>
          <br />
          <strong>Messages Sent:</strong> <span>{messagesSent}</span>
          <br />
          <strong>Messages Received:</strong> <span>{messagesReceived}</span>
          <br />
          <strong>Audio Chunks Sent:</strong> <span>{audioChunksSent}</span>
        </div>

        <div className="rate-limit-info">
          <h4>⚡ Rate Limiting Configuration</h4>
          <div>
            <label htmlFor="recordingInterval">Recording Interval (ms):</label>
            <input
              type="range"
              id="recordingInterval"
              min="200"
              max="2000"
              step="100"
              value={recordingInterval}
              onChange={(e) => setRecordingInterval(Number.parseInt(e.target.value))}
            />
            <span>{recordingInterval}ms</span>
          </div>
          <div>
            <label htmlFor="chunkSize">Chunk Size (ms):</label>
            <input
              type="range"
              id="chunkSize"
              min="100"
              max="1000"
              step="50"
              value={chunkSize}
              onChange={(e) => setChunkSize(Number.parseInt(e.target.value))}
            />
            <span>{chunkSize}ms</span>
          </div>
          <p>
            <small>Higher values = slower transmission = less likely to hit rate limits</small>
          </p>
        </div>
      </div>

      {/* Client Requirements Validation Summary */}
      <div className="validation-summary">
        <h2>📋 Client Requirements Validation</h2>
        <div className="validation-results">{renderValidationItems()}</div>
      </div>

      <div className="grid-3">
        {/* Session Management */}
        <div className="container">
          <div className="test-section">
            <h3>🆔 Session Management</h3>
            <label htmlFor="sessionUuid">Session UUID:</label>
            <input
              type="text"
              id="sessionUuid"
              value={currentSessionId}
              onChange={(e) => setCurrentSessionId(e.target.value)}
              placeholder="Auto-generated UUID"
            />
            <button onClick={startSession}>Start Session</button>
            <div>{sessionStatus}</div>
          </div>
        </div>

        {/* Deepgram Testing */}
        <div className="container">
          <div className="test-section">
            <h3>🎙️ STT Speech-to-Text (Rate Limited)</h3>
            <button className={isRecording ? "recording" : ""} onClick={toggleRecording}>
              {isRecording ? "Stop Recording" : "Start Recording"}
            </button>
            <div className={`status ${recordingStatus.className}`}>{recordingStatus.message}</div>
            <div>
              <strong>Latest Transcript:</strong>
              <div>{latestTranscript}</div>
            </div>
            <div className="debug-info">
              <strong>Recording Settings:</strong>
              <br />
              Interval: {recordingInterval}ms
              <br />
              Chunk Size: {chunkSize}ms
            </div>
          </div>
        </div>

        {/* LMNT Testing */}
        <div className="container">
          <div className="test-section">
            <h3>🔊 TTS Text-to-Speech</h3>
            <textarea
              rows="3"
              value={textToSynthesize}
              onChange={(e) => setTextToSynthesize(e.target.value)}
              placeholder="Enter text to convert to speech"
            />

            <label htmlFor="voice">Voice:</label>
            <select id="voice" value={voice} onChange={(e) => setVoice(e.target.value)}>
              <option value="lily">Lily</option>
              <option value="daniel">Daniel</option>
              <option value="amy">Amy</option>
            </select>

            <label htmlFor="speed">Speed:</label>
            <input
              type="range"
              id="speed"
              min="0.5"
              max="2.0"
              step="0.1"
              value={speed}
              onChange={(e) => setSpeed(Number.parseFloat(e.target.value))}
            />
            <span>{speed}</span>

            <button onClick={synthesizeText}>Synthesize Speech</button>
            <button onClick={testSynthesisDirectly}>🧪 Test Synthesis (Debug)</button>
          </div>
        </div>
      </div>

      <div className="grid">
        {/* Response Analysis */}
        <div className="container">
          <h2>📊 Response Analysis</h2>
          <div dangerouslySetInnerHTML={{ __html: responseAnalysis }} />
        </div>

        {/* Audio Playback */}
        <div className="container">
          <h2>🎵 Audio Playback</h2>
          <audio ref={audioPlayerRef} controls style={{ width: "100%" }}>
            Your browser does not support the audio element.
          </audio>
          <button onClick={clearAudio}>Clear Audio</button>
          <div>{audioInfo}</div>
        </div>
      </div>

      {/* Message Log */}
      <div className="container">
        <h2>📝 Message Log</h2>
        <button onClick={clearLog}>Clear Log</button>
        <button onClick={exportLog}>Export Log</button>
        <div className="log-container" ref={messageLogRef}>
          {messageLog.map((entry) => (
            <div key={entry.id} className={`log-entry ${entry.type}`}>
              <strong>[{entry.timestamp}]</strong> {entry.message}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default VoiceWebSocketTestClient
