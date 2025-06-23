/**
 * Synchronized Lyrics Player Module for Foundry VTT
 * Provides music playback with synchronized lyrics display
 */

// Module namespace
const MODULE_ID = 'synchronized-lyrics-player';

/**
 * LRC Parser utility class
 */
class LRCParser {
    /**
     * Parse LRC file content into structured lyrics data
     * @param {string} lrcContent - Raw LRC file content
     * @returns {Object} Parsed lyrics with timing information
     */
    static parse(lrcContent) {
        const lines = lrcContent.split('\n');
        const lyrics = [];
        const metadata = {};
        
        for (const line of lines) {
            const timeMatch = line.match(/\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/);
            if (timeMatch) {
                const minutes = parseInt(timeMatch[1]);
                const seconds = parseInt(timeMatch[2]);
                const milliseconds = parseInt(timeMatch[3].padEnd(3, '0'));
                const text = timeMatch[4].trim();
                
                const timeInSeconds = minutes * 60 + seconds + milliseconds / 1000;
                lyrics.push({
                    time: timeInSeconds,
                    text: text
                });
            } else {
                // Parse metadata
                const metaMatch = line.match(/\[(\w+):(.*)\]/);
                if (metaMatch) {
                    metadata[metaMatch[1]] = metaMatch[2];
                }
            }
        }
        
        return { lyrics: lyrics.sort((a, b) => a.time - b.time), metadata };
    }
}

/**
 * Main Lyrics Player Application
 */
class LyricsPlayerApp extends Application {
    constructor(options = {}) {
        super(options);
        this.audio = null;
        this.lyrics = [];
        this.currentLyricIndex = 0;
        this.isPlaying = false;
        this.updateInterval = null;
        this.audioFile = null;
        this.lrcFile = null;
    }

