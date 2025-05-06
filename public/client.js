// DOM elements.
const roomSelectionContainer = document.getElementById('room-selection-container')
const roomInput = document.getElementById('room-input')
const connectButton = document.getElementById('connect-button')

const videoChatContainer = document.getElementById('video-chat-container')
const localVideoComponent = document.getElementById('local-video')
const remoteVideoComponent = document.getElementById('remote-video')

// Variables.
const socket = io()
const mediaConstraints = {
  audio: true,
  video: { width: 1280, height: 720 },
}
let localStream
let remoteStream
let isRoomCreator
let rtcPeerConnection // Connection between the local device and the remote peer.
let roomId
let screenStream = null
let isScreenSharing = false
// Free public STUN servers provided by Google.
/*
const iceServers = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    {
      urls: 'turn:visitor.supportsuite247.com:3478', //coturn of ubuntu server
      username: 'webrtc',
      credential: '123456'
    },
    {
      urls: 'turns:visitor.supportsuite247.com:5349',
      username: 'webrtc',
      credential: '123456'
    }
  ],
}
*/

const iceServers = {
  iceServers: [
    // Keep 1-2 STUN servers (optional if TURN always works)
    { urls: 'stun:stun.l.google.com:19302' },

    // TURN (UDP) - Primary relay
    {
      urls: 'turn:visitor.supportsuite247.com:3478',
      username: 'webrtc',
      credential: '123456'
    },

    // TURN over TLS (TCP) - Fallback for UDP-blocked networks
    {
      urls: 'turns:visitor.supportsuite247.com:5349',
      username: 'webrtc',
      credential: '123456'
    }
  ],
  // Force TURN if STUN fails (critical for corporate networks)
  iceTransportPolicy: 'all'  // Optional: Use "all" for testing
};

// BUTTON LISTENER ============================================================
connectButton.addEventListener('click', () => {
  joinRoom(roomInput.value)
})

// SOCKET EVENT CALLBACKS =====================================================
socket.on('room_created', async () => {
  console.log('Socket event callback: room_created')

  await setLocalStream(mediaConstraints)
  isRoomCreator = true
})

socket.on('room_joined', async () => {
  console.log('Socket event callback: room_joined')

  await setLocalStream(mediaConstraints)
  socket.emit('start_call', roomId)
})

socket.on('full_room', () => {
  console.log('Socket event callback: full_room')

  alert('The room is full, please try another one')
})

socket.on('start_call', async () => {
  console.log('Socket event callback: start_call')

  if (isRoomCreator) {
    rtcPeerConnection = new RTCPeerConnection(iceServers)
    addLocalTracks(rtcPeerConnection)
    rtcPeerConnection.ontrack = setRemoteStream
    rtcPeerConnection.onicecandidate = sendIceCandidate
    await createOffer(rtcPeerConnection)
  }
})

socket.on('webrtc_offer', async (event) => {
  console.log('Socket event callback: webrtc_offer')

  if (!isRoomCreator) {
    rtcPeerConnection = new RTCPeerConnection(iceServers)
    addLocalTracks(rtcPeerConnection)
    rtcPeerConnection.ontrack = setRemoteStream
    rtcPeerConnection.onicecandidate = sendIceCandidate
    rtcPeerConnection.setRemoteDescription(new RTCSessionDescription(event))
    await createAnswer(rtcPeerConnection)
  }
})

socket.on('webrtc_answer', (event) => {
  console.log('Socket event callback: webrtc_answer')

  rtcPeerConnection.setRemoteDescription(new RTCSessionDescription(event))
})

socket.on('webrtc_ice_candidate', (event) => {
  console.log('Socket event callback: webrtc_ice_candidate')

  // ICE candidate configuration.
  const candidate = new RTCIceCandidate({
    sdpMLineIndex: event.label,
    candidate: event.candidate,
  })
  rtcPeerConnection.addIceCandidate(candidate)
})

// FUNCTIONS ==================================================================
function joinRoom(room) {
  if (room === '') {
    alert('Please type a room ID')
  } else {
    roomId = room
    socket.emit('join', room)
    showVideoConference()
  }
}

function showVideoConference() {
  roomSelectionContainer.style.display = 'none'
  videoChatContainer.style.display = 'block'
}

async function setLocalStream(mediaConstraints) {
  try {
    localStream = await navigator.mediaDevices.getUserMedia(mediaConstraints)
    localVideoComponent.srcObject = localStream
  } catch (error) {
    console.error('Could not get user media', error)
  }
}

function addLocalTracks(rtcPeerConnection) {
  localStream.getTracks().forEach((track) => {
    rtcPeerConnection.addTrack(track, localStream)
  })
}

async function createOffer(rtcPeerConnection) {
  try {
    const sessionDescription = await rtcPeerConnection.createOffer()
    rtcPeerConnection.setLocalDescription(sessionDescription)
    
    socket.emit('webrtc_offer', {
      type: 'webrtc_offer',
      sdp: sessionDescription,
      roomId,
    })
  } catch (error) {
    console.error(error)
  }
}

async function createAnswer(rtcPeerConnection) {
  try {
    const sessionDescription = await rtcPeerConnection.createAnswer()
    rtcPeerConnection.setLocalDescription(sessionDescription)
    
    socket.emit('webrtc_answer', {
      type: 'webrtc_answer',
      sdp: sessionDescription,
      roomId,
    })
  } catch (error) {
    console.error(error)
  }
}

function setRemoteStream(event) {
  console.log('remote stream', event)
  remoteVideoComponent.srcObject = event.streams[0]
  remoteStream = event.stream
}

function sendIceCandidate(event) {
  if (event.candidate) {
    socket.emit('webrtc_ice_candidate', {
      roomId,
      label: event.candidate.sdpMLineIndex,
      candidate: event.candidate.candidate,
    })
  }
}

document.getElementById('share-screen-button').addEventListener('click', async () => {
  if (!isScreenSharing) {
    try {
      screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true })

      const screenTrack = screenStream.getVideoTracks()[0]

      // Replace video track in sender
      const sender = rtcPeerConnection.getSenders().find(s => s.track.kind === 'video')
      sender.replaceTrack(screenTrack)

      // Update local video preview
      localVideoComponent.srcObject = screenStream

      // When user stops sharing
      screenTrack.onended = async () => {
        const cameraStream = await navigator.mediaDevices.getUserMedia(mediaConstraints)
        const cameraTrack = cameraStream.getVideoTracks()[0]

        sender.replaceTrack(cameraTrack)
        localStream = cameraStream
        localVideoComponent.srcObject = localStream
        isScreenSharing = false
      }

      isScreenSharing = true
    } catch (err) {
      console.error('Error sharing screen:', err)
    }
  }
})
