const soundFiles = import.meta.glob('../assets/sounds/**/*.mp3', {
  eager: true,
  query: '?url',
  import: 'default',
})
const escapeVoiceFiles = import.meta.glob('../assets/gifs/escape_from/**/*.mp3', {
  eager: true,
  query: '?url',
  import: 'default',
})
Object.assign(soundFiles, escapeVoiceFiles)

const musicFiles = import.meta.glob('../assets/musics/**/*.mp3', {
  eager: true,
  query: '?url',
  import: 'default',
})

function entriesFrom(files, folder) {
  return Object.entries(files)
    .filter(([path]) => path.includes(`/${folder}/`))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, url]) => url)
}

function fileFrom(files, ending) {
  return Object.entries(files).find(([path]) => path.endsWith(ending))?.[1]
}

class AudioManager {
  constructor() {
    this.sfxVolume = 0.7
    this.musicVolume = 0.4
    this.muted = false
    this.unlocked = false
    this.scene = 'menu'
    this.channels = new Map()
    this.music = new Audio()
    this.music.preload = 'auto'
    this.music.addEventListener('ended', () => this.playNextTrack())
    this.outcome = null
    this.playlists = {
      menu: entriesFrom(musicFiles, 'menu'),
    }
    this.playlistIndex = { menu: 0 }
  }

  unlock() {
    if (this.unlocked) return
    this.unlocked = true
    this.startPlaylist()
  }

  configure({ sfx, music, muted }) {
    this.sfxVolume = Number(sfx) / 100
    this.musicVolume = Number(music) / 100
    this.muted = Boolean(muted)
    this.music.volume = this.muted ? 0 : this.musicVolume
    if (this.outcome) this.outcome.volume = this.muted ? 0 : this.musicVolume
    for (const audio of this.channels.values()) audio.volume = this.muted ? 0 : this.sfxVolume
    if (!this.muted && this.unlocked && this.music.paused && !this.outcome) this.startPlaylist()
  }

  setScene(scene, boardMusic = 'nature') {
    const map = String(boardMusic || 'nature').toLowerCase().replace(/[^a-z0-9_-]/g, '-')
    const next = scene === 'game' ? `game:${map}` : 'menu'
    if (this.scene === next && !this.music.paused) return
    this.scene = next
    this.startPlaylist(true)
  }

  currentPlaylist() {
    if (this.scene === 'menu') return this.playlists.menu
    const map = this.scene.split(':')[1] || 'nature'
    if (!this.playlists[this.scene]) this.playlists[this.scene] = entriesFrom(musicFiles, `in_game/${map}`)
    return this.playlists[this.scene]
  }

  startPlaylist(reset = false) {
    if (!this.unlocked || this.outcome) return
    const list = this.currentPlaylist()
    if (!list.length) return
    if (reset) {
      this.music.pause()
      this.playlistIndex[this.scene] = 0
    }
    if (this.playlistIndex[this.scene] == null) this.playlistIndex[this.scene] = 0
    const url = list[this.playlistIndex[this.scene] % list.length]
    if (this.music.src !== new URL(url, location.href).href) this.music.src = url
    this.music.volume = this.muted ? 0 : this.musicVolume
    this.music.play().catch(() => {})
  }

  playNextTrack() {
    const list = this.currentPlaylist()
    if (!list.length || this.outcome) return
    this.playlistIndex[this.scene] = (this.playlistIndex[this.scene] + 1) % list.length
    this.music.src = list[this.playlistIndex[this.scene]]
    this.music.volume = this.muted ? 0 : this.musicVolume
    this.music.play().catch(() => {})
  }

  play(url, { channel, loop = false, volume = 1 } = {}) {
    if (!url || !this.unlocked) return null
    if (channel) this.stop(channel)
    const audio = new Audio(url)
    audio.loop = loop
    audio.volume = this.muted ? 0 : Math.min(1, this.sfxVolume * volume)
    if (channel) this.channels.set(channel, audio)
    audio.addEventListener('ended', () => {
      if (channel && this.channels.get(channel) === audio) this.channels.delete(channel)
    })
    audio.play().catch(() => {})
    return audio
  }

  stop(channel) {
    const audio = this.channels.get(channel)
    if (!audio) return
    audio.pause()
    audio.currentTime = 0
    this.channels.delete(channel)
  }

  random(folder, options) {
    const files = entriesFrom(soundFiles, folder)
    return this.play(files[Math.floor(Math.random() * files.length)], options)
  }

  diceRoll() {
    this.play(fileFrom(soundFiles, '/dice/roll.mp3'), { channel: 'dice', loop: true })
  }

  diceResult() {
    this.stop('dice')
    this.play(fileFrom(soundFiles, '/dice/result.mp3'))
  }

  movement(duration) {
    const audio = this.play(fileFrom(soundFiles, '/moves/player_move.mp3'), { channel: 'movement', loop: true, volume: 0.85 })
    window.setTimeout(() => {
      if (this.channels.get('movement') === audio) this.stop('movement')
    }, duration)
  }

  ladder() {
    this.random('ladders')
  }

