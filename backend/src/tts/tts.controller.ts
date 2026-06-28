import { Controller, Get, Post, Body, Res, Query, BadRequestException, Logger } from '@nestjs/common';
import { TtsService, TtsOptions } from './tts.service';
import { PrefetchService } from './prefetch.service';
import type { Response } from 'express';

@Controller('api')
export class TtsController {
  private readonly logger = new Logger(TtsController.name);

  constructor(
    private readonly ttsService: TtsService,
    private readonly prefetchService: PrefetchService,
  ) {}

  @Get('tts')
  async synthesizeGet(
    @Query('text') text: string,
    @Query('voice') voice?: string,
    @Query('rate') rate?: string,
    @Query('pitch') pitch?: string,
    @Query('volume') volume?: string,
    @Query('style') style?: string,
    @Query('output_format') outputFormat?: string,
    @Res() res?: Response,
  ) {
    if (!text || typeof text !== 'string') {
      throw new BadRequestException('text is required');
    }

    const options: TtsOptions = { text, voice, rate, pitch, volume, style, outputFormat };

    try {
      const audioBuffer = await this.ttsService.synthesize(options);
      res!.set({
        'Content-Type': 'audio/mpeg',
        'Content-Length': audioBuffer.length.toString(),
        'Cache-Control': 'public, max-age=86400',
      });
      res!.send(audioBuffer);
    } catch (error) {
      res!.status(500).json({
        error: 'TTS synthesis failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  @Post('tts')
  async synthesize(
    @Body('text') text: string,
    @Body('voice') voice?: string,
    @Body('rate') rate?: string,
    @Body('pitch') pitch?: string,
    @Body('volume') volume?: string,
    @Body('style') style?: string,
    @Body('output_format') outputFormat?: string,
    @Body('stream') stream?: boolean,
    @Res() res?: Response,
  ) {
    if (!text || typeof text !== 'string') {
      throw new BadRequestException('text is required');
    }

    const options: TtsOptions = {
      text,
      voice,
      rate,
      pitch,
      volume,
      style,
      outputFormat,
    };

    try {
      if (stream) {
        const audioStream = await this.ttsService.synthesizeStream(options);
        res!.set({
          'Content-Type': 'audio/mpeg',
          'Transfer-Encoding': 'chunked',
          'Cache-Control': 'no-cache',
        });
        const reader = audioStream.getReader();
        const pump = async () => {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res!.write(Buffer.from(value));
          }
          res!.end();
        };
        await pump();
      } else {
        const audioBuffer = await this.ttsService.synthesize(options);
        res!.set({
          'Content-Type': 'audio/mpeg',
          'Content-Length': audioBuffer.length.toString(),
          'Cache-Control': 'public, max-age=86400',
        });
        res!.send(audioBuffer);
      }
    } catch (error) {
      res!.status(500).json({
        error: 'TTS synthesis failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  @Get('tts/voices')
  async listVoices() {
    try {
      const voices = await this.ttsService.listVoices();
      return { voices };
    } catch (error) {
      return {
        error: 'Failed to list voices',
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  @Get('tts/opening')
  async getOpening(@Query('volume') volume?: string) {
    const clientVolume = volume ? parseFloat(volume) : 0.5;
    this.logger.log(`Opening request received, volume=${clientVolume}`);
    const opening = await this.prefetchService.generateOpening(clientVolume);
    if (!opening) {
      this.logger.warn('Opening generation returned null');
      return { text: null, ttsBase64: null };
    }
    this.logger.log(`Opening generated: "${opening.text.slice(0, 40)}"`);
    return {
      text: opening.text,
      ttsBase64: opening.ttsBase64,
      type: 'opening',
    };
  }

  @Get('segue/next')
  async getSegueNext() {
    const segue = this.prefetchService.consumeSegue();
    if (!segue) return { text: null, ttsBase64: null };
    return {
      text: segue.text,
      ttsBase64: segue.ttsBase64,
      songTitle: segue.songTitle,
      artist: segue.artist,
      type: segue.type,
      recommendedSongs: segue.recommendedSongs || undefined,
    };
  }

  @Get('tts/prefetch')
  async prefetch(
    @Query('current') currentSongId: string,
    @Query('volume') volume?: string,
    @Res() res?: Response,
  ) {
    if (!currentSongId) {
      throw new BadRequestException('current song id is required');
    }

    const clientVolume = volume ? parseFloat(volume) : 0.5;

    try {
      const result = await this.prefetchService.prefetchNext(currentSongId, clientVolume);
      res!.json(result);
    } catch (error) {
      res!.status(500).json({
        error: 'Prefetch failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}
