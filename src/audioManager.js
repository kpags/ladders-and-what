const soundFiles = import.meta.glob('../assets/sounds/**/*.mp3', {
  eager: true,
  query: '?url',
  import: 'default',
})

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
      game: entriesFrom(musicFiles, 'in_game'),
    }
    this.playlistIndex = { menu: 0, game: 0 }
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

  setScene(scene) {
    const next = scene === 'game' ? 'game' : 'menu'
    if (this.scene === next && !this.music.paused) return
    this.scene = next
    this.startPlaylist(true)
  }

  startPlaylist(reset = false) {
    if (!this.unlocked || this.outcome) return
    const list = this.playlists[this.scene]
    if (!list.length) return
    if (reset) {
      this.music.pause()
      this.playlistIndex[this.scene] = 0
    }
    const url = list[this.playlistIndex[this.scene] % list.length]
    if (this.music.src !== new URL(url, location.href).href) this.music.src = url
    this.music.volume = this.muted ? 0 : this.musicVolume
    this.music.play().catch(() => {})
  }

  playNextTrack() {
    const list = this.playlists[this.scene]
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