  whatEncountered(effect) {
    const encountered = entriesFrom(soundFiles, 'question_mark').filter(url => /what_encountered/i.test(url))
    this.play(encountered[Math.floor(Math.random() * encountered.length)])
    window.setTimeout(() => {
      if (effect === 'lose_turn') this.play(fileFrom(soundFiles, '/question_mark/what_lose_turn.mp3'))
      else if (effect === 'move_back') this.play(fileFrom(soundFiles, '/question_mark/what_move_back.mp3'))
      else if (effect === 'move_forward') {
        const forward = entriesFrom(soundFiles, 'question_mark').filter(url => /what_move_forward/i.test(url))
        this.play(forward[Math.floor(Math.random() * forward.length)])
      }
    }, 450)
  }

  loseTurn() {
    this.play(fileFrom(soundFiles, '/question_mark/what_lose_turn.mp3'))
  }

  penalty() {
    this.play(fileFrom(soundFiles, '/system/in_game/penalty.mp3'))
  }

  runAwayWarning() {
    this.random('run_away/warning')
  }

  runAwayExplosion() {
    this.random('run_away/explosion')
  }

  runAwayDeath() {
    this.random('run_away/death')
  }

  runAwaySafe() {
    this.random('run_away/safe')
  }

  runAwaySigh() {
    this.random('run_away/sigh', { channel: 'run-away-sigh', volume: 0.55 })
  }

  ghostTownAlarm() {
    this.random('run_away/alarm_bell')
  }

  ghostTownZombie() {
    this.random('run_away/zombie')
  }

  ghostTownDevoured() {
    this.random('run_away/zombie_devoured')
  }

  ghostTownGunshot(weapon) {
    this.play(fileFrom(soundFiles, `/run_away/gunshot/${weapon}.mp3`))
  }

  escapeVoice(ghost, board = 'quiet_mansion') {
    this.random(`${board || 'quiet_mansion'}/entities/${ghost}`)
  }

  escapeOutcome(type, board = 'quiet_mansion') {
    this.random(`${board || 'quiet_mansion'}/${type}`)
  }

  escapeUnlock(board = 'quiet_mansion') {
    const boardSound = fileFrom(soundFiles, `/escape_from/${board || 'quiet_mansion'}/unlocking_exit.mp3`)
    this.play(boardSound || fileFrom(soundFiles, '/escape_from/quiet_mansion/unlocking_exit.mp3'))
  }

  escapeKeyCollected(characterId) {
    const folder = String(characterId || '').replace(/-/g, '_')
    this.random(`characters/escape_from/${folder}/keys`, { channel: 'escape-character', volume: 0.5 })
  }

  escapePickup(type) {
    const folder = type === 'light_source' ? 'light_source' : 'medkit'
    this.random(`escape_from/${folder}`, { channel: `escape-${folder}`, volume: 0.75 })
  }

  escapeSocial(characterId, reaction) {
    const folder = String(characterId || '').replace(/-/g, '_')
    const prefix = `/characters/escape_from/${folder}/social/${reaction}_`
    const files = Object.entries(soundFiles)
      .filter(([path]) => path.includes(prefix) && path.endsWith('.mp3'))
      .map(([, url]) => url)
    this.play(files[Math.floor(Math.random() * files.length)], { channel: 'escape-character', volume: 0.5 })
  }

  stopEscapeCharacterSounds() {
    this.stop('escape-character')
  }

  characterReaction(type) {
    this.random(`characters/${type}`)
  }

  escapeDanger(distance, board = 'quiet_mansion') {
    const rate = ({ 4: 0.75, 3: 0.95, 2: 1.2, 1: 1.5, 0: 1.8 })[distance] || 0.75
    let audio = this.channels.get('escape-danger')
    if (!audio) audio = this.random(`${board || 'quiet_mansion'}/drums`, { channel: 'escape-danger', loop: true, volume: 0.55 })
    if (audio) audio.playbackRate = rate
  }

  stopEscapeDanger() {
    this.stop('escape-danger')
  }

  pauseMusic() {
    this.music.pause()
  }

  resumeMusic() {
    if (!this.muted && this.unlocked && !this.outcome) this.music.play().catch(() => {})
  }

  buttonHover() {
    this.play(fileFrom(soundFiles, '/system/button_hovered.mp3'), { channel: 'button-hover', volume: 0.65 })
  }

  buttonClick() {
    this.play(fileFrom(soundFiles, '/system/button_clicked.mp3'), { volume: 0.8 })
  }

  playOutcome(type, resume = true) {
    const tracks = entriesFrom(musicFiles, type)
    if (!tracks.length || !this.unlocked) return
    this.music.pause()
    this.outcome?.pause()
    const audio = new Audio(tracks[Math.floor(Math.random() * tracks.length)])
    this.outcome = audio
    audio.volume = this.muted ? 0 : this.musicVolume
    audio.addEventListener('ended', () => {
      if (this.outcome !== audio) return
      this.outcome = null
      if (resume || this.scene === 'menu') this.startPlaylist()
    })
    audio.play().catch(() => {})
  }

  destroy() {
    this.music.pause()
    this.outcome?.pause()
    for (const channel of [...this.channels.keys()]) this.stop(channel)
  }
}

export const audioManager = new AudioManager()
