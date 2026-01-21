import { parse } from '@twemoji/parser';
import fs from 'fs/promises';
import path from 'path';
import https from 'https';
import { logger } from './logger.js';

const EMOJI_CACHE_DIR = path.join(process.cwd(), 'assets', 'emoji');

// Ensure cache directory exists
await fs.mkdir(EMOJI_CACHE_DIR, { recursive: true });

async function downloadImage(url, filepath) {
  return new Promise((resolve, reject) => {
    const file = import('fs').then(fsSync => {
        const stream = fsSync.createWriteStream(filepath);
        https.get(url, response => {
        if (response.statusCode !== 200) {
            reject(new Error(`Failed to download: ${response.statusCode}`));
            return;
        }
        response.pipe(stream);
        stream.on('finish', () => {
            stream.close();
            resolve();
        });
        }).on('error', err => {
            fsSync.unlink(filepath, () => {});
            reject(err);
        });
    });
  });
}

export async function preprocessMarkdown(markdown) {
  try {
    const entities = parse(markdown);
    let processed = markdown;
    
    // Process in reverse order to preserve indices
    // Actually simpler to replace globally or build a new string, 
    // but simple string replacement works if we are careful.
    // Twemoji parser gives indices.
    
    // De-duplicate entities to avoid downloading same emoji multiple times
    const uniqueEntities = [...new Map(entities.map(item => [item.text, item])).values()];

    for (const entity of uniqueEntities) {
      // Better naming using the url filename
      const urlParts = entity.url.split('/');
      const finalName = urlParts[urlParts.length - 1];
      const localPath = path.join(EMOJI_CACHE_DIR, finalName);
      
      // Check cache
      try {
        await fs.access(localPath);
      } catch {
        // Download if missing
        try {
          // Use reliable JSDelivr CDN
          const downloadUrl = `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/${finalName}`;
          await downloadImage(downloadUrl, localPath);
        } catch (err) {
          logger.warn(`Failed to download emoji ${entity.text}: ${err.message}`);
          continue; // Skip replacement if download fails
        }
      }

      // Replace in text
      // We need to be careful not to replace inside other structures, but a global replace of the char is usually safe for emojis
      // unless used in code blocks. For robust parsing we'd need a full markdown parser. 
      // For this spec, global replace of the unicode char with image syntax is acceptable.
      // Pandoc image syntax: ![description](path)
      
      // Note: This replaces ALL instances of this emoji
      const regex = new RegExp(entity.text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&'), 'g');
      processed = processed.replace(regex, `![](${localPath}){width=1em height=1em}`);
    }

    return processed;
  } catch (err) {
    logger.error(`Preprocessing error: ${err.message}`);
    return markdown; // Return original on error
  }
}