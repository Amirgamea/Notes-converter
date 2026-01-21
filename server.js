import express from 'express';
import multer from 'multer';
import cors from 'cors';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import archiver from 'archiver';
import { exec } from 'child_process';
import { promisify } from 'util';
import { preprocessMarkdown } from './lib/preprocess.js';
import { convertToDocx } from './lib/pandoc-runner.js';
import { logger } from './lib/logger.js';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

// Multer setup
const upload = multer({
  dest: '/tmp/uploads/',
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

// Middleware
app.use(cors());
app.use(express.json());

/**
 * Robust Job Manager Class
 * Handles queueing, concurrency limits, and job state management.
 */
class JobManager {
  constructor(concurrencyLimit = 1) {
    this.jobs = new Map();
    this.queue = [];
    this.activeWorkers = 0;
    this.concurrencyLimit = concurrencyLimit;

    // Run cleanup every 10 minutes to remove stale job data from memory
    setInterval(() => this.cleanupStaleJobs(), 10 * 60 * 1000);
  }

  addJob(file, exportOptions) {
    const jobId = randomUUID();
    const job = {
      id: jobId,
      state: 'queued',
      progress: 0,
      fileSize: file.size,
      originalName: file.originalname,
      inputPath: file.path,
      outputs: {}, // Stores paths: { docx: '...', pdf: '...' }
      exportOptions: exportOptions || { docx: true, pdf: false },
      error: null,
      startTime: 0,
      endTime: 0,
      estimatedDuration: 0,
      created: Date.now()
    };

    this.jobs.set(jobId, job);
    this.queue.push(jobId);
    
    logger.info(`Job added to queue: ${jobId}. Queue length: ${this.queue.length}`);
    
    this.processNext();
    return jobId;
  }

  getJob(jobId) {
    return this.jobs.get(jobId);
  }

  async processNext() {
    // Check concurrency limit and queue availability
    if (this.activeWorkers >= this.concurrencyLimit || this.queue.length === 0) {
      return;
    }

    this.activeWorkers++;
    const jobId = this.queue.shift();
    const job = this.jobs.get(jobId);

    if (!job) {
      this.activeWorkers--;
      this.processNext(); // Job was deleted? Try next.
      return;
    }

    try {
      await this.executeJob(job);
    } catch (error) {
      logger.error(`Unhandled error in worker for job ${jobId}: ${error.message}`);
      job.state = 'error';
      job.error = 'Internal Server Error';
    } finally {
      this.activeWorkers--;
      // Trigger next job immediately
      this.processNext();
    }
  }

  async executeJob(job) {
    logger.info(`Starting processing for job ${job.id}`);
    job.state = 'processing';
    job.startTime = Date.now();
    
    // Heuristic: 2s base + 0.1s per KB. Added 5s buffer if PDF is requested.
    const fileSizeKB = job.fileSize / 1024;
    job.estimatedDuration = 2000 + (fileSizeKB * 100) + (job.exportOptions.pdf ? 5000 : 0);

    const tempProcessedInput = path.join('/tmp', `processed-${job.id}.md`);
    const outputDocx = path.join('/tmp', `output-${job.id}.docx`);
    const outputPdf = path.join('/tmp', `output-${job.id}.pdf`);
    // LibreOffice outputs to the same dir with same name, hard to control filename directly in command sometimes,
    // but --outdir works. We'll rely on specific naming.

    try {
      // Step 1: Preprocess (Emoji, etc.)
      job.progress = 10;
      
      // Read file
      let markdownContent;
      try {
        markdownContent = await fs.readFile(job.inputPath, 'utf8');
      } catch (err) {
        throw new Error("Failed to read uploaded file");
      }
      job.progress = 20;

      // Preprocess content
      const processedContent = await preprocessMarkdown(markdownContent);
      await fs.writeFile(tempProcessedInput, processedContent);
      job.progress = 40;

      // Step 2: Convert to DOCX (Always required as intermediate or final)
      await convertToDocx(tempProcessedInput, outputDocx);
      
      if (job.exportOptions.docx) {
          job.outputs.docx = outputDocx;
      }
      job.progress = 70;

      // Step 3: Convert to PDF if requested
      if (job.exportOptions.pdf) {
          logger.info(`Converting DOCX to PDF for job ${job.id}`);
          // libreoffice --headless --convert-to pdf <input> --outdir <dir>
          // Note: libreoffice creates the file with the same basename as input.
          // input is `output-${job.id}.docx`, so output will be `output-${job.id}.pdf`.
          try {
            await execAsync(`libreoffice --headless --convert-to pdf "${outputDocx}" --outdir /tmp`);
            job.outputs.pdf = outputPdf; // Assuming success creates this path
            
            // Verify PDF creation
            await fs.access(outputPdf);
          } catch (pdfErr) {
             logger.error(`PDF conversion failed: ${pdfErr.message}`);
             // Don't fail the whole job if DOCX is available, unless user ONLY wanted PDF?
             // For now, if PDF fails, we note it but don't crash if DOCX exists.
             if (!job.exportOptions.docx) {
                 throw new Error("PDF generation failed");
             }
             // Else just continue without PDF
          }
      }

      // Step 4: Cleanup unwanted DOCX
      // If user wanted ONLY PDF, and we successfully made PDF, delete DOCX.
      if (!job.exportOptions.docx && job.outputs.pdf) {
          await fs.unlink(outputDocx).catch(() => {});
          delete job.outputs.docx; // Ensure it's not listed
      }
      
      job.progress = 100;
      
      // Update State
      job.state = 'completed';
      job.endTime = Date.now();

      // Schedule physical file deletion (20 mins)
      setTimeout(async () => {
        if (job.outputs.docx) await fs.unlink(job.outputs.docx).catch(() => {});
        if (job.outputs.pdf) await fs.unlink(job.outputs.pdf).catch(() => {});
      }, 20 * 60 * 1000);

    } catch (error) {
      logger.error(`Job ${job.id} logic failed: ${error.message}`);
      job.state = 'error';
      job.error = error.message;
    } finally {
      // Cleanup Input Files immediately to save disk space
      if (job.inputPath) await fs.unlink(job.inputPath).catch(() => {});
      await fs.unlink(tempProcessedInput).catch(() => {});
    }
  }

  // Calculate estimated time left for UI
  calculateTimeLeft(job) {
    if (job.state === 'processing') {
      const elapsed = Date.now() - job.startTime;
      return Math.max(0, Math.ceil((job.estimatedDuration - elapsed) / 1000));
    } else if (job.state === 'queued') {
      const positionInQueue = this.queue.indexOf(job.id);
      if (positionInQueue === -1) return 0;
      return (positionInQueue + 1) * 3;
    }
    return 0;
  }

  // Remove jobs older than 1 hour from memory map
  cleanupStaleJobs() {
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    for (const [id, job] of this.jobs.entries()) {
      if (job.created < oneHourAgo) {
        this.jobs.delete(id);
      }
    }
  }
}

// Initialize Job Manager
const jobManager = new JobManager(1);

// --- Routes ---

// Upload Endpoint
app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  try {
    let exportOptions = { docx: true, pdf: false };
    if (req.body.exportOptions) {
        try {
            exportOptions = JSON.parse(req.body.exportOptions);
        } catch (e) {
            logger.warn('Failed to parse export options');
        }
    }

    const jobId = jobManager.addJob(req.file, exportOptions);
    res.json({ jobId });
  } catch (err) {
    res.status(500).json({ error: 'Failed to queue job' });
  }
});

