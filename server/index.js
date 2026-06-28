import { WebSocketServer } from 'ws'

const PORT = Number(process.env.PORT || 8787)
const rooms = new Map()
const sockets = new Map()

function code() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let value = ''
  do {
    value = Array.from({ length: 5 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('')
  } while (rooms.has(value))
  return value
}

function send(socket, payload) {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload))
}

function broadcast(room) {
  const payload = { type: 'room_state', room: { code: room.code, hostId: room.hostId, boardIndex: room.boardIndex, players: room.players } }
  for (const player of room.players) {
    const socket = sockets.get(player.id)
    if (socket) send(socket, payload)
  }
}

function leaveRoom(clientId) {
  for (const [roomCode, room] of rooms) {
    const player = room.players.find(item => item.id === clientId)
    if (!player || player.isAI) continue
    room.players = room.players.filter(item => item.id !== clientId)
    if (!room.players.some(item => !item.isAI)) rooms.delete(roomCode)
    else {
      if (room.hostId === clientId) room.hostId = room.players.find(item => !item.isAI).id
      broadcast(room)
    }
    break
  }
}

const wss = new WebSocketServer({ port: PORT, host: '0.0.0.0' })

wss.on('connection', socket => {
  let clientId

  socket.on('message', raw => {
    let message
    try { message = JSON.parse(raw) } catch { return }
    clientId = message.clientId || clientId
    if (clientId) sockets.set(clientId, socket)

    if (message.type === 'create') {
      leaveRoom(clientId)
      const roomCode = code()
      const room = {
        code: roomCode,
        hostId: clientId,
        boardIndex: 0,
        players: [{ id: clientId, characterIndex: message.characterIndex || 0, isAI: false }],
      }
      rooms.set(roomCode, room)
      broadcast(room)
    }

    if (message.type === 'join') {
      const room = rooms.get(String(message.code || '').toUpperCase())
      if (!room) return send(socket, { type: 'error', message: 'Room not found.' })
      if (room.players.length >= 6) return send(socket, { type: 'error', message: 'Room is full.' })
      leaveRoom(clientId)
      if (!room.players.some(item => item.id === clientId)) {
        room.players.push({ id: clientId, characterIndex: message.characterIndex || 0, isAI: false })
      }
      broadcast(room)
    }

    const room = [...rooms.values()].find(item => item.players.some(player => player.id === clientId))
    if (!room) return

    if (message.type === 'character') {
      const player = room.players.find(item => item.id === clientId)
      player.characterIndex = Math.max(0, Number(message.characterIndex) || 0)
      broadcast(room)
    }
    if (message.type === 'board' && room.hostId === clientId) {
      room.boardIndex = Math.max(0, Number(message.boardIndex) || 0)
      broadcast(room)
    }
    if (message.type === 'add_ai' && room.hostId === clientId && room.players.length < 6) {
      const used = room.players.map(item => item.characterIndex)
      let characterIndex = 0
      while (used.includes(characterIndex) && characterIndex < 5) characterIndex++
      room.players.push({ id: `ai-${Date.now()}-${Math.random()}`, characterIndex, isAI: true })
      broadcast(room)
    }
    if (message.type === 'remove_ai' && room.hostId === clientId) {
      const index = room.players.findIndex(item => item.id === message.playerId && item.isAI)
      if (index >= 0) room.players.splice(index, 1)
      broadcast(room)
    }
  })

  socket.on('close', () => {
    if (clientId) {
      sockets.delete(clientId)
      leaveRoom(clientId)
    }
  })
})

console.log(`Lobby WebSocket server listening on 0.0.0.0:${PORT}`)