    /** @override */
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            id: "lyrics-player",
            title: "Synchronized Lyrics Player",
            template: `modules/${MODULE_ID}/templates/lyrics-player.hbs`,
            width: 800,
            height: 400,
            resizable: true,
            classes: ["lyrics-player"],
            closeOnSubmit: false,
            submitOnChange: false
        });
    }

    /** @override */
    async getData() {
        const data = await super.getData();
        const settings = game.settings.get(MODULE_ID, 'playerState');
        
        return foundry.utils.mergeObject(data, {
            hasAudio: !!this.audio,
            isPlaying: this.isPlaying,
            currentTime: this.audio ? this.audio.currentTime : 0,
            duration: this.audio ? this.audio.duration : 0,
            volume: settings.volume || 0.5,
            audioFileName: this.audioFile ? this.audioFile.name : 'No file selected',
            lrcFileName: this.lrcFile ? this.lrcFile.name : 'No file selected'
        });
    }

    /** @override */
    activateListeners(html) {
        super.activateListeners(html);
        
        // File upload handlers
        html.find('#audio-upload').on('change', this._onAudioUpload.bind(this));
        html.find('#lrc-upload').on('change', this._onLrcUpload.bind(this));
        
        // Control handlers
        html.find('#play-pause').on('click', this._onPlayPause.bind(this));
        html.find('#volume-slider').on('input', this._onVolumeChange.bind(this));
        html.find('#progress-slider').on('input', this._onSeek.bind(this));
        
        // Initialize audio element if we have saved data
        this._initializeFromSavedState();
    }

    /**
     * Handle audio file upload
     * @param {Event} event - File input change event
     * @private
     */
    async _onAudioUpload(event) {
        const file = event.target.files[0];
        if (!file || !file.type.startsWith('audio/')) {
            ui.notifications.warn('Please select a valid audio file');
            return;
        }

        this.audioFile = file;
        await this._loadAudioFile(file);
        this._saveState();
        this.render();
    }

    /**
     * Handle LRC file upload
     * @param {Event} event - File input change event
     * @private
     */
    async _onLrcUpload(event) {
        const file = event.target.files[0];
        if (!file || !file.name.endsWith('.lrc')) {
            ui.notifications.warn('Please select a valid LRC file');
            return;
        }

        this.lrcFile = file;
        await this._loadLrcFile(file);
        this._saveState();
        this.render();
    }

    /**
     * Load audio file and create audio element
     * @param {File} file - Audio file
     * @private
     */
    async _loadAudioFile(file) {
        if (this.audio) {
            this.audio.pause();
            this.audio = null;
        }

        const arrayBuffer = await file.arrayBuffer();
        const blob = new Blob([arrayBuffer], { type: file.type });
        const url = URL.createObjectURL(blob);

        this.audio = new Audio(url);
        this.audio.preload = 'auto';
        
        this.audio.addEventListener('loadedmetadata', () => {
            this.render();
        });

        this.audio.addEventListener('ended', () => {
            this.isPlaying = false;
            this._stopUpdate();
            this._broadcastState();
            this.render();
        });

        // Broadcast to other players
        this._broadcastAudioLoad(arrayBuffer, file.name, file.type);
    }

    /**
     * Load LRC file and parse lyrics
     * @param {File} file - LRC file
     * @private
     */
    async _loadLrcFile(file) {
        const text = await file.text();
        const parsed = LRCParser.parse(text);
        this.lyrics = parsed.lyrics;
        
        // Broadcast to other players
        this._broadcastLrcLoad(text, file.name);
    }

    /**
     * Handle play/pause button click
     * @param {Event} event - Click event
     * @private
     */
    _onPlayPause(event) {
        if (!this.audio) {
            ui.notifications.warn('Please select an audio file first');
            return;
        }

        if (this.isPlaying) {
            this._pause();
        } else {
            this._play();
        }
    }

    /**
     * Play audio and start updates
     * @private
     */
    _play() {
        if (!this.audio) return;
        
        this.audio.play();
        this.isPlaying = true;
        this._startUpdate();
        this._broadcastState();
        this.render();
    }

    /**
     * Pause audio and stop updates
     * @private
     */
    _pause() {
        if (!this.audio) return;
        
        this.audio.pause();
        this.isPlaying = false;
        this._stopUpdate();
        this._broadcastState();
        this.render();
    }

    /**
     * Handle volume slider change
     * @param {Event} event - Input event
     * @private
     */
    _onVolumeChange(event) {
        const volume = parseFloat(event.target.value);
        if (this.audio) {
            this.audio.volume = volume;
        }
        this._saveState();
        this._broadcastState();
    }

    /**
     * Handle seek slider change
     * @param {Event} event - Input event
     * @private
     */
    _onSeek(event) {
        if (!this.audio) return;
        
        const time = parseFloat(event.target.value);
        this.audio.currentTime = time;
        this._updateLyrics();
        this._broadcastState();
    }

    /**
     * Start the update interval for lyrics synchronization
     * @private
     */
    _startUpdate() {
        this._stopUpdate();
        this.updateInterval = setInterval(() => {
            this._updateLyrics();
            this._updateProgressBar();
        }, 100);
    }

    /**
     * Stop the update interval
     * @private
     */
    _stopUpdate() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
    }

    /**
     * Update lyrics display based on current time
     * @private
     */
    _updateLyrics() {
        if (!this.audio || !this.lyrics.length) return;

        const currentTime = this.audio.currentTime;
        const lyricsContainer = this.element.find('.lyrics-display');
        
        // Find current lyric
        let currentIndex = -1;
        for (let i = this.lyrics.length - 1; i >= 0; i--) {
            if (this.lyrics[i].time <= currentTime) {
                currentIndex = i;
                break;
            }
        }

        if (currentIndex !== this.currentLyricIndex) {
            this.currentLyricIndex = currentIndex;
            this._renderLyrics();
        }
    }

    /**
     * Render lyrics with highlighting
     * @private
     */
    _renderLyrics() {
        const lyricsContainer = this.element.find('.lyrics-display');
        if (!lyricsContainer.length) return;

        let html = '';
        for (let i = 0; i < this.lyrics.length; i++) {
            const lyric = this.lyrics[i];
            const isActive = i === this.currentLyricIndex;
            const isPast = i < this.currentLyricIndex;
            
            html += `<div class="lyric-line ${isActive ? 'active' : ''} ${isPast ? 'past' : ''}" data-time="${lyric.time}">
                ${lyric.text || '♪'}
            </div>`;
        }
        
        lyricsContainer.html(html);
        
        // Scroll to active lyric
        if (this.currentLyricIndex >= 0) {
            const activeLine = lyricsContainer.find('.lyric-line.active');
            if (activeLine.length) {
                lyricsContainer.scrollTop(
                    activeLine.offset().top - lyricsContainer.offset().top + lyricsContainer.scrollTop() - lyricsContainer.height() / 2
                );
            }
        }
    }

    /**
     * Update progress bar
     * @private
     */
    _updateProgressBar() {
        if (!this.audio) return;
        
        const progressSlider = this.element.find('#progress-slider');
        const currentTimeDisplay = this.element.find('.current-time');
        
        if (progressSlider.length && !progressSlider.is(':focus')) {
            progressSlider.val(this.audio.currentTime);
        }
        
        if (currentTimeDisplay.length) {
            currentTimeDisplay.text(this._formatTime(this.audio.currentTime));
        }
    }

    /**
     * Format time in MM:SS format
     * @param {number} seconds - Time in seconds
     * @returns {string} Formatted time string
     * @private
     */
    _formatTime(seconds) {
        const minutes = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${minutes}:${secs.toString().padStart(2, '0')}`;
    }

    /**
     * Save current player state to settings
     * @private
     */
    _saveState() {
        const state = {
            volume: this.audio ? this.audio.volume : 0.5,
            audioFileName: this.audioFile ? this.audioFile.name : null,
            lrcFileName: this.lrcFile ? this.lrcFile.name : null
        };
        
        game.settings.set(MODULE_ID, 'playerState', state);
    }

    /**
     * Initialize player from saved state
     * @private
     */
    _initializeFromSavedState() {
        const settings = game.settings.get(MODULE_ID, 'playerState');
        if (settings.volume && this.audio) {
            this.audio.volume = settings.volume;
        }
    }

    /**
     * Broadcast audio load to all players
     * @param {ArrayBuffer} audioData - Audio file data
     * @param {string} fileName - File name
     * @param {string} mimeType - MIME type
     * @private
     */
    _broadcastAudioLoad(audioData, fileName, mimeType) {
        if (!game.user.isGM) return;
        
        game.socket.emit(`module.${MODULE_ID}`, {
            type: 'loadAudio',
            data: audioData,
            fileName: fileName,
            mimeType: mimeType
        });
    }

    /**
     * Broadcast LRC load to all players
     * @param {string} lrcContent - LRC file content
     * @param {string} fileName - File name
     * @private
     */
    _broadcastLrcLoad(lrcContent, fileName) {
        if (!game.user.isGM) return;
        
        game.socket.emit(`module.${MODULE_ID}`, {
            type: 'loadLrc',
            content: lrcContent,
            fileName: fileName
        });
    }

    /**
     * Broadcast player state to all players
     * @private
     */
    _broadcastState() {
        if (!game.user.isGM) return;
        
        game.socket.emit(`module.${MODULE_ID}`, {
            type: 'playerState',
            isPlaying: this.isPlaying,
            currentTime: this.audio ? this.audio.currentTime : 0,
            volume: this.audio ? this.audio.volume : 0.5
        });
    }

    /** @override */
    async close() {
        this._stopUpdate();
        if (this.audio) {
            this.audio.pause();
        }
        return super.close();
    }
}

/**
 * Control button for the lyrics player
 */
class LyricsPlayerControl extends SceneControl {
    constructor() {
        super({
            name: "lyrics-player",
            title: "Synchronized Lyrics Player",
            icon: "fas fa-music",
            visible: true,
            tools: [{
                name: "open-player",
                title: "Open Lyrics Player",
                icon: "fas fa-play",
                button: true,
                onClick: () => {
                    if (!game.lyricsPlayer) {
                        game.lyricsPlayer = new LyricsPlayerApp();
                    }
                    game.lyricsPlayer.render(true);
                }
            }]
        });
    }
}

// Socket handler for synchronization
function handleSocketMessage(data) {
    if (!game.lyricsPlayer) {
        game.lyricsPlayer = new LyricsPlayerApp();
    }

    const player = game.lyricsPlayer;

    switch (data.type) {
        case 'loadAudio':
            const blob = new Blob([data.data], { type: data.mimeType });
            const url = URL.createObjectURL(blob);
            
            if (player.audio) {
                player.audio.pause();
            }
            
            player.audio = new Audio(url);
            player.audio.preload = 'auto';
            player.audioFile = { name: data.fileName };
            
            player.audio.addEventListener('loadedmetadata', () => {
                player.render();
            });
            
            break;
            
        case 'loadLrc':
            const parsed = LRCParser.parse(data.content);
            player.lyrics = parsed.lyrics;
            player.lrcFile = { name: data.fileName };
            player.render();
            break;
            
        case 'playerState':
            if (player.audio) {
                if (Math.abs(player.audio.currentTime - data.currentTime) > 1) {
                    player.audio.currentTime = data.currentTime;
                }
                player.audio.volume = data.volume;
                
                if (data.isPlaying && player.audio.paused) {
                    player.audio.play();
                    player.isPlaying = true;
                    player._startUpdate();
                } else if (!data.isPlaying && !player.audio.paused) {
                    player.audio.pause();
                    player.isPlaying = false;
                    player._stopUpdate();
                }
            }
            break;
    }
}

// Module initialization
Hooks.once('init', () => {
    console.log(`${MODULE_ID} | Initializing Synchronized Lyrics Player`);
    
    // Register settings
    game.settings.register(MODULE_ID, 'playerState', {
        name: 'Player State',
        scope: 'world',
        config: false,
        type: Object,
        default: {
            volume: 0.5,
            audioFileName: null,
            lrcFileName: null
        }
    });
});

Hooks.once('ready', () => {
    console.log(`${MODULE_ID} | Ready`);
    
    // Set up socket listener
    game.socket.on(`module.${MODULE_ID}`, handleSocketMessage);
});

Hooks.on('getSceneControlButtons', (controls) => {
    const lyricsControl = new LyricsPlayerControl();
    controls.push(lyricsControl);
});