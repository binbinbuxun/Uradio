import { Injectable, Logger, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import Redis from 'ioredis';

export interface TtsOptions {
  text: string;
  voice?: string;
  rate?: string;
  pitch?: string;
  volume?: string;
  style?: string;
  outputFormat?: string;
}

export interface AzureVoice {
  Name: string;
  DisplayName: string;
  LocalName: string;
  ShortName: string;
  Gender: string;
  Locale: string;
  LocaleName: string;
  StyleList?: string[];
  VoiceType: string;
}

@Injectable()
export class TtsService {
  private readonly logger = new Logger(TtsService.name);
  private readonly subscriptionKey: string;
  private readonly region: string;
  readonly defaultVoice: string;
  readonly defaultStyle: string;
  // Redis 缓存替代内存 Map，重启不丢失
  private readonly CACHE_TTL = 7 * 24 * 3600; // 7 天过期
  private readonly CACHE_PREFIX = 'tts:';
  private token: string | null = null;
  private tokenExpiry = 0;

  constructor(
    private readonly config: ConfigService,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
  ) {
    this.subscriptionKey = this.config.get<string>('AZURE_SPEECH_KEY') || '';
    this.region = this.config.get<string>('AZURE_SPEECH_REGION') || 'eastasia';
    this.defaultVoice = this.config.get<string>('AZURE_TTS_VOICE') || 'zh-CN-XiaoxiaoNeural';
    this.defaultStyle = this.config.get<string>('AZURE_TTS_STYLE') || '';
  }

  private get ttsEndpoint() {
    return `https://${this.region}.tts.speech.microsoft.com/cognitiveservices/v1`;
  }

  private get voicesEndpoint() {
    return `https://${this.region}.tts.speech.microsoft.com/cognitiveservices/voices/list`;
  }

  private get tokenEndpoint() {
    return `https://${this.region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`;
  }

  private ensureKey() {
    if (!this.subscriptionKey || this.subscriptionKey === 'your_speech_key_here') {
      throw new Error('AZURE_SPEECH_KEY is not configured');
    }
  }

  private getCacheKey(options: TtsOptions): string {
    const raw = JSON.stringify({
      text: options.text,
      voice: options.voice || this.defaultVoice,
      rate: options.rate || '0%',
      pitch: options.pitch || '0Hz',
      volume: options.volume || '0%',
      style: options.style || this.defaultStyle,
    });
    return createHash('md5').update(raw).digest('hex');
  }

  private async fetchToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiry) {
      return this.token;
    }

    this.ensureKey();
    this.logger.log('Refreshing Azure TTS access token...');

    const response = await fetch(this.tokenEndpoint, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': this.subscriptionKey,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': '0',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch Azure TTS token: ${response.status}`);
    }

    this.token = await response.text();
    this.tokenExpiry = Date.now() + 9 * 60 * 1000; // 9 minutes (token valid for 10)
    this.logger.log('Azure TTS token refreshed');
    return this.token;
  }

  private buildSSML(options: TtsOptions): string {
    const voice = options.voice || this.defaultVoice;
    const rate = options.rate || '0%';
    const pitch = options.pitch || '0Hz';
    const volume = options.volume || '0%';

    const prosodyParts: string[] = [];
    if (rate !== '0%') prosodyParts.push(`rate="${rate}"`);
    if (pitch !== '0Hz') prosodyParts.push(`pitch="${pitch}"`);
    if (volume !== '0%' ) prosodyParts.push(`volume="${volume}"`);

    const prosodyTag = prosodyParts.length > 0
      ? `<prosody ${prosodyParts.join(' ')}>${this.escapeXml(options.text)}</prosody>`
      : this.escapeXml(options.text);

    const styleTag = (options.style || this.defaultStyle)
      ? `<mstts:express-as style="${options.style || this.defaultStyle}">${prosodyTag}</mstts:express-as>`
      : prosodyTag;

    return `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xmlns:mstts='https://www.w3.org/2001/mstts' xml:lang='zh-CN'><voice name='${voice}'>${styleTag}</voice></speak>`;
  }

  private escapeXml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  async synthesize(options: TtsOptions): Promise<Buffer> {
    const key = this.CACHE_PREFIX + this.getCacheKey(options);

    // 查 Redis 缓存
    try {
      const cached = await this.redis.getBuffer(key);
      if (cached && cached.length > 0) {
        this.logger.debug(`TTS Redis cache hit: ${options.text.slice(0, 30)}...`);
        return cached;
      }
    } catch (e) {
      this.logger.warn(`Redis cache read failed, falling back to API: ${e}`);
    }

    this.ensureKey();
    this.logger.log(`Azure TTS: ${options.text.slice(0, 50)}...`);

    const token = await this.fetchToken();
    const ssml = this.buildSSML(options);

    const response = await fetch(this.ttsEndpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': options.outputFormat || 'audio-24khz-96kbitrate-mono-mp3',
        'User-Agent': 'Uradio',
      },
      body: ssml,
    });

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error(`Azure TTS error ${response.status}: ${errorText}`);
      throw new Error(`Azure TTS failed: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 写入 Redis 缓存，7 天过期
    try {
      await this.redis.set(key, buffer, 'EX', this.CACHE_TTL);
    } catch (e) {
      this.logger.warn(`Redis cache write failed: ${e}`);
    }

    this.logger.log(`TTS generated: ${buffer.length} bytes`);
    return buffer;
  }

  async synthesizeStream(options: TtsOptions): Promise<ReadableStream<Uint8Array>> {
    this.ensureKey();
    this.logger.log(`Azure TTS stream: ${options.text.slice(0, 50)}...`);

    const token = await this.fetchToken();
    const ssml = this.buildSSML(options);

    const response = await fetch(this.ttsEndpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': options.outputFormat || 'audio-24khz-96kbitrate-mono-mp3',
        'User-Agent': 'Uradio',
      },
      body: ssml,
    });

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error(`Azure TTS error ${response.status}: ${errorText}`);
      throw new Error(`Azure TTS failed: ${response.status}`);
    }

    if (!response.body) {
      throw new Error('Azure TTS returned no stream body');
    }

    return response.body;
  }

  async listVoices(): Promise<AzureVoice[]> {
    this.ensureKey();
    const token = await this.fetchToken();

    const response = await fetch(this.voicesEndpoint, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to list voices: ${response.status}`);
    }

    return response.json() as Promise<AzureVoice[]>;
  }
}