// Status Endpoint
app.get('/status/:id', (req, res) => {
  const job = jobManager.getJob(req.params.id);
  
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  // Helper to check what formats are ready
  const outputs = {
      docx: !!job.outputs?.docx,
      pdf: !!job.outputs?.pdf
  };

  res.json({
    state: job.state,
    progress: job.progress,
    timeLeft: jobManager.calculateTimeLeft(job),
    outputs: outputs,
    error: job.error
  });
});

// Download Endpoint
app.get('/download/:id/:format', async (req, res) => {
  const { id, format } = req.params;
  const job = jobManager.getJob(id);
  
  if (!job || job.state !== 'completed') {
    return res.status(404).json({ error: 'File not ready or expired' });
  }

  let filePath;
  let ext;
  if (format === 'pdf') {
      filePath = job.outputs.pdf;
      ext = '.pdf';
  } else {
      filePath = job.outputs.docx;
      ext = '.docx';
  }

  if (!filePath) {
      return res.status(404).json({ error: `Format ${format} not generated for this job` });
  }

  const filename = job.originalName.replace(/\.(md|textbundle)$/, '') + ext;
  res.download(filePath, filename);
});

// Download ZIP Endpoint
app.post('/zip', async (req, res) => {
    const { jobIds } = req.body;
    
    if (!Array.isArray(jobIds) || jobIds.length === 0) {
        return res.status(400).json({ error: "No job IDs provided" });
    }

    const validJobs = jobIds.map(id => jobManager.getJob(id)).filter(j => j && j.state === 'completed');

    if (validJobs.length === 0) {
        return res.status(404).json({ error: "No completed files found to zip" });
    }

    res.attachment('converted-files.zip');

    const archive = archiver('zip', {
        zlib: { level: 9 } // Sets the compression level.
    });

    archive.on('warning', function(err) {
        if (err.code === 'ENOENT') {
            logger.warn(err);
        } else {
            throw err;
        }
    });

    archive.on('error', function(err) {
        logger.error(`Archive error: ${err.message}`);
        if (!res.headersSent) {
            res.status(500).send({error: err.message});
        }
    });

    archive.pipe(res);

    for (const job of validJobs) {
        const baseName = job.originalName.replace(/\.(md|textbundle)$/, '');
        
        if (job.outputs.docx) {
             try {
                await fs.access(job.outputs.docx);
                archive.file(job.outputs.docx, { name: baseName + '.docx' });
            } catch (e) {}
        }
        
        if (job.outputs.pdf) {
             try {
                await fs.access(job.outputs.pdf);
                archive.file(job.outputs.pdf, { name: baseName + '.pdf' });
            } catch (e) {}
        }
    }

    await archive.finalize();
});

app.get('/health', (req, res) => res.send('OK'));

// Serve built React app (AFTER API routes, BEFORE fallback)
app.use(express.static(path.join(__dirname, 'dist')));

// Fallback for React Router (if you add routing later)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// Error handling
app.use((err, req, res, next) => {
  logger.error(err.message);
  res.status(500).json({ error: err.message });
});

app.listen(port, () => {
  logger.info(`Server running on port ${port}`);
});