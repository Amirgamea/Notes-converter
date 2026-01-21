import { spawn } from 'child_process';
import path from 'path';
import { logger } from './logger.js';

export function convertToDocx(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const referenceDoc = path.join(process.cwd(), 'assets', 'reference.docx');
    
    let args = [
      '--from=markdown+emoji', // enable pandoc emoji support as fallback/adjunct
      '--to=docx',
      `-o`, outputPath,
      `--reference-doc=${referenceDoc}`,
      `--lua-filter=filters/symbols.lua`,
      `--lua-filter=filters/symbols.lua`
    ];

    // Add input file last
    args.push(inputPath);

    logger.debug(`Running Pandoc: pandoc ${args.join(' ')}`);

    const pandoc = spawn('pandoc', args);

    let stderr = '';

    pandoc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    pandoc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        logger.error(`Pandoc failed with code ${code}: ${stderr}`);
        reject(new Error(`Conversion failed: ${stderr}`));
      }
    });

    pandoc.on('error', (err) => {
      logger.error(`Failed to start pandoc: ${err.message}`);
      reject(err);
    });
    
    // Timeout safety (5 minutes)
    setTimeout(() => {
        pandoc.kill();
        reject(new Error("Conversion timed out after 5 minutes"));
    }, 5 * 60 * 1000);
  });
}