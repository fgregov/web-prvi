import fs from 'node:fs';
import path from 'node:path';
import pino from 'pino';
import type { AppConfig } from './config.js';

export type Logger = pino.Logger;

const MAX_LOG_BYTES = 20 * 1024 * 1024;
const KEEP_FILES = 5;

function rotate(file: string): void {
  try {
    if (!fs.existsSync(file) || fs.statSync(file).size < MAX_LOG_BYTES) return;
    for (let i = KEEP_FILES - 1; i >= 1; i--) {
      const from = `${file}.${i}`;
      if (fs.existsSync(from)) fs.renameSync(from, `${file}.${i + 1}`);
    }
    fs.renameSync(file, `${file}.1`);
  } catch {
    /* rotacija nije kritična */
  }
}

/** Zajednički logger (HTTP zahtjevi i pozadinski poslovi). Lozinke i kolačići se nikad ne zapisuju. */
export function createLogger(config: AppConfig): Logger {
  const redact = {
    paths: [
      'req.headers.cookie',
      'req.headers.authorization',
      'req.headers["x-csrf-token"]',
      'res.headers["set-cookie"]',
      '*.password',
      '*.pass',
      '*.smtpPassword',
    ],
    censor: '***',
  };
  if (config.mode === 'test') return pino({ level: process.env.LOG_LEVEL ?? 'silent', redact });
  fs.mkdirSync(config.logDir, { recursive: true });
  const file = path.join(config.logDir, 'vendistock.log');
  rotate(file);
  const streams = [
    { stream: process.stdout },
    { stream: pino.destination({ dest: file, mkdir: true, sync: false }) },
  ];
  return pino({ level: process.env.LOG_LEVEL ?? 'info', redact, timestamp: pino.stdTimeFunctions.isoTime }, pino.multistream(streams));
}
